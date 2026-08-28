import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLocalMaps, LOCAL_MAPS_KEY, readLocalMaps } from '@/content/localMaps';
import { PackRegistry } from '@/content/PackRegistry';

/**
 * The seam between the map editor and the game, tested from both sides at
 * once.
 *
 * The editor at `public/map-editor/` is plain browser JavaScript — no modules, no
 * build, globals talking to globals — so nothing in core can import it and no
 * type checker will ever compare the two halves. What holds them together is
 * one `localStorage` key and the shape of what goes in it, and the failure
 * mode if that drifts is silent: the editor happily publishes, core validates,
 * core drops it, and the player finds their map missing from the picker with a
 * console line nobody reads.
 *
 * So this test runs the *real* editor code (in a `vm`, with the browser
 * globals it expects stubbed out) and feeds what it actually wrote into the
 * *real* installer. A rename on either side fails here.
 */

const EDITOR = resolve(__dirname, '../../public/map-editor');
const editorFile = (path: string): string => readFileSync(resolve(EDITOR, path), 'utf8');

/** A concave 'C' — the shape the editor has to cut into convex pieces. */
const CONCAVE_C = [
  [0, 0],
  [600, 0],
  [600, 150],
  [150, 150],
  [150, 450],
  [600, 450],
  [600, 600],
  [0, 600],
];

interface EditorRun {
  /** Whatever the editor wrote to `LOCAL_MAPS_KEY`, as a raw string. */
  published: string | null;
  /** Which key it wrote to, so a rename on the editor's side is visible. */
  key: string | null;
}

/**
 * Boot the editor's globals, draw a small but complete map, and publish it.
 *
 * "Complete" is doing real work: `checkMapGeometry` refuses a lane with no
 * muster point for a faction that walks it, so a map with a lane needs the
 * matching minion slots or core rejects the whole thing — which is the
 * behaviour the last case here pins.
 */
function runEditor(): EditorRun {
  const written: EditorRun = { published: null, key: null };
  const store = new Map<string, string>();

  const sandbox: Record<string, unknown> = {
    console,
    JSON,
    Math,
    Date,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
        written.key = key;
        written.published = value;
      },
      removeItem: (key: string) => void store.delete(key),
    },
    document: {
      createElement: () => ({ style: {}, appendChild() {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    },
  };
  sandbox.window = sandbox; // the bundled poly-decomp is a UMD build
  const context = vm.createContext(sandbox);

  vm.runInContext(editorFile('lib/decomp.min.js'), context);
  for (const file of ['js/geom.js', 'js/state.js', 'js/storage.js']) {
    vm.runInContext(editorFile(file), context);
  }

  vm.runInContext(
    `
    E.mapName = 'Thung Lũng';
    E.mapSize = [4000, 4000];
    E.meta = { id: 'thung-lung', factions: ['amber', 'jade'] };
    E.terrains = [
      normalizeTerrain({ type: 'wall', position: [1000, 1000], polygon: ${JSON.stringify(CONCAVE_C)} }),
      normalizeTerrain({ type: 'bush', position: [2000, 2000], polygon: [[0,0],[200,0],[200,200],[0,200]] }),
      normalizeTerrain({ type: 'lane', position: [0, 0], polygon: [[400,400],[2000,2000],[3600,3600]],
                         props: { id: 'mid', from: 'amber', to: 'jade' } }),
      normalizeTerrain({ type: 'spawn', position: [400, 400], props: { faction: 'amber', r: 150 } }),
      normalizeTerrain({ type: 'spawn', position: [3600, 3600], props: { faction: 'jade', r: 150 } }),
      normalizeTerrain({ type: 'minion', position: [700, 700], props: { faction: 'amber', lane: 'mid' } }),
      normalizeTerrain({ type: 'minion', position: [3300, 3300], props: { faction: 'jade', lane: 'mid' } }),
      normalizeTerrain({ type: 'structure', position: [900, 900], props: { faction: 'amber', kind: 'turret' } }),
      normalizeTerrain({ type: 'structure', position: [3100, 3100], props: { faction: 'jade', kind: 'turret' } }),
    ];
    Store.publishLocal();
    `,
    context
  );

  return written;
}

/** Point core's `localStorage` reads at a value the editor produced. */
function stubStorage(value: string | null): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === LOCAL_MAPS_KEY ? value : null),
    setItem: () => {},
    removeItem: () => {},
  });
}

describe('local maps', () => {
  let published: string;

  beforeEach(() => {
    const run = runEditor();
    expect(run.key, 'the editor wrote to a different key than core reads').toBe(LOCAL_MAPS_KEY);
    expect(run.published).not.toBeNull();
    published = run.published as string;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('installs a map the editor published, under the local pack', () => {
    stubStorage(published);
    const registry = new PackRegistry();
    installLocalMaps(registry);

    const ids = registry.maps().map(map => map.id);
    expect(ids).toContain('local:thung-lung');
  });

  it('keeps the shape as drawn, not the convex pieces the game runs on', () => {
    stubStorage(published);
    const [map] = readLocalMaps();
    const geometry = map.geometry as {
      terrain: { wall: unknown[] };
      authoring?: { terrain: { wall: { x: number; y: number }[][] } };
    };

    // The runtime layer is cut up — that is what `TerrainField` needs.
    expect(geometry.terrain.wall.length).toBeGreaterThan(1);
    // The authoring layer is the one 'C', all eight corners of it, so the
    // editor can reopen its own map instead of a heap of triangles.
    expect(geometry.authoring?.terrain.wall).toHaveLength(1);
    expect(geometry.authoring?.terrain.wall[0]).toHaveLength(CONCAVE_C.length);
  });

  it('drops a map core would refuse, and installs the rest', () => {
    const good = JSON.parse(published) as Record<string, unknown>[];
    const broken = JSON.parse(published) as Record<string, unknown>[];
    broken[0].id = 'hong';
    broken[0].size = -1; // `checkMap`: size must be a positive number
    stubStorage(JSON.stringify([...broken, ...good]));

    const registry = new PackRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => installLocalMaps(registry)).not.toThrow();
    warn.mockRestore();

    const ids = registry.maps().map(map => map.id);
    expect(ids).toContain('local:thung-lung');
    expect(ids).not.toContain('local:hong');
  });

  it('installs nothing, and throws nothing, when there is no key', () => {
    stubStorage(null);
    const registry = new PackRegistry();
    expect(() => installLocalMaps(registry)).not.toThrow();
    expect(registry.maps()).toHaveLength(0);
  });
});
