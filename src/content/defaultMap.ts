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
 * It used to be `maps[0]`, and that was right only by accident. The content
 * pack was bundled and installed first, so its map was index 0; once the pack
 * became a runtime install, core's own `reference` pack installed first and a
 * fresh player pressing Chơi landed in the 2400px test arena instead of the
 * 6400px map they had installed a pack to play. Install order is not a
 * preference.
 *
 * The rule is that `reference` is core's *fallback*, never its opinion: it
 * wins when it is the whole of what is installed, which is the case
 * `verify-core-alone.mjs` exists to protect. Between two content packs,
 * install order still decides — there is nothing better to go on, and a
 * player with two packs installed has a picker.
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
  return (maps.find(map => !isReference(map)) ?? maps[0])?.id ?? null;
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
