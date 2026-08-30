import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Turret from '@/game/gameObject/structures/Turret';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Monster from '@/game/gameObject/attackableUnits/Monster';
import Minion, { MinionPresets } from '@/game/gameObject/attackableUnits/Minion';
import { Lane, getLaneWaypoints } from '@/game/lanes';
import TeamId from '@/game/enums/TeamId';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A tower and the jungle.
 *
 * `tests/game/structures/Turret.test.ts` does not run in a checkout without
 * the optional pack installed (`scripts/pack-dependent-tests.mjs` drops every
 * file that imports one), so every turret behaviour worth pinning lives out
 * here or in `combat/AggroPriority.test.ts`. This file is the jungle rung.
 *
 * Reported from a real match, in one sentence: a boss chased a champion out of
 * its pit, stood under that champion's own tower eating them, and the tower
 * did nothing. It could not: the query admitted champions and minions and
 * nothing else.
 *
 * The old exclusion was not arbitrary, though, and the fix has to keep what it
 * was protecting. A tower that simply *shot monsters* would farm the camp
 * beside it for ever — every respawn, unattended, all match — so the rung is
 * on the defend half only: a monster is a target while it is fighting one of
 * ours, and invisible the rest of the time. Both halves are below.
 */
describe('a turret and a jungle camp', () => {
  let game: TestGame;
  let turret: Turret;
  let defender: Champion;

  const CAMP = { x: 300, y: 0, r: 100 };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    defender = new Champion({ game, position: createVector(60, 0), teamId: TeamId.BLUE });
    game.setPlayer(defender);
  });
  afterEach(() => vi.unstubAllGlobals());

  const camp = (x = 120, y = 0) =>
    new Monster({
      game,
      preset: {
        name: 'Camp',
        camp: { ...CAMP },
        home: { x, y },
        speed: 2,
        size: 60,
        attackRange: 80,
        reviveTime: 100_000,
        health: 400,
        damage: 5,
      },
    } as ConstructorParameters<typeof Monster>[0]);

  it('shoots one that is eating an ally standing under it', () => {
    const boss = camp();
    indexObjects(game, [turret, defender, boss]);

    // What "dragged out of its pit and fighting you" is, in state: the camp
    // has hit the champion recently, which is the only thing the rung reads.
    defender.takeDamage(10, boss);

    expect(turret.findTarget()?.unit).toBe(boss);
  });

  it('leaves one alone that is doing nothing to anybody', () => {
    // The whole of the old exclusion's argument, kept. A camp that happens to
    // sit inside a tower's reach is not a thing the tower farms.
    const boss = camp();
    indexObjects(game, [turret, defender, boss]);

    expect(turret.findTarget()).toBeNull();
  });

  it('and never picks one over the wave it is supposed to hold', () => {
    // `nearest` is unchanged: minions, then champions, and no monster rung at
    // all. So even a camp closer than the wave loses to it once nobody is
    // being attacked by the camp.
    const boss = camp(80, 0);
    const creep = new Minion({
      game,
      position: createVector(200, 0),
      teamId: TeamId.RED,
      lane: Lane.MID,
      waypoints: getLaneWaypoints(Lane.MID, TeamId.RED),
      preset: MinionPresets.melee,
    });
    indexObjects(game, [turret, defender, boss, creep]);

    expect(turret.findTarget()?.unit).toBe(creep);
  });

  it('answers a diving champion before a chewing camp', () => {
    // Ordering inside the defend half: the jungle rung is below both champion
    // rungs, so a tower under a dive does not turn to look at a crab.
    //
    // Two allies, one victim each, and that is not incidental:
    // `recentAttacker` holds *the last* thing that hit a unit, so hitting one
    // champion with both would leave only one attacker on the board to match
    // any rung at all, and the case would pass whatever order the rungs are in.
    const boss = camp();
    const diver = new Champion({ game, position: createVector(100, 0), teamId: TeamId.RED });
    const second = new Champion({ game, position: createVector(40, 40), teamId: TeamId.BLUE });
    indexObjects(game, [turret, defender, second, boss, diver]);

    defender.takeDamage(10, boss);
    second.takeDamage(10, diver);

    expect(turret.findTarget()?.unit).toBe(diver);
  });

  it('holds the camp as a target instead of dropping it next frame', () => {
    // `stillValidTarget` is a hand-kept mirror of the query's filters, and a
    // type left out of it is a turret that acquires a target and forgets it on
    // the following frame — a bolt every scan interval and nothing else.
    const boss = camp();
    indexObjects(game, [turret, defender, boss]);
    defender.takeDamage(10, boss);

    turret.target = turret.findTarget()?.unit ?? null;
    expect(turret.target).toBe(boss);
    expect(turret.stillValidTarget(turret.target)).toBe(true);
  });
});
