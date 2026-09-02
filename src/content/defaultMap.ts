/**
 * Which map a match plays when the config names none — or names one that is
 * no longer installed.
 *
 * **A leaf on purpose: no imports.** Both callers need the same answer and
 * they sit on opposite sides of a chunk boundary. `GameScene.startGame` is the
 * match; `hud/config/MatchTab.vue` is the picker, which is carved into the
 * `pregame` chunk and may not import a `src/game/` runtime value. The picker's
 * own comment already said "that fallback lives in the match, not the picker,
 * so the picker needs the same one" — two copies of a rule, which is how they
 * come to disagree.
 *
 * It used to be `maps[0]`, and that was right only by accident: the content
 * pack was bundled and installed first, so its map was index 0. Once the pack
 * became a runtime install the order flipped, and install order is not a
 * preference — so the rule became "prefer a content pack's map, and let
 * `reference` win only when it is the whole of what is installed".
 *
 * ## Why that rule is now the other way round
 *
 * It was written when core's own map was Sân Thử Nghiệm: a 2400px navigation
 * fixture with five terrain polygons, built to be *hostile to the pathfinder*
 * rather than to be played. Landing a fresh player there instead of on the
 * 6400px map they installed a pack to get was the bug, and "reference is
 * core's fallback, never its opinion" was the right way to say it.
 *
 * Core does not ship that map any more. `reference:aram` is a real 4000px
 * single-lane map drawn in core's own editor, and it is the map this game
 * means when it has no other instruction — `config/PregameConfig.ts`'s
 * `DEFAULT_MAP_ID` names it for exactly that reason. Preferring a pack's map
 * here would have left two rules pointing opposite ways, which is the failure
 * this module's own header exists about: the default a fresh player gets and
 * the default a stale id falls to would be different maps.
 *
 * Install order still decides the rest, and only the rest: with the reference
 * pack somehow absent, the first content pack's map wins, which is the same
 * answer as before for the only case that ever reached it.
 */

/** Core's own bundled pack. Its map exists so the game is playable with nothing installed. */
const REFERENCE_PACK_ID = 'reference';

/** The shape both callers already hold — `MapSummary`, narrowed to what this reads. */
interface MapLike {
  id: string;
}

const isReference = (map: MapLike): boolean => map.id.startsWith(`${REFERENCE_PACK_ID}:`);

/** `null` when nothing is installed, so a caller has to say what that means. */
export function defaultMapId(maps: readonly MapLike[]): string | null {
  return (maps.find(isReference) ?? maps[0])?.id ?? null;
}

/**
 * The same choice, resolved against a config's stored `mapId`.
 *
 * A stale id — a map an uninstalled pack used to provide — falls through to
 * the default rather than throwing: a config naming a map that no longer
 * exists must not brick the menu.
 */
export function resolveMapId(
  maps: readonly MapLike[],
  preferred: string | undefined
): string | null {
  return maps.find(map => map.id === preferred)?.id ?? defaultMapId(maps);
}
