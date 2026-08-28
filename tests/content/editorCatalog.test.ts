import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_SUFFIX, PACK_MAPS_KEY, publishPackMaps } from '@/content/editorCatalog';
import { PackRegistry } from '@/content/PackRegistry';

/**
 * The catalog core publishes so the editor can offer what the game has —
 * tested from both sides at once, the way `localMaps.test.ts` tests the way
 * back.
 *
 * ## Why a catalog and not a message
 *
 * This started as a one-shot handoff: the *game* held the picker, wrote the
 * one map the player chose, and the editor ate the key on boot. That put a
 * second map list in the menu — one holding pack maps, while the editor's own
 * "Map của bạn" held drafts — and neither could see the other. Two lists of
 * two different things, and a map you deleted in one still sat in the other.
 *
 * So the game publishes what it *has* instead, and the editor's own map screen
 * is the only place maps are chosen. The key is read as often as the editor
 * likes and never consumed: it describes the world rather than asking for
 * something, which is also why a stale one is harmless.
 *
 * ## Auto-merged on open, and only here
 *
 * A pack map ships *cut* — `TerrainField` and `Vision` are correct only on
 * convex polygons, so a wall deeper than it is wide is several boxes butted
 * together. An absent `authoring` block is not a guess about that, it is the
 * proof: nothing else produces terrain in that form. So opening one rebuilds
 * the drawn shapes, and a map that *does* carry `authoring` is already in the
 * form its author left it and is opened untouched.
 */

const EDITOR = resolve(__dirname, '../../public/map-editor');
const editorFile = (path: string): string => readFileSync(resolve(EDITOR, path), 'utf8');

/** Two boxes butted together, plus a bush — the cut form a pack ships. */
const CUT_MAP = {
  id: 'proving-grounds',
  name: 'Sân Thử Nghiệm',
  size: 4000,
  factions: [{ id: 'amber' }, { id: 'jade' }],
  geometry: {
    terrain: {
      wall: [
        [
          { x: 1000, y: 1000 },
          { x: 1600, y: 1000 },
          { x: 1600, y: 1200 },
          { x: 1000, y: 1200 },
        ],
        [
          { x: 1600, y: 1000 },
          { x: 2200, y: 1000 },
          { x: 2200, y: 1200 },
          { x: 1600, y: 1200 },
        ],
      ],
      bush: [
        [
          { x: 2500, y: 2500 },
          { x: 2700, y: 2500 },
          { x: 2700, y: 2700 },
          { x: 2500, y: 2700 },
        ],
      ],
      water: [],
    },
    slots: {
      spawn: [
        { x: 400, y: 400, faction: 'amber', r: 150 },
        { x: 3600, y: 3600, faction: 'jade', r: 150 },
      ],
      minion: [],
      structure: [],
      neutral: [],
    },
    lanes: [],
  },
};

/** The same map as its author drew it: one wall, and an `authoring` block. */
const AUTHORED_MAP = {
  ...CUT_MAP,
  id: 'drawn-by-hand',
  name: 'Vẽ Tay',
  geometry: {
    ...CUT_MAP.geometry,
    authoring: {
      version: 1,
      terrain: {
        wall: [
          [
            { x: 1000, y: 1000 },
            { x: 2200, y: 1000 },
            { x: 2200, y: 1200 },
            { x: 1000, y: 1200 },
          ],
        ],
        bush: CUT_MAP.geometry.terrain.bush,
        water: [],
      },
    },
  },
};

/** A registry holding `maps`, the way a runtime pack install leaves one. */
function registryWith(maps: unknown[]): PackRegistry {
  const registry = new PackRegistry();
  registry.installData({
    manifest: { id: 'reference', version: '1.0.0', coreRange: '*' },
    maps: maps as never,
  });
  return registry;
}

interface EditorSession {
  /** Names the editor would list under "Từ pack đã cài". */
  catalogNames(): string[];
  /** Open a copy of a published map, and report what landed on the canvas. */
  open(id: string): { name: string; walls: number; bushes: number };
  /** Publish the open map for the game, then delete it, and report the list. */
  publishThenDelete(): { afterPublish: number; afterDelete: number };
  /** Walls after one undo — the merge must be its own step, not part of the open. */
  undoOnce(): number;
}

