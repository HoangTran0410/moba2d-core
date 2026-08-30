import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installLocalMaps,
  LOCAL_MAPS_KEY,
  readLocalMaps,
  resetStagedMapsForTests,
  takeStagedMaps,
} from '@/content/localMaps';
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
function runEditor(tuning?: unknown): EditorRun {
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
  vm.runInContext(editorFile('lib/polygon-clipping.min.js'), context);
  for (const file of ['js/mapRules.js', 'js/geom.js', 'js/state.js', 'js/storage.js']) {
    vm.runInContext(editorFile(file), context);
  }

  vm.runInContext(
    `
    E.mapName = 'Thung Lũng';
    E.mapSize = [4000, 4000];
    E.meta = { id: 'thung-lung', factions: ['amber', 'jade']${
      tuning === undefined ? '' : `, tuning: ${JSON.stringify(tuning)}`
    } };
    E.terrains = [
      normalizeTerrain({ type: 'wall', position: [1000, 1000], polygon: ${JSON.stringify(CONCAVE_C)} }),
      normalizeTerrain({ type: 'bush', position: [2000, 2000], polygon: [[0,0],[200,0],[200,200],[0,200]] }),
      normalizeTerrain({ type: 'lane', position: [0, 0], polygon: [[400,400],[2000,2000],[3600,3600]],
                         props: { id: 'mid', from: 'amber', to: 'jade' } }),
      normalizeTerrain({ type: 'spawn', position: [400, 400], props: { faction: 'amber', r: 150 } }),
      normalizeTerrain({ type: 'spawn', position: [3600, 3600], props: { faction: 'jade', r: 150 } }),
      normalizeTerrain({ type: 'minion', position: [700, 700], props: { faction: 'amber', lane: 'mid' } }),
      normalizeTerrain({ type: 'minion', position: [3300, 3300], props: { faction: 'jade', lane: 'mid' } }),
      normalizeTerrain({ type: 'structure', position: [900, 900],
                         props: { faction: 'amber', kind: 'turret', stats: { health: 900, attackRange: 700 } } }),
      normalizeTerrain({ type: 'structure', position: [3100, 3100], props: { faction: 'jade', kind: 'turret' } }),
      normalizeTerrain({ type: 'neutral', position: [2000, 1000],
                         props: { role: 'warden', r: 200, stats: { aggroRange: 800 } } }),
    ];
    Store.publishLocal();
    `,
    context
  );

  return written;
}

/**
 * Run the editor's own `parseMapJSON` on a document and report both what it
 * put in `meta` and what `mapSummary()` would then export — the two ends of
 * the round trip a pack map makes through the editor.
 */
