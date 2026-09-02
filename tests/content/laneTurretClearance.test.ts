/**
 * The bug `packs/riot/maps/summonersRiftGeometry.ts`'s own header and
 * `lol/tests/maps/Lanes.test.ts`'s `MIN_SEGMENT_TURRET_CLEARANCE`
 * check exist to prevent — a lane waypoint sitting on (or a lane segment
 * passing through) a turret's own body, so a wave drives into the building,
 * is shoved around it by `UnitCollisionSystem`, and re-acquires the same
 * line on the far side — was, until now, only ever checked against
 * Summoner's Rift's own waypoints. `referenceMap.test.ts` never checked a
 * lane against a turret at all.
 *
 * `packs/reference/aramGeometry.ts` shipped exactly that bug:
 * its one lane's waypoints included `{700,1700}` and `{1700,700}` — the
 * amber and a jade turret's own centres, verbatim. It was masked by finding
 * 1 (the faction bridge leaving every fountain unaffiliated, so no wave
 * ever spawned to walk the lane and hit it); fixing that exposes it.
 *
 * This file is the generalised guard: one pure clearance check, run against
 * *every* shipped map's own `lanes`/`slots.structure`, so the rule holds for
 * whichever map a player picks rather than only the one it was written
 * against. A rule that only holds for the map it was written against is not
 * a rule.
 */
import { describe, expect, it } from 'vitest';
import type { MapGeometry } from '../../src/content/ContentPack';
import { laneIssues } from '@/seams/index';
// Batch 4 task 6 moved Summoner's Rift's map out of `src/content/maps/` and
// into the pack.
import { summonersRiftGeometry } from '../../packs/riot/maps/summonersRiftGeometry';
import { aramGeometry } from '../../packs/reference/aramGeometry';

type Point = { x: number; y: number };

/**
 * The rule itself is **not here**, and that is the change worth reading.
 *
 * This file used to derive its own `TURRET_BLOCKED_RADIUS` (46 + 19), the pack's
 * `Lanes.test.ts` derived its own (46 + 17), and the map editor grew a third
 * copy of both. Three implementations of one rule, two of which already
 * disagreed by two pixels — and the drift had a direction: the editor said
 * `0 lỗi` over a lane running three pixels inside a wall that the pack's push
 * gate refused.
 *
 * `@moba2d/core/seams`' `laneIssues` is the single implementation now, loading
 * `src/mapEditor/mapRules.ts` — the editor has no bundler and cannot
 * import anything else, so the original lives on the narrower side. What is
 * left in this file is its own question: **every shipped map**, checked the
 * same way, which is the one thing a pack's own suite cannot ask.
 */
function checkMapLanesClearTurrets(mapName: string, geometry: MapGeometry): void {
  const turrets: [number, number][] = geometry.slots.structure.map(slot => [slot.x, slot.y]);
  expect(turrets.length, `${mapName} has no turrets to check against`).toBeGreaterThan(0);

  for (const lane of geometry.lanes ?? []) {
    expect(
      lane.waypoints.length,
      `${mapName} lane ${lane.id} has fewer than two waypoints`
    ).toBeGreaterThanOrEqual(2);
  }

  // Walls are deliberately not passed. The wall rule needs the map's own
  // polygons and this file is about the *turret* floors, which are the pair a
  // map can break by moving a tower — the thing a pack's slot table changes
  // and its lane data does not.
  const issues = laneIssues({
    lanes: (geometry.lanes ?? []).map(lane => ({
      id: `${mapName}/${lane.id}`,
      points: lane.waypoints.map(({ x, y }): [number, number] => [x, y]),
    })),
    walls: [],
    turrets,
  });

  expect(issues.map(issue => `${issue.text} @ ${issue.at.map(Math.round).join(',')}`)).toEqual([]);
}

describe('every shipped map keeps its lanes off its own turrets', () => {
  it("Summoner's Rift", () => {
    checkMapLanesClearTurrets("Summoner's Rift", summonersRiftGeometry);
  });

  it('ARAM', () => {
    checkMapLanesClearTurrets('ARAM', aramGeometry);
  });
});
