import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

/**
 * "Cannot walk" and "cannot be moved" pulled apart.
 *
 * They were one flag — `isImmovable = speed === 0` — and for scenery that is
 * right: a body with no legs must refuse to be pushed, or one hook strands it
 * somewhere it can never walk back from. The pair a boss usually wants is the
 * one that flag cannot express: **walks, but holds its ground**. A pit boss
 * that answers a champion backing off a step, and that cannot be dragged out
 * of the pit it is guarding.
 *
 * The refusal moved with the split. `Monster` used to answer a displacement
 * by snapping to its camp point every frame, which only works for a body that
 * cannot walk — one with legs would be pinned to its home instead of chasing.
 * `Dash` refuses the buff outright now, which holds for both.
 */

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const makeCamp = (overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: TEST_AVATAR_KEY,
      camp: { ...CAMP },
      speed: 2,
      size: 80,
      attackRange: 300,
      reviveTime: 100_000,
      health: 600,
      damage: 5,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

/** Applies a displacement the way another unit's spell would. */
const hook = (victim: Monster, by: Champion, toX: number): Dash => {
  const pull = new Dash(1_000, by, victim);
  pull.dashDestination = createVector(toX, CAMP.y);
  pull.dashSpeed = 40;
  pull.showTrail = false;
  victim.addBuff(pull);
  victim.updateBuffs();
  return pull;
};

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('what a body defaults to', () => {
  it('scenery still refuses to be moved, exactly as before', () => {
    const boss = makeCamp({ speed: 0 });
    expect(boss.isImmovable).toBe(true);
    expect(boss.hasLegs).toBe(false);
  });

  it('and a body with legs still takes its share of a shove', () => {
    const wolf = makeCamp();
    expect(wolf.isImmovable).toBe(false);
    expect(wolf.hasLegs).toBe(true);
  });

  it('so no camp written before the flag existed moves at all', () => {
    // The whole compatibility claim in one line: `anchored` absent reproduces
    // the old derivation for both answers.
    for (const speed of [0, 1.6, 2, 3.1]) {
      const camp = makeCamp({ speed });
      expect(camp.isImmovable).toBe(speed === 0);
    }
  });
});

describe('a body that walks and holds its ground', () => {
  const makeBoss = () => makeCamp({ anchored: true });

  it('is both at once, which one flag could not say', () => {
    const boss = makeBoss();
    expect(boss.isImmovable).toBe(true);
    expect(boss.hasLegs).toBe(true);
  });

  it('refuses a hook instead of being snapped back from one', () => {
    const boss = makeBoss();
    const thresh = new Champion({ game, teamId: 'other' });
    indexObjects(game, [boss, thresh]);
    boss.position.set(CAMP.x, CAMP.y);

    hook(boss, thresh, CAMP.x + 900);

    // Not merely back where it started — never sent anywhere.
    expect(boss.destination.x).toBe(CAMP.x);
    expect(boss.position.x).toBe(CAMP.x);
  });

  it('and the refusal is the buff going away, not a frame of jitter', () => {
    const boss = makeBoss();
    const thresh = new Champion({ game, teamId: 'other' });
    indexObjects(game, [boss, thresh]);

    const pull = hook(boss, thresh, CAMP.x + 900);

    expect(pull.toRemove || pull.dashDestination === null).toBe(true);
  });

  it('still walks where it wants to go', () => {
    // The half the old flag made impossible: re-anchoring to the camp point
    // every frame would pin this body to its home rather than let it chase.
    const boss = makeBoss();
    const runner = new Champion({ game, teamId: 'other' });
    runner.position.set(CAMP.x + 900, CAMP.y);
    indexObjects(game, [boss, runner]);
    boss.aggroOn(runner);
    const start = boss.position.x;

    for (let frame = 0; frame < 30; frame += 1) boss.update();

    expect(boss.position.x).toBeGreaterThan(start);
  });
});

describe('scenery keeps the behaviour it had', () => {
  it('is dragged nowhere, and is still standing on its own point', () => {
    const boss = makeCamp({ speed: 0 });
    const thresh = new Champion({ game, teamId: 'other' });
    indexObjects(game, [boss, thresh]);

    hook(boss, thresh, CAMP.x + 900);
    boss.update();

    expect(boss.position.x).toBe(CAMP.x);
  });
});

describe('a unit moving itself is untouched by any of this', () => {
  it('because the refusal only reads displacements applied by someone else', () => {
    // `sourceUnit === targetUnit` is how this codebase already tells "I moved"
    // from "I was moved", and grounding sits on the other side of the same
    // test. A blanket check would have deleted every champion dash.
    const champion = new Champion({ game, teamId: 'blue' });
    champion.isImmovable = true;
    indexObjects(game, [champion]);

    // Latched before the dash: `onActivate` moves the champion, so reading
    // `position.x` in the assertion would compare the answer to itself.
    const landing = champion.position.x + 400;
    const leap = new Dash(1_000, champion, champion);
    leap.dashDestination = createVector(landing, champion.position.y);
    leap.showTrail = false;
    champion.addBuff(leap);
    champion.updateBuffs();

    expect(leap.dashDestination).not.toBeNull();
    expect(champion.destination.x).toBe(landing);
  });
});
