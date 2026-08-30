import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markedTarget,
  nearestTarget,
  pickAggroTarget,
  type AggroLadder,
} from '../../../src/game/combat/AggroPriority';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Turret from '../../../src/game/gameObject/structures/Turret';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * Who a turret and a wave shoot at.
 *
 * Two behaviours players read as bugs are the subject. A wave never peeled for
 * its own carry — stand behind your minions, hit the enemy laner, and their
 * minions carried on trading. And nothing held a target: both re-picked
 * "nearest" every scan, so a minion the turret had taken to 10% walked one
 * pixel further out and the tower started again on a full-health one.
 *
 * The arithmetic half is driven with plain objects, because that is all
 * `AggroPriority` takes. The behaviour half builds real `Turret`s and
 * `Minion`s — `tests/game/structures/Turret.test.ts` and
 * `tests/game/minions/Minion.test.ts` both name the riot pack's map and are
 * therefore not collected in this checkout at all, so a rule proved only there
 * is a rule nothing here runs.
 */

type Fake = {
  name: string;
  position: { x: number; y: number };
  isDead: boolean;
  recentAttacker: Fake | null;
  kind: 'champion' | 'minion' | 'other';
};

const unit = (name: string, kind: Fake['kind'], x: number): Fake => ({
  name,
  kind,
  position: { x, y: 0 },
  isDead: false,
  recentAttacker: null,
});

const isChampion = (u: Fake) => u.kind === 'champion';
const isMinion = (u: Fake) => u.kind === 'minion';

/** The turret's ladder, in fake units: two rungs and a two-step floor. */
const LADDER: AggroLadder<Fake> = {
  defend: [
    { attacker: isChampion, victim: isChampion },
    { attacker: isMinion, victim: isChampion },
  ],
  nearest: [isMinion, isChampion],
};

const origin = { x: 0, y: 0 };

