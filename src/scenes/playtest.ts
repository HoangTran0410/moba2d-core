import { contentCatalog } from '@/content/catalog';
import { loadPregameConfig, savePregameConfig } from '@/game/config/PregameConfig';

/**
 * The editor's handover: `?playtest=local:my-map` means "boot straight onto
 * this map".
 *
 * ## Why a URL param and not a call
 *
 * The editor at `public/map-editor/` is a separate document — plain HTML and
 * globals, no bundler, nothing importable from here — so the two halves can
 * only talk through things a browser shares between documents on one origin.
 * The map itself goes through `localStorage` (`content/localMaps.ts`); this
 * param is the much smaller second question, "and start it now", which has no
 * business being persistent state. A navigation carries it exactly as far as
 * it should go and no further.
 *
 * ## Consumed once, whatever happens
 *
 * `MenuScene.enter()` runs on every "Quay lại", so a param left in the
 * address bar would drag the player back into the same match every time they
 * tried to reach the menu. The param is stripped before this function
 * answers — including when it names a map that is not installed, which is
 * the case where a retry would be most tempting and most useless.
 */
const PLAYTEST_PARAM = 'playtest';

/** Take the param out of the address bar, leaving the rest of the URL alone. */
function stripParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PLAYTEST_PARAM)) return;
    url.searchParams.delete(PLAYTEST_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // `replaceState` throws in a few sandboxed contexts. Nothing here is
    // worth failing the menu over; the worst case is one repeated jump.
  }
}

/**
 * The map this page load should boot onto, or `null`.
 *
 * Answers `null` for a map that is not installed rather than letting the id
 * through. `GameScene.startGame()` would survive it — it falls back to the
 * first installed map — but silently starting *a different map* than the one
 * the editor just published is the confusing answer. Dropping out to the menu
 * is the honest one, and the console line says which id went missing.
 */
export function takePlaytestMapId(): string | null {
  let requested: string | null = null;
  try {
    requested = new URL(window.location.href).searchParams.get(PLAYTEST_PARAM);
  } catch {
    return null;
  }
  stripParam();
  if (requested === null || requested === '') return null;

  const installed = contentCatalog()
    .maps()
    .some(map => map.id === requested);
  if (!installed) {
    console.warn(`[playtest] no installed map called "${requested}"`);
    return null;
  }
  return requested;
}

/**
 * Point the persisted config at `mapId`, so the match that is about to start
 * boots onto it.
 *
 * Persisted rather than passed, because the config *is* the channel: nothing
 * between here and `GameScene.startGame()` takes a map argument, and
 * inventing one for this path would be a second way to say what
 * `PregameConfig.mapId` already says. The side effect is deliberate and
 * matches what the setup screen does when a player picks a map by hand — the
 * choice sticks, so pressing "Chơi" again replays the map they were testing.
 */
export function armPlaytestMap(mapId: string): void {
  savePregameConfig({ ...loadPregameConfig(), mapId });
}
