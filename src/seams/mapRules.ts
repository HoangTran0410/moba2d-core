
/**
 * `@moba2d/core/seams`' map-geometry rules — can a minion body actually walk
 * this lane.
 *
 * ## One implementation, and this file is not it
 *
 * The rules live in `src/mapEditor/mapRules.ts`, beside the editor that draws
 * the maps they judge, and this module *re-exports them typed* rather than
 * restating them. Which side holds the implementation used to be forced: the
 * editor had no bundler and no build step, so it could not import TypeScript
 * and the single source had to sit on the narrower side. The editor is a Vite
 * entry now, so the constraint is gone — but the answer did not change, and
 * should not: the rules belong next to the tool that has to explain them to
 * whoever is drawing a map.
 *
 * The alternative was tried for about an hour and is what this replaces: the
 * same three thresholds written out in the editor *and* in a pack's own
 * `lol/tests/maps/Lanes.test.ts`. Two copies of a rule drift, and the drift has a
 * direction — the editor says `0 lỗi`, the pack's push gate says no, and the
 * person holding both is told the map is fine by the only tool that could
 * have helped them fix it. That is not hypothetical; it is the report this
 * module exists because of.
 *
 * A blank line's worth of history, because it explains the shape of this file:
 * the sentence above was true while the two sides could only meet through a
 * `node:vm` bridge, and the bridge is what made a *seam* necessary at all.
 *
 * ## It used to load that file through `node:vm`
 *
 * Because the editor was plain `<script>` tags with no build, `mapRules.js`
 * could not be a module — so this file ran it in a fresh V8 context and read
 * the object it published to `globalThis`. Six lines, and they worked, and
 * they were the price of the editor being outside the compiler.
 *
 * The editor is a Vite entry now, so the price is gone: this is an ordinary
 * `import`, type-checked like anything else, and a rename on either side is a
 * build failure rather than a `did not define MapRules` thrown at runtime by
 * a bridge nobody was looking at.
 *
 * ## What it takes
 *
 * Absolute world coordinates, on every side. The editor keeps polygons
 * relative to their shape's own origin and a pack's geometry does not, and
 * that difference is the caller's to resolve — a rule that accepted both
 * would be a rule with a mode to get wrong.
 */
// Relative, not `@/` — the convention every other module in this directory
// follows, and it is load-bearing rather than stylistic: these ship inside the
// published package and run from `moba2d-check-seams`, a bin with no bundler
// and no alias. `@/mapEditor/mapRules` type-checked perfectly and made the bin
// exit 1 with `Cannot find module` on every invocation.
import {
  MapRules,
  type MapRuleInput,
  type MapRuleIssue,
  type MapRulesModule,
} from '../mapEditor/mapRules';

/**
 * The shapes these rules take and return.
 *
 * Declared beside the implementation and re-exported here, rather than the
 * other way round: a contract that lives apart from the code satisfying it is
 * a contract that can be edited without the code noticing. They were declared
 * here while the implementation was untyped browser JavaScript and *could not*
 * state them — which is exactly the drift the move to a Vite entry ended.
 *
 * The names stay exported from `@moba2d/core/seams`, where a pack's map suite
 * already imports them.
 */
export type {
  MapRuleIssue,
  MapRuleTurret,
  MapRuleInput,
  MapRulesModule,
} from '../mapEditor/mapRules';


/**
 * The rules object the editor's own module defines.
 *
 * Kept as a function rather than re-exporting `MapRules` directly so every
 * caller below reads the same way it did through the `vm` bridge, and so the
 * structural check against `MapRulesModule` happens in exactly one place.
 */
export function mapRules(): MapRulesModule {
  return MapRules;
}

/**
 * Everything wrong with these lanes, or an empty list.
 *
 * The same call the editor's "Kiểm tra" panel makes, on the same numbers, so
 * a pack's suite and the tool that draws its maps cannot disagree about
 * whether a map is shippable.
 */
export function laneIssues(map: MapRuleInput): MapRuleIssue[] {
  return mapRules().laneIssues(map);
}

/**
 * Everything wrong with how the map's *slots* relate to each other.
 *
 * A separate call from `laneIssues` because it answers a separate question —
 * whether a lane is walkable, versus whether the things placed around it hang
 * together — and because a caller holding only lanes and walls can still ask
 * the first. `mapIssues` is both.
 *
 * These rules replace the coordinate tables a pack's map suite used to carry:
 * "blue's top turrets are these three points", "a lane starts at (400, 6075)",
 * "each row has eleven turrets". A table like that is not a rule, it is a
 * photograph of the map on the day it was written — drag one turret in the
 * editor and nine assertions go red without one of them naming anything that
 * is actually wrong.
 */
export function structureIssues(map: MapRuleInput): MapRuleIssue[] {
  return mapRules().structureIssues(map);
}

/** Both sets, which is what the editor's panel and a pack's gate both want. */
export function mapIssues(map: MapRuleInput): MapRuleIssue[] {
  return mapRules().mapIssues(map);
}

/** The thresholds, for a test that wants to state one in its own message. */
export const laneRuleLimits = (): Readonly<{
  wall: number;
  turretBody: number;
  minionBody: number;
  turretBlocked: number;
  waypointTurret: number;
  segmentTurret: number;
  laneCoversTurret: number;
  baseRadius: number;
}> => {
  const rules = mapRules();
  return {
    wall: rules.MIN_LANE_WALL_CLEARANCE,
    turretBody: rules.TURRET_BODY_RADIUS,
    minionBody: rules.MINION_BODY_RADIUS,
    turretBlocked: rules.TURRET_BLOCKED_RADIUS,
    waypointTurret: rules.MIN_WAYPOINT_TURRET_CLEARANCE,
    segmentTurret: rules.MIN_SEGMENT_TURRET_CLEARANCE,
    laneCoversTurret: rules.LANE_COVERS_TURRET,
    baseRadius: rules.BASE_RADIUS,
  };
};