function parseInEditor(doc: unknown): {
  meta: { tuning?: unknown };
  summaryTuning: unknown;
  /** The first structure slot's own `stats`, as the editor read them back. */
  structureStats: unknown;
} {
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
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    document: {
      createElement: () => ({ style: {}, appendChild() {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(editorFile('lib/decomp.min.js'), context);
  vm.runInContext(editorFile('lib/polygon-clipping.min.js'), context);
  for (const file of ['js/mapRules.js', 'js/geom.js', 'js/state.js', 'js/storage.js']) {
    vm.runInContext(editorFile(file), context);
  }
  return vm.runInContext(
    `
    (() => {
      const parsed = Store.parseMapJSON(${JSON.stringify(JSON.stringify(doc))}, 'M');
      E.mapName = parsed.name;
      E.mapSize = parsed.mapSize;
      E.meta = parsed.meta;
      const turret = (parsed.terrains || []).find(t => t.type === 'structure');
      return {
        meta: parsed.meta,
        summaryTuning: Store.mapSummary().tuning,
        structureStats: turret && turret.props ? turret.props.stats : undefined,
      };
    })()
    `,
    context
  );
}

/**
 * Point core's `localStorage` reads at a value the editor produced.
 *
 * A real store rather than a getter over one string, because taking the staged
 * map *out* is now half of what this module does — a stub whose `removeItem`
 * is a no-op would let the removal case pass without a removal.
 */
function stubStorage(value: string | null): { get(): string | null } {
  const cell = { value };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === LOCAL_MAPS_KEY ? cell.value : null),
    setItem: (key: string, next: string) => {
      if (key === LOCAL_MAPS_KEY) cell.value = next;
    },
    removeItem: (key: string) => {
      if (key === LOCAL_MAPS_KEY) cell.value = null;
    },
  });
  return { get: () => cell.value };
}

describe('local maps', () => {
  let published: string;

  beforeEach(() => {
    // Every case here installs from scratch, and `takeStagedMaps` remembers
    // what it took for the life of the *document* — see its own header for why
    // that is the point rather than an accident.
    resetStagedMapsForTests();
    const run = runEditor();
    expect(run.key, 'the editor wrote to a different key than core reads').toBe(LOCAL_MAPS_KEY);
    expect(run.published).not.toBeNull();
    published = run.published as string;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('empties the handover slot as it takes the map out of it', () => {
    // The bug, and the whole of the fix. The editor writes here from one
    // place — the "Chơi thử" button — and nothing ever took an entry back
    // out (`unpublishLocal` in `storage.js` has no callers), so every map
    // anybody had pressed playtest on sat in the game's picker for good with
    // no way to remove it from the game side. Reported with a screenshot of
    // two of them.
    const store = stubStorage(published);
    expect(store.get()).not.toBeNull();

    installLocalMaps(new PackRegistry());

    expect(store.get()).toBeNull();
  });

  it('keeps the map for the rest of the page load, storage or no storage', () => {
    // `rebuildContentRegistry()` builds a fresh registry mid-session, when the
    // player installs a pack from the Packs screen. Re-reading storage there
    // would find the emptied slot and the map being played would vanish out
    // of the picker underneath them.
    stubStorage(published);
    installLocalMaps(new PackRegistry());

    const rebuilt = new PackRegistry();
    installLocalMaps(rebuilt);

    expect(rebuilt.maps().map(map => map.id)).toContain('local:thung-lung');
  });

  it('is gone on the next page load, which is what "chơi thử" means', () => {
    const store = stubStorage(published);
    installLocalMaps(new PackRegistry());
    expect(store.get()).toBeNull();

    // A new document: module state starts empty and storage is what is left.
    resetStagedMapsForTests();
    expect(takeStagedMaps()).toEqual([]);

    const fresh = new PackRegistry();
    installLocalMaps(fresh);
    expect(fresh.maps().map(map => map.id)).not.toContain('local:thung-lung');
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

  it("publishes a map's own tuning beside its factions", () => {
    // `MapSummary.tuning` — the same tier as `factions`, not inside the
    // geometry. Miss this and "Chơi thử" runs the map on core's own numbers
    // while the exported file carries the author's, which is two different
    // maps from one drawing with nothing saying so.
    const run = runEditor({
      turrets: { damage: 40 },
      terrain: { water: { speedMultiplier: 0.5 } },
    });
    stubStorage(run.published);

    const [map] = readLocalMaps();
    expect(map.tuning).toEqual({
      turrets: { damage: 40 },
      terrain: { water: { speedMultiplier: 0.5 } },
    });

    const registry = new PackRegistry();
    installLocalMaps(registry);
    const installed = registry.maps().find(m => m.id === 'local:thung-lung');
    expect(installed?.tuning).toEqual(map.tuning);
  });

  it("carries a slot's own stat overrides, which is what makes the inspector mean anything", () => {
    // The editor's inspector offers `stats.health` on a turret,
    // `stats.aggroRange` on a camp and `stats.healPercent` on a fountain, and
    // `commands.js` wrote every one of them into `props.stats` — and the
    // exporter listed slot fields by hand and did not list `stats`. So every
    // per-slot override typed into that panel was dropped on the way out, in
    // silence: the player edited a turret, pressed Chơi thử, and core
    // (`resolveTurretPreset`) received a slot with nothing to override.
    const geometry = JSON.parse(published)[0].geometry;

    expect(geometry.slots.structure[0].stats).toEqual({ health: 900, attackRange: 700 });
    expect(geometry.slots.neutral[0].stats).toEqual({ aggroRange: 800 });
    // And a slot that overrides nothing still exports clean — an empty
    // `stats: {}` would reach core's validator as a block saying nothing.
    expect(geometry.slots.structure[1].stats).toBeUndefined();
  });

  it('and reads them back, so reopening a map does not wipe them', () => {
    // The other half of the same bug: the importer built its marker props by
    // hand too. Export was fixed alone, the next Save would have written the
    // overrides straight back out again as absent.
    const parsed = parseInEditor({
      id: 'thung-lung',
      name: 'Thung Lũng',
      size: 4000,
      factions: [{ id: 'amber' }, { id: 'jade' }],
      // One wall, because `parseMapJSON` refuses a document with no terrain at
      // all — the slot is the subject, the wall is the price of entry.
      terrain: {
        wall: [
          [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 300 },
          ],
        ],
        bush: [],
        water: [],
      },
      slots: {
        spawn: [],
        minion: [],
        structure: [{ faction: 'amber', kind: 'turret', x: 900, y: 900, stats: { health: 900 } }],
        neutral: [],
      },
    });

    expect(parsed.structureStats).toEqual({ health: 900 });
  });

  it('writes no tuning key at all for a map that tunes nothing', () => {
    stubStorage(published);
    const [map] = readLocalMaps();
    expect('tuning' in map).toBe(false);
  });

  it('drops a group the author emptied rather than shipping a hollow one', () => {
    // The config panel makes this easy to produce: type a number into a
    // group, delete it again, and an empty object is left behind. It must not
    // reach the export, where it is a promise of rules that are not there.
    const run = runEditor({ turrets: {}, monsters: {} });
    stubStorage(run.published);
    expect('tuning' in readLocalMaps()[0]).toBe(false);
  });

  it('reads tuning back out of a document it is given', () => {
    // The other direction, and the one that loses data silently: a pack map
    // arrives through `PACK_MAPS_KEY`, the author edits its walls, exports —
    // and without this the numbers it came with are gone and the map looks
    // perfectly fine.
    const parsed = parseInEditor({
      id: 'm',
      name: 'M',
      size: 2000,
      factions: [{ id: 'amber' }, { id: 'jade' }],
      tuning: { monsters: { healthMult: 2 } },
      terrain: {
        wall: [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
        ],
        bush: [],
        water: [],
      },
      slots: { spawn: [], minion: [], structure: [], neutral: [] },
    });
    expect(parsed.meta.tuning).toEqual({ monsters: { healthMult: 2 } });
    expect(parsed.summaryTuning).toEqual({ monsters: { healthMult: 2 } });
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