describe('the ladder itself', () => {
  it('picks the attacker on the best rung, not the nearest one', () => {
    const ally = unit('ally', 'champion', 10);
    const closeMinion = unit('close minion', 'minion', 20);
    const farChampion = unit('far champion', 'champion', 400);

    // Both are hitting the ally; only one of them can be the most recent, so
    // the rung is decided by two allies, which is how a real fight presents it.
    const second = unit('second ally', 'champion', 15);
    ally.recentAttacker = closeMinion;
    second.recentAttacker = farChampion;

    const marked = markedTarget(origin, [closeMinion, farChampion], [ally, second], LADDER);
    expect(marked?.unit).toBe(farChampion);
    expect(marked?.rank).toBe(0);
  });

  it('ignores an attacker the scanner could not shoot anyway', () => {
    // An ally hit from out of range, from stealth or through a wall. Aiming at
    // it would point the tower at something it will then refuse to fire on.
    const ally = unit('ally', 'champion', 10);
    const sniper = unit('sniper', 'champion', 5_000);
    ally.recentAttacker = sniper;

    expect(markedTarget(origin, [], [ally], LADDER)).toBeNull();
  });

  it('breaks a tie inside one rung by distance to the scanner', () => {
    const near = unit('near ally', 'champion', 10);
    const far = unit('far ally', 'champion', 300);
    const nearAttacker = unit('near attacker', 'champion', 40);
    const farAttacker = unit('far attacker', 'champion', 320);
    near.recentAttacker = nearAttacker;
    far.recentAttacker = farAttacker;

    const marked = markedTarget(origin, [farAttacker, nearAttacker], [near, far], LADDER);
    expect(marked?.unit).toBe(nearAttacker);
  });

  it('falls to nearest minion before nearest champion', () => {
    const champion = unit('champion', 'champion', 10);
    const minion = unit('minion', 'minion', 300);

    expect(nearestTarget(origin, [champion, minion], LADDER)).toBe(minion);
    expect(nearestTarget(origin, [champion], LADDER)).toBe(champion);
  });

  it('keeps what it is already shooting over a nearer body of the same kind', () => {
    // The whole point of holding. A tower that re-picked here spread its shots
    // across a wave and killed none of it.
    const held = unit('held', 'minion', 300);
    const nearer = unit('nearer', 'minion', 20);

    const picked = pickAggroTarget<Fake>({
      origin,
      current: held,
      held: true,
      candidates: [held, nearer],
      allies: [],
      ladder: LADDER,
    });
    expect(picked?.unit).toBe(held);
    expect(picked?.rank).toBe(Infinity);
  });

  it('gives it up to a better rung', () => {
    const held = unit('held', 'minion', 20);
    const ally = unit('ally', 'champion', 100);
    const attacker = unit('attacker', 'champion', 300);
    ally.recentAttacker = attacker;

    const picked = pickAggroTarget<Fake>({
      origin,
      current: held,
      held: true,
      candidates: [held, attacker],
      allies: [ally],
      ladder: LADDER,
    });
    expect(picked?.unit).toBe(attacker);
    expect(picked?.rank).toBe(0);
  });

  it('but not to an equal one, which would only thrash', () => {
    // Two enemies both hitting allies. Without the rank comparison the aggro
    // would trade back and forth every scan as they move around each other.
    const first = unit('first ally', 'champion', 50);
    const second = unit('second ally', 'champion', 60);
    const held = unit('held', 'champion', 300);
    const rival = unit('rival', 'champion', 40);
    first.recentAttacker = held;
    second.recentAttacker = rival;

    const picked = pickAggroTarget<Fake>({
      origin,
      current: held,
      held: true,
      currentRank: 0,
      candidates: [held, rival],
      allies: [first, second],
      ladder: LADDER,
    });
    expect(picked?.unit).toBe(held);
  });

  /**
   * The reported bug, in the four objects it takes to produce.
   *
   * `recentAttacker` is one slot. The held attacker is still hitting the ally
   * every swing, but the ally's slot names whoever swung *last*, so asking the
   * ladder a second time about a target it already gave you answers "on no rung
   * at all" — and every rival on a real rung then beats `Infinity`.
   *
   * There is exactly one ally here on purpose. With two, each attacker can own
   * a slot of its own and the held one keeps its rung by luck; a wave clash is
   * several enemies onto the same body, which is the case that broke.
   */
  it('holds a target whose victim has since been hit by somebody else', () => {
    const ally = unit('ally', 'champion', 50);
    const held = unit('held', 'minion', 300);
    const rival = unit('rival', 'minion', 40);
    // Both are hitting `ally`; `rival` landed the more recent swing, so the
    // one slot names it and `held` is no longer marked anywhere.
    ally.recentAttacker = rival;

    const picked = pickAggroTarget<Fake>({
      origin,
      current: held,
      held: true,
      // Rung 1 — where `held` was taken, back when its swing was the recent one.
      currentRank: 1,
      candidates: [held, rival],
      allies: [ally],
      ladder: LADDER,
    });
    expect(picked?.unit).toBe(held);
    expect(picked?.rank).toBe(1);
  });

  it('lets a held target climb when it starts hitting a champion', () => {
    // The remembered rung is a floor under the target, not a ceiling on it: a
    // minion taken off the nearest-body rung that then attacks an allied
    // champion is now defended-against at rung 1, and keeps that rung against
    // any later rival on the same one.
    const ally = unit('ally', 'champion', 50);
    const held = unit('held', 'minion', 300);
    ally.recentAttacker = held;

    const picked = pickAggroTarget<Fake>({
      origin,
      current: held,
      held: true,
      currentRank: Infinity,
      candidates: [held],
      allies: [ally],
      ladder: LADDER,
    });
    expect(picked?.unit).toBe(held);
    expect(picked?.rank).toBe(1);
  });

  it('takes the nearest when it is holding nothing', () => {
    const near = unit('near', 'minion', 10);
    const far = unit('far', 'minion', 300);

    const picked = pickAggroTarget<Fake>({
      origin,
      current: null,
      held: false,
      candidates: [far, near],
      allies: [],
      ladder: LADDER,
    });
    expect(picked?.unit).toBe(near);
    // The floor is not a rung, so nothing about it can be defended: the next
    // scan's `currentRank` has to be beatable by every rule in the ladder.
    expect(picked?.rank).toBe(Infinity);
  });
});

describe('a turret, in the world', () => {
  let game: TestGame;

  const minionOf = (teamId: string, x: number, y = 0) =>
    new Minion({
      game,
      teamId,
      position: createVector(x, y),
      waypoints: getLaneWaypoints(Lane.MID, teamId),
      lane: Lane.MID,
    });

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: TeamId.BLUE }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finishes the minion it started rather than the nearest one', () => {
    const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    const started = minionOf(TeamId.RED, 300);
    const nearer = minionOf(TeamId.RED, 60);
    indexObjects(game, [turret, started, nearer]);

    // Cold, it takes the nearest — that part never changed.
    expect(turret.findTarget()?.unit).toBe(nearer);
    // Holding one, it keeps it. This is what stopped a tower spraying its
    // shots across a wave without killing any of it.
    expect(turret.findTarget(started)?.unit).toBe(started);
  });

  it('answers a minion beating on a champion standing under it', () => {
    // The rung this ladder did not have. A minion hitting your ally used to be
    // shot only if it happened to be the nearest thing in range.
    const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    const ally = new Champion({ game, teamId: TeamId.BLUE, position: createVector(100, 0) });
    const attacker = minionOf(TeamId.RED, 260);
    const nearer = minionOf(TeamId.RED, 40);
    indexObjects(game, [turret, ally, attacker, nearer]);

    expect(turret.findTarget()?.unit).toBe(nearer);

    ally.takeDamage(1, attacker);
    expect(turret.findTarget()?.unit).toBe(attacker);
  });

  it('and puts an enemy champion doing it above that minion', () => {
    const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    const ally = new Champion({ game, teamId: TeamId.BLUE, position: createVector(100, 0) });
    const second = new Champion({ game, teamId: TeamId.BLUE, position: createVector(110, 0) });
    const minion = minionOf(TeamId.RED, 60);
    const diver = new Champion({ game, teamId: TeamId.RED, position: createVector(240, 0) });
    indexObjects(game, [turret, ally, second, minion, diver]);

    ally.takeDamage(1, minion);
    second.takeDamage(1, diver);

    expect(turret.findTarget()?.unit).toBe(diver);
  });
});

