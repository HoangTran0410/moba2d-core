import type { ContentPackData, MapDefinition } from './ContentPack';
import type { PackRegistry } from './PackRegistry';
import { validatePackData } from './validate';

/**
 * Maps the player drew themselves, in the editor at `src/mapEditor/`.
 *
 * ## Why a pack, and why this one is different
 *
 * A map is the one thing in the pack contract that is *pure data*:
 * `MapDefinition` is a summary plus a `MapGeometry`, and nothing in it is a
 * class, a loader, or a spell. So a map somebody drew five seconds ago can go
 * through `PackRegistry.installData` — the same door a published pack uses,
 * with the same validator — and come out the far side indistinguishable from
 * a map that shipped in a pack. Everything downstream (`PregameConfig.mapId`,
 * `GameScene.startGame`, `TerrainMap`) needs no idea this pack exists.
 *
 * What it does *not* go through is `packSource.ts`: there is no manifest, no
 * fetch, and no `import()`. That is the whole point — the loop this replaces
 * was export JSON, commit it into a pack, serve the pack, paste the URL,
 * install, find the map in the picker. None of those steps say anything about
 * the map; they are the cost of the map having to arrive from *somewhere
 * else*. A map drawn on this origin never left.
 *
 * ## Never throws, never takes the game with it
 *
 * The bytes here are whatever is in `localStorage` — a half-drawn map, a map
 * from a newer editor, a key some other tab mangled. `installData` answers a
 * bad pack by throwing, and this runs inside `contentCatalog()`, which is
 * called from `main.ts`'s `setup()`. A throw there is a game that does not
 * boot, caused by a map the player was only doodling on.
 *
 * So every map is validated **on its own** before any of them are installed,
 * and one that fails is dropped with a console line naming it. The survivors
 * install together. A player whose map is missing from the picker can read
 * why in the console; a player whose map is fine never finds out the check
 * happened.
 */

/**
 * Where the editor publishes. Versioned in the name so a future change of
 * shape is a new key rather than a migration — the editor and this file ship
 * together now, but a browser can hold an old value while the tab that wrote
 * it is long gone.
 *
 * **It is a handover, not a library, and it used to behave like one.** The
 * editor writes here from exactly one place — the "Chơi thử" button — and
 * nothing ever took an entry back out: `unpublishLocal` exists in
 * `storage.js` and has no callers. So every map anybody had ever pressed
 * playtest on stayed in the game's map picker for good, under a name like
 * "Summoner's Rift (bản sửa)", with no way to remove it from the game side
 * at all. Reported with a screenshot of two of them.
 *
 * `takeStagedMaps` below is the whole fix: the key is emptied the moment its
 * contents are read.
 */
export const LOCAL_MAPS_KEY = 'moba2d-local-maps-v1';

/** The pack id every local map is qualified under: `local:<mapId>`. */
export const LOCAL_PACK_ID = 'local';

/**
 * A map as the editor writes it. Structurally a `MapDefinition` with the
 * geometry already resolved — the editor has the whole thing in memory and
 * has nothing to be lazy about.
 *
 * The editor also writes an `authoring` key *inside* `geometry`, holding the
 * shapes as drawn before it cut them into convex pieces. Core neither reads
 * nor rejects it (`checkMapGeometry` only refuses unknown *layers* inside
 * `terrain`), and it is what lets the editor reopen its own export without
 * the map coming back as a heap of triangles.
 */
export type LocalMap = MapDefinition;

/** Read the published list, or an empty one for every way that can fail. */
export function readLocalMaps(): LocalMap[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LOCAL_MAPS_KEY);
  } catch {
    // Storage disabled (private window, or a browser set to block site data).
    // No local maps is a correct answer here, not an error to report.
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalMap[]) : [];
  } catch {
    console.warn(`[local maps] ${LOCAL_MAPS_KEY} is not JSON; ignoring it`);
    return [];
  }
}

/** Empty the handover slot. Every way this can fail is a slot left alone. */
function clearLocalMaps(): void {
  try {
    localStorage.removeItem(LOCAL_MAPS_KEY);
  } catch {
    // Same three reasons `readLocalMaps` swallows, and the same answer: a
    // player who cannot write to storage still gets to play the map they
    // staged, they simply get to keep it too.
  }
}

/**
 * What this page load is playtesting — read once, and taken out of storage as
 * it is read.
 *
 * ## Why taking rather than reading
 *
 * A staged map is a *handover*, and the shape of the bug it caused is that it
 * was stored like a library: pressing "Chơi thử" put a map in the picker for
 * ever, and the game had no way to take one out. Emptying the slot on the way
 * past makes the lifetime the one the button actually promises — this map, on
 * this page load, because you just asked to try it.
 *
 * ## Why the result is remembered here rather than re-read
 *
 * `rebuildContentRegistry()` builds a fresh `PackRegistry` mid-session, when
 * the player installs a pack from the Packs screen. Re-reading storage there
 * would find an empty slot and the map being played would vanish out of the
 * picker underneath them. The taken list is module state for the life of the
 * document instead, which is exactly the lifetime being promised.
 *
 * A reload during a playtest therefore loses the map. That is the honest cost
 * and it is small: the editor tab is still open — it opens the game in a
 * *named* second tab precisely so it survives — and the button is one click.
 */
let staged: LocalMap[] | null = null;

export function takeStagedMaps(): LocalMap[] {
  if (staged === null) {
    staged = readLocalMaps();
    if (staged.length > 0) clearLocalMaps();
  }
  return staged;
}

/** Test seam: forget what this page load took, so the next read goes to storage. */
export function resetStagedMapsForTests(): void {
  staged = null;
}

/**
 * The pack a set of local maps forms, or `null` for none.
 *
 * `coreRange: '*'` is honest rather than lazy: a runtime pack declares a range
 * so core can refuse code built against a version it no longer matches, and
 * there is no code here to refuse. The map was drawn by this build, in this
 * page, against this validator.
 */
function packOf(maps: LocalMap[]): ContentPackData | null {
  if (maps.length === 0) return null;
  return {
    manifest: { id: LOCAL_PACK_ID, version: '1.0.0', coreRange: '*' },
    maps,
  };
}

/** Every map in `maps` that would install cleanly on its own. */
function keepValid(maps: LocalMap[]): LocalMap[] {
  const kept: LocalMap[] = [];
  for (const map of maps) {
    const candidate = packOf([map]);
    if (candidate === null) continue;
    const result = validatePackData(candidate);
    if (result.ok === false) {
      const id = typeof map?.id === 'string' ? map.id : '<no id>';
      console.warn(`[local maps] dropped "${id}":\n  ${result.errors.join('\n  ')}`);
      continue;
    }
    kept.push(map);
  }
  return kept;
}

/**
 * Install the map this page load is playtesting, if there is one.
 *
 * Called from `contentCatalog()` right after the bundled data, so a staged map
 * is in the picker from the first paint and every later
 * `rebuildContentRegistry()` still has it — see `takeStagedMaps` for why that
 * is a property of this module rather than of storage.
 */
export function installLocalMaps(registry: PackRegistry): void {
  const pack = packOf(keepValid(takeStagedMaps()));
  if (pack === null) return;
  try {
    registry.installData(pack);
  } catch (thrown) {
    // Every map in `pack` validated on its own a moment ago, so reaching here
    // means something the per-map check cannot see — a duplicate id between
    // two maps, or a pack id that is somehow already installed. Reported and
    // swallowed: the player loses their own maps from the picker, which is
    // recoverable, rather than the boot, which is not.
    console.error('[local maps] the pack was rejected', thrown);
  }
}