/** Boot the real editor over a store already holding what core published. */
function editorOver(store: Map<string, string>): EditorSession {
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
      getElementById: () => null,
    },
    // `render.js` and `ui.js` are the editor's browser half and are not loaded
    // here, but the import path legitimately calls into both.
    requestRender: () => {},
    // Every `UI.*` that `state.js` and `storage.js` reach for. Stubbed rather
    // than skipped: the import path calls into the browser half for real, and
    // a missing name here fails as a `TypeError` inside the code under test.
    UI: {
      toast: () => {},
      alert: () => {},
      setSaveState: () => {},
      syncAll: () => {},
      syncHistory: () => {},
      syncMapName: () => {},
      syncSelection: () => {},
      syncView: () => {},
    },
  };
  sandbox.window = sandbox; // the bundled poly-decomp is a UMD build
  const context = vm.createContext(sandbox);

  vm.runInContext(editorFile('lib/decomp.min.js'), context);
  vm.runInContext(editorFile('lib/polygon-clipping.min.js'), context);
  for (const file of ['js/geom.js', 'js/state.js', 'js/storage.js']) {
    vm.runInContext(editorFile(file), context);
  }

  const run = <T,>(code: string): T => vm.runInContext(code, context) as T;
  const count = (): number =>
    JSON.parse(store.get('moba2d-local-maps-v1') ?? '[]').length as number;

  return {
    catalogNames: () => run<string[]>('Store.readPackMaps().map((m) => m.name)'),
    open: id => {
      run(`Store.openPackMap(${JSON.stringify(id)})`);
      return run(`({
        name: E.mapName,
        walls: E.terrains.filter((t) => t.type === 'wall').length,
        bushes: E.terrains.filter((t) => t.type === 'bush').length,
      })`);
    },
    undoOnce: () => {
      run('History.undo()');
      return run<number>("E.terrains.filter((t) => t.type === 'wall').length");
    },
    publishThenDelete: () => {
      run('Store.publishLocal()');
      const afterPublish = count();
      run('Store.deleteMap(E.mapId)');
      return { afterPublish, afterDelete: count() };
    },
  };
}

describe('editor catalog', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes every installed map for the editor to list', async () => {
    await publishPackMaps(registryWith([CUT_MAP, AUTHORED_MAP]));

    expect(editorOver(store).catalogNames()).toEqual(['Sân Thử Nghiệm', 'Vẽ Tay']);
  });

  it('opens a pack map as a copy, named so the two are told apart', async () => {
    await publishPackMaps(registryWith([CUT_MAP]));

    const opened = editorOver(store).open('reference:proving-grounds');

    expect(opened.name).toBe(`Sân Thử Nghiệm${EDIT_SUFFIX}`);
  });

  it('rebuilds the drawn shapes of a map that ships no `authoring`', async () => {
    await publishPackMaps(registryWith([CUT_MAP]));

    const opened = editorOver(store).open('reference:proving-grounds');

    // Two butted boxes are one wall. The bush is alone and stays one.
    expect(opened.walls).toBe(1);
    expect(opened.bushes).toBe(1);
  });

  it('leaves a map that ships `authoring` exactly as its author drew it', async () => {
    await publishPackMaps(registryWith([AUTHORED_MAP]));

    const opened = editorOver(store).open('reference:drawn-by-hand');

    expect(opened.walls).toBe(1);
  });

  it('makes the merge its own undo step, so one Ctrl+Z restores the pieces', async () => {
    // The merge has to be committed separately from the open. Folded into it,
    // undo would throw away the whole map rather than just the merge; left
    // uncommitted, undo would skip past it and the pieces never come back.
    await publishPackMaps(registryWith([CUT_MAP]));
    const editor = editorOver(store);
    expect(editor.open('reference:proving-grounds').walls).toBe(1);

    expect(editor.undoOnce()).toBe(2);
  });

  it('unpublishes a map when it is deleted, so the game stops offering it', async () => {
    await publishPackMaps(registryWith([CUT_MAP]));
    const editor = editorOver(store);
    editor.open('reference:proving-grounds');

    const counts = editor.publishThenDelete();

    expect(counts.afterPublish).toBe(1);
    expect(counts.afterDelete).toBe(0);
  });

  it('writes nothing at all when no map is installed', async () => {
    await publishPackMaps(new PackRegistry());

    expect(store.get(PACK_MAPS_KEY)).toBe('[]');
  });
});