describe('a wave, in the world', () => {
  let game: TestGame;

  const minionOf = (teamId: string, x: number, y = 0) =>
    new Minion({
      game,
      teamId,
      position: createVector(x, y),
      waypoints: getLaneWaypoints(Lane.MID, teamId),
      lane: Lane.MID,
    });

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: TeamId.BLUE }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('peels onto the champion hitting its own carry', () => {
    // The headline. Standing behind your wave and poking the enemy laner used
    // to cost nothing at all: their minions carried on trading with yours.
    const defender = minionOf(TeamId.BLUE, 0);
    const carry = new Champion({ game, teamId: TeamId.BLUE, position: createVector(40, 0) });
    const enemyMinion = minionOf(TeamId.RED, 80);
    const poker = new Champion({ game, teamId: TeamId.RED, position: createVector(200, 0) });
    indexObjects(game, [defender, carry, enemyMinion, poker]);

    expect(defender.findTarget()?.unit).toBe(enemyMinion);

    carry.takeDamage(1, poker);
    expect(defender.findTarget()?.unit).toBe(poker);
  });

  it('answers a minion beating on an allied minion over a nearer one', () => {
    const defender = minionOf(TeamId.BLUE, 0);
    const beaten = minionOf(TeamId.BLUE, 60);
    const attacker = minionOf(TeamId.RED, 120);
    const bystander = minionOf(TeamId.RED, 30);
    indexObjects(game, [defender, beaten, attacker, bystander]);

    expect(defender.findTarget()?.unit).toBe(bystander);

    beaten.takeDamage(1, attacker);
    expect(defender.findTarget()?.unit).toBe(attacker);
  });

  it('holds the minion it is fighting instead of re-picking the nearest', () => {
    const defender = minionOf(TeamId.BLUE, 0);
    const started = minionOf(TeamId.RED, 200);
    const nearer = minionOf(TeamId.RED, 30);
    indexObjects(game, [defender, started, nearer]);

    expect(defender.findTarget()?.unit).toBe(nearer);
    expect(defender.findTarget(started)?.unit).toBe(started);
  });

  it('does not swap between two enemies beating on the same ally', () => {
    /**
     * The reported bug at the level a player sees it: a lane of minions
     * re-aiming several times a second with nobody having touched them.
     *
     * `beaten` is hit by `first` and then by `second`, and its one
     * `recentAttacker` slot ends up naming `second`. Re-deriving the rung of a
     * lock on `first` then answers "no rung", `second` sits on rung 2, and the
     * defender turns — every scan, forever, as the two of them take turns
     * swinging. Carrying the rung across the scan is what holds it.
     */
    const defender = minionOf(TeamId.BLUE, 0);
    const beaten = minionOf(TeamId.BLUE, 60);
    const first = minionOf(TeamId.RED, 120);
    const second = minionOf(TeamId.RED, 130);
    indexObjects(game, [defender, beaten, first, second]);

    beaten.takeDamage(1, first);
    const taken = defender.findTarget();
    expect(taken?.unit).toBe(first);

    // `second` swings next and takes over the slot. Nothing about `first` has
    // changed: it is in range, alive, and still hitting the same ally.
    beaten.takeDamage(1, second);
    expect(beaten.recentAttacker).toBe(second);

    const kept = defender.findTarget(taken!.unit, taken!.rank);
    expect(kept?.unit).toBe(first);
    expect(kept?.rank).toBe(taken!.rank);
  });

  it('drops a held target that walked out of its range', () => {
    // `held` is only true while the lock is still a candidate, so a target
    // that left is not kept by the hold rule.
    const defender = minionOf(TeamId.BLUE, 0);
    const gone = minionOf(TeamId.RED, 5_000);
    const near = minionOf(TeamId.RED, 30);
    indexObjects(game, [defender, gone, near]);

    expect(defender.findTarget(gone)?.unit).toBe(near);
  });
});
