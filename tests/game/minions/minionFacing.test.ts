/**
 * Which way a minion is pointing, and why anything needs to know.
 *
 * The three bodies used to be one disc wearing zero, one or two rings, so
 * nothing about a minion's drawing depended on its heading and no heading
 * existed. Two of the three silhouettes are asymmetric now — a blade out
 * front, an orb held ahead, a barrel — and a shape drawn in a frame that does
 * not turn is a shape that reads as facing east forever.
 *
 * `aimAngle` is that heading, and it is the one testable seam in a rewrite
 * that is otherwise `fill` and `circle`. Its whole job is the order of its
 * three answers: what this minion is fighting, else where it is walking, else
 * whatever it answered last.
 *
 * The last of those is not a nicety. `moveTo` leaves no facing behind and
 * `currentWaypoint` is `undefined` once a minion runs off the end of its lane
 * — at the enemy fountain, which is exactly where a wave spends its most
 * visible seconds — so an implementation that fell back to zero would snap
 * every arriving minion east on the frame it arrived.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Minion, { MinionPresets } from '../../../src/game/gameObject/attackableUnits/Minion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

const spawn = (game: TestGame, x: number, y: number, preset = MinionPresets.melee) =>
  new Minion({
    game,
    position: createVector(x, y),
    teamId: TeamId.BLUE,
    lane: Lane.MID,
    waypoints: getLaneWaypoints(Lane.MID, TeamId.BLUE),
    preset,
  });

describe('a minion’s heading', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('points at what it is fighting, over where it is walking', () => {
    const minion = spawn(game, 0, 0);
    const victim = new Champion({ game, position: createVector(0, 500), teamId: TeamId.RED });
    minion.targetLock = victim;

    // Straight down the +y axis is +PI/2 in screen space.
    expect(minion.aimAngle()).toBeCloseTo(Math.PI / 2, 5);

    victim.position.set(-500, 0);
    expect(Math.abs(minion.aimAngle())).toBeCloseTo(Math.PI, 5);
  });

  it('points along the lane when it is fighting nothing', () => {
    const minion = spawn(game, 0, 0);
    const waypoint = minion.currentWaypoint!;
    const expected = Math.atan2(waypoint.y, waypoint.x);

    expect(minion.targetLock).toBeNull();
    expect(minion.aimAngle()).toBeCloseTo(expected, 5);
  });

  it('ignores a lock that has died, rather than aiming at a corpse', () => {
    const minion = spawn(game, 0, 0);
    const victim = new Champion({ game, position: createVector(0, 500), teamId: TeamId.RED });
    minion.targetLock = victim;
    minion.aimAngle();

    victim.takeDamage(99_999, minion);
    expect(victim.isDead).toBe(true);
    const waypoint = minion.currentWaypoint!;
    expect(minion.aimAngle()).toBeCloseTo(Math.atan2(waypoint.y, waypoint.x), 5);
  });

  it('holds the last heading when it has run out of lane', () => {
    const minion = spawn(game, 0, 0);
    const victim = new Champion({ game, position: createVector(0, -400), teamId: TeamId.RED });
    minion.targetLock = victim;
    const held = minion.aimAngle();
    expect(held).toBeCloseTo(-Math.PI / 2, 5);

    // Walked off the end of the lane with nothing left to fight: no aim of any
    // kind. Zero would be a real angle and a wrong one.
    minion.targetLock = null;
    minion.waypointIndex = minion.waypoints.length;
    expect(minion.currentWaypoint).toBeUndefined();

    expect(minion.aimAngle()).toBe(held);
  });

  it('does not spin when it is standing on the thing it is aiming at', () => {
    // Two bodies at the same point have no direction between them, and
    // `atan2(0, 0)` is 0 — a real angle that means nothing.
    const minion = spawn(game, 100, 100);
    const victim = new Champion({ game, position: createVector(100, 100), teamId: TeamId.RED });
    minion.targetLock = victim;

    // Aimed somewhere that is *not* zero first, or an implementation that
    // returns `atan2(0, 0)` passes by coincidence — zero is due north-east and
    // also what the degenerate case answers.
    victim.position.set(100, -400);
    const north = minion.aimAngle();
    expect(north).toBeCloseTo(-Math.PI / 2, 5);
    victim.position.set(100, 100);

    expect(minion.aimAngle()).toBe(north);
  });
});

describe('the cart’s display box', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is wide enough for the barrel the other two bodies do not have', () => {
    // `drawCart`'s muzzle sits at `size * 0.86` and is `size * 0.2` across, so
    // the shape reaches `0.96` past the centre. The 1.4 box every minion used
    // to share is half that wide, so a cannon would lose its gun a beat before
    // the rest of it at the edge of the screen.
    const cannon = spawn(game, 0, 0, MinionPresets.cannon);
    const box = cannon.getDisplayBoundingBox()!;
    const reach = MinionPresets.cannon.size * 0.96;

    expect(box.w / 2).toBeGreaterThan(reach);
  });

  it('leaves the round bodies on the box they always had', () => {
    const melee = spawn(game, 0, 0, MinionPresets.melee);
    expect(melee.getDisplayBoundingBox()!.w).toBeCloseTo(MinionPresets.melee.size * 1.4, 5);
  });
});
