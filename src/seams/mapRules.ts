import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * `@moba2d/core/seams`' map-geometry rules — can a minion body actually walk
 * this lane.
 *
 * ## One implementation, and this file is not it
 *
 * The rules live in `public/map-editor/js/mapRules.js`, as plain browser
 * JavaScript, and this module *loads that file* rather than restating it. The
 * direction is forced: the map editor has no bundler and no build step — it is
 * `<script>` tags talking to each other through globals — so it cannot import
 * TypeScript, while anything that can load TypeScript can also load a plain
 * script. The single source therefore has to sit on the narrower side.
 *
 * The alternative was tried for about an hour and is what this replaces: the
 * same three thresholds written out in the editor *and* in a pack's own
 * `tests/maps/Lanes.test.ts`. Two copies of a rule drift, and the drift has a
 * direction — the editor says `0 lỗi`, the pack's push gate says no, and the
 * person holding both is told the map is fine by the only tool that could
 * have helped them fix it. That is not hypothetical; it is the report this
 * module exists because of.
 *
 * ## Why `vm` and not an import
 *
 * `mapRules.js` assigns one object to `globalThis`. Loading it in a fresh
 * context and reading that object back is six lines and needs nothing of the
 * file except what it already does for the browser. An `export` would have
 * made it a module, which is the one thing the editor cannot load.
 *
 * Loaded once and memoised: the file never changes inside a process, and a
 * pack's map suite asks for it per case.
 *
 * ## What it takes
 *
 * Absolute world coordinates, on every side. The editor keeps polygons
 * relative to their shape's own origin and a pack's geometry does not, and
 * that difference is the caller's to resolve — a rule that accepted both
 * would be a rule with a mode to get wrong.
 */

/** One thing wrong with a lane, and where. */
export interface MapRuleIssue {
  text: string;
  /** World coordinates, for a UI that can fly the camera there. */
  at: [number, number];
}

/** A turret centre: a bare pair, or a slot that also knows whose it is. */
export type MapRuleTurret = [number, number] | { x: number; y: number; faction?: string };

export interface MapRuleInput {
  lanes: { id: string; points: [number, number][] }[];
  /** Every wall polygon, in world coordinates. */
  walls: [number, number][][];
  /** Every turret centre, in world coordinates. */
  turrets: MapRuleTurret[];
  /**
   * The map's own extent, needed only by the point-symmetry rule. Square maps
   * are the only shape the slot rules have an opinion about, so this is one
   * number rather than a width and a height.
   */
  size?: number;
  /** Fountains. Two of them, one per faction, is what the rules assume. */
  spawns?: { x: number; y: number; faction?: string }[];
  /** Where a wave forms up — `slots.minion`. */
  musters?: { x: number; y: number; faction?: string; lane?: string; scatter?: number }[];
  /** Jungle camps — `slots.neutral`. Only paired roles are graded. */
  neutrals?: { x: number; y: number; r?: number; role?: string }[];
}

interface MapRulesModule {
  MIN_LANE_WALL_CLEARANCE: number;
  TURRET_BODY_RADIUS: number;
  MINION_BODY_RADIUS: number;
  TURRET_BLOCKED_RADIUS: number;
  MIN_WAYPOINT_TURRET_CLEARANCE: number;
  MIN_SEGMENT_TURRET_CLEARANCE: number;
  LANE_COVERS_TURRET: number;
  BASE_RADIUS: number;
  laneIssues(map: MapRuleInput): MapRuleIssue[];
  structureIssues(map: MapRuleInput): MapRuleIssue[];
  mapIssues(map: MapRuleInput): MapRuleIssue[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where the implementation lives, from here.
 *
 * `../..` rather than a package resolve: this file ships inside the same
 * package as the editor (`package.json`'s `files` carries both `src` and
 * `public`), so the path is fixed relative to itself whether core is a
 * checkout or a `node_modules` copy.
 */
const RULES_FILE = resolve(HERE, '..', '..', join('public', 'map-editor', 'js', 'mapRules.js'));

let loaded: MapRulesModule | null = null;

/** The rules object the editor's own script defines. */
export function mapRules(): MapRulesModule {
  if (loaded) return loaded;
  const sandbox: Record<string, unknown> = { Math, JSON, console };
  const context = vm.createContext(sandbox);
  vm.runInContext(readFileSync(RULES_FILE, 'utf8'), context, { filename: RULES_FILE });
  const found = (context as { MapRules?: MapRulesModule }).MapRules;
  if (!found) {
    throw new Error(`${RULES_FILE} did not define MapRules — the editor and core have drifted`);
  }
  loaded = found;
  return loaded;
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
