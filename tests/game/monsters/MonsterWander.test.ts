import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, {
  MONSTER_WANDER_PAUSE_MS,
  MONSTER_WANDER_STEPS,
  type MonsterPresetData,
} from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A camp that ambles.
 *
 * The river crab is the reason it exists: it used to stand on its spawn point
 * until a champion came within 420px and then sprint, which is a trap, not an
 * animal. What it should do — and what the source game's does — is drift up
 * and down the river at a stroll and bolt only once something actually hits
 * it. Those are two different paces, which is why `wanderSpeed` is a field of
 * its own and not a flag beside `speed`.
 *
 * Every case here has an "and nothing else changed" twin, because `wanderSpeed`
 * is optional and its whole promise is that the nine camps written before it
 * behave identically. A suite that only exercised the new value would pass just
 * as happily if the default had moved.
 */

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const makeCamp = (overrides: Partial<MonsterPresetData> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: null,
      camp: { ...CAMP },
      speed: 3,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
      aggroRange: 200,
      ...overrides,
    },
  });

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('picking somewhere to go', () => {
  it('lands inside the camp it is allowed to be in', () => {
    // A radius **shorter than the longest step**, deliberately: with a wide
    // camp every sample lands inside it whether or not the region is consulted
    // at all, so the check would pass against an implementation that had no
    // region test in it. This one refuses the 260px step outright.
    const camp = makeCamp({ wanderSpeed: 1, camp: { x: 1_000, y: 1_000, r: 120 } });
    indexObjects(game, [camp]);

    // Every sample, not one: the walk is random, and a check that ran it once
    // would pass most of the time on a version that had no region test at all.
    for (let i = 0; i < 200; i++) {
      const point = camp.wanderPoint();
      expect(point).not.toBeNull();
      expect(camp.roamContains(point!.x, point!.y)).toBe(true);
    }
  });

  it('stays within one stroll of where it stands', () => {
    const camp = makeCamp({ wanderSpeed: 1 });
    indexObjects(game, [camp]);

    const longest = MONSTER_WANDER_STEPS[0];
    for (let i = 0; i < 50; i++) {
      const point = camp.wanderPoint()!;
      expect(Math.hypot(point.x - camp.position.x, point.y - camp.position.y)).toBeLessThanOrEqual(
        longest + 0.001
      );
    }
  });

  it('answers nothing rather than looping when it is cornered', () => {
    // A camp of radius 1 has no legal point at any of the three step lengths.
    // Without the null the caller would re-roll eighteen samples every scan
    // for the rest of the match.
    const camp = makeCamp({ wanderSpeed: 1, camp: { x: 1_000, y: 1_000, r: 1 } });
    indexObjects(game, [camp]);

    expect(camp.wanderPoint()).toBeNull();
  });
});

describe('the walk itself', () => {
  it('orders a first leg on its first idle tick', () => {
    const camp = makeCamp({ wanderSpeed: 1 });
    indexObjects(game, [camp]);
    const start = { x: camp.position.x, y: camp.position.y };

    camp.updateIdle();

    expect(camp.destination.x !== start.x || camp.destination.y !== start.y).toBe(true);
  });

  it('rests before the next one instead of walking without a pause', () => {
    const camp = makeCamp({ wanderSpeed: 1 });
    indexObjects(game, [camp]);

    camp.updateIdle();
    const first = { x: camp.destination.x, y: camp.destination.y };

    // Arrive. The rest clock is held full while walking and starts counting
    // the moment the body stops, so the very next tick must not re-order.
    camp.position.set(first.x, first.y);
    camp._scanCooldown = 0;
    camp.updateIdle();
    expect(camp.destination.x).toBe(first.x);
    expect(camp.destination.y).toBe(first.y);

    camp._wanderRest = 0;
    camp._scanCooldown = 0;
    camp.updateIdle();
    expect(camp.destination.x !== first.x || camp.destination.y !== first.y).toBe(true);
  });

  it('holds the clock at full while a leg is still being walked', () => {
    const camp = makeCamp({ wanderSpeed: 1 });
    indexObjects(game, [camp]);

    camp.updateIdle();
    camp._wanderRest = 5;
    camp._scanCooldown = 0;
    // Still short of the destination the first tick ordered.
    camp.updateIdle();

    expect(camp._wanderRest).toBe(MONSTER_WANDER_PAUSE_MS);
  });

  it('does not move a camp that declared no wander speed', () => {
    const camp = makeCamp();
    indexObjects(game, [camp]);
    const start = { x: camp.destination.x, y: camp.destination.y };

    for (let i = 0; i < 20; i++) {
      camp._scanCooldown = 0;
      camp.updateIdle();
    }

    expect(camp.destination.x).toBe(start.x);
    expect(camp.destination.y).toBe(start.y);
  });
});

describe('the two paces', () => {
  it('strolls while idle and runs once something is after it', () => {
    const camp = makeCamp({ speed: 3, wanderSpeed: 0.8, temperament: 'skittish' });
    const champion = new Champion({ game, teamId: 'other' });
    champion.position.set(CAMP.x + 60, CAMP.y);
    indexObjects(game, [camp, champion]);

    camp.update();
    expect(camp.stats.speed.baseValue).toBe(0.8);

    camp.takeDamage(5, champion);
    expect(camp.phase).toBe(Monster.PHASES.FLEE);
    camp.update();
    expect(camp.stats.speed.baseValue).toBe(3);
  });

  it('and never writes the stat at all for a camp with one pace', () => {
    // The guard is the whole reason this costs nothing for the camps that
    // predate it: a body with no `wanderSpeed` keeps whatever the constructor
    // gave it, so a buff or a map that wrote `speed.baseValue` is not stamped
    // over every frame.
    const camp = makeCamp({ speed: 3 });
    indexObjects(game, [camp]);

    camp.stats.speed.baseValue = 7;
    camp.update();

    expect(camp.stats.speed.baseValue).toBe(7);
  });
});
