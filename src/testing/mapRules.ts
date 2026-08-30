/**
 * `@moba2d/core/testing/maps` — the map rules a pack's own gate runs.
 *
 * ## Why a subpath of its own
 *
 * The rules are implemented once, in `public/map-editor/js/mapRules.js`, and
 * republished typed by `src/seams/mapRules.ts`. A pack cannot import that: a
 * pack's tests are held to a named list of core subpaths
 * (`tests/noCoreReach.test.ts`), and `@moba2d/core/seams` is not on it and
 * should not be — that barrel carries the source scanners and the boundary
 * checker, which are core's own tooling and nothing a pack has business
 * reaching into.
 *
 * So this file is the door, for the same reason `./testing/items` is one: the
 * shared rules a pack legitimately needs, published on their own, without
 * dragging a barrel of unrelated machinery along with them. It re-exports and
 * adds nothing — a second implementation here would be the exact failure the
 * whole arrangement exists to prevent.
 *
 * ## What a pack does with it
 *
 * Loads its own map's geometry and hands it over whole:
 *
 * ```ts
 * import { mapIssues } from '@moba2d/core/testing/maps';
 * expect(mapIssues({ size, lanes, walls, turrets, spawns, musters, neutrals })).toEqual([]);
 * ```
 *
 * Whatever comes back has already been drawn on the canvas by the map editor,
 * at the coordinates in the message. That is the point of there being one
 * implementation: a red push gate is something to go and fix, not something to
 * go and find.
 */
export {
  laneIssues,
  laneRuleLimits,
  mapIssues,
  structureIssues,
  type MapRuleInput,
  type MapRuleIssue,
  type MapRuleTurret,
} from '@/seams/mapRules';
