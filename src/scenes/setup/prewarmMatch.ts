import { contentCatalog } from '@/content/catalog';
import { activeMapOf } from '@/content/activeMap';
import { resolveMapId } from '@/content/defaultMap';

/**
 * The work a match start used to do in its own first frames, done while the
 * player is still choosing champions.
 *
 * ## Why here
 *
 * The pregame screen is the one place that knows which map is about to be
 * played *and* has a main thread doing nothing: it is a form, and the player
 * is reading it. Everything below is a pure function of the chosen map or of
 * the installed catalogue, so none of it needs a `Game`, a canvas, or a
 * decision the player has not made yet.
 *
 * What it removes from the first seconds of a match, measured at a 4x CPU
 * throttle:
 *
 *   - **the navigation grid**, 81ms and 160,000 cells, built inside
 *     `new Game` where nothing else can run until it finishes;
 *   - **the rest of the spell catalogue**, 30-60 chunk fetches that
 *     `GameScene` fired on an idle callback *after* the match had opened, so
 *     the modules evaluated over the top of a running game.
 *
 * ## Every match module is reached through `import()`
 *
 * `pregameBootPath.test.ts` refuses a static edge from this screen into the
 * match, and it is right to: the pregame chunk is what a player downloads to
 * press Play, and a static import here would fold the whole engine into it —
 * the exact bundling failure that test exists for. A dynamic import puts the
 * fetch *inside* the warm-up instead, which is strictly better than avoiding
 * it: the match's own chunk is then one more thing already in memory when the
 * match starts, rather than one more thing it waits for.
 *
 * ## Nothing here may fail loudly
 *
 * Every one of these is an optimisation with a correct slower path behind it:
 * `new Game` builds its own grid if none was cached, and `preset.classForId`
 * falls back to a basic attack for a chunk that never arrived. So this catches
 * everything and reports nothing — a warm-up that broke the screen it runs on
 * would be worse than the cost it saves.
 */
export function prewarmMatch(mapId: string | undefined): void {
  // Fire-and-forget, and deliberately not awaited by anything: the player may
  // press Bắt Đầu a frame later, and the match must not wait on a warm-up.
  void warmSpells();
  void warmNavigation(mapId);
}

const warmSpells = async (): Promise<void> => {
  try {
    const { loadRemainingSpells } = await import('@/game/spellRegistry');
    await loadRemainingSpells();
  } catch {
    // `loadRemainingSpells` already swallows a failed chunk per spell; reaching
    // here means the whole batch threw, which a match survives on its own.
  }
};

const warmNavigation = async (mapId: string | undefined): Promise<void> => {
  try {
    const maps = contentCatalog().maps();
    if (!maps.length) return;
    // The same resolution `GameScene.startGame` makes, including the fallback
    // for a config naming a map an uninstalled pack used to provide — warming
    // a different map than the one about to be played would be worse than
    // warming nothing.
    const summary = maps.find(map => map.id === resolveMapId(maps, mapId));
    if (!summary) return;
    const geometry = await contentCatalog().loadMapGeometry(summary.id);
    if (!geometry) return;
    const active = activeMapOf(summary, geometry);
    const [{ prewarmNavigation }, { default: TerrainMap }] = await Promise.all([
      import('@/game/nav/NavigationSystem'),
      import('@/game/gameObject/map/TerrainMap'),
    ]);
    prewarmNavigation(active.id, TerrainMap.wallPolygonsOf(active), active.size);
  } catch {
    // A map that will not load here is one `GameScene` reports properly.
  }
};
