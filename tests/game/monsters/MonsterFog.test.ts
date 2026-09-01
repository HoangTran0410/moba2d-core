import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, {
  MONSTER_LAST_SEEN_ARRIVE_PX,
} from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { canSee } from '../../../src/game/combat/Vision';
import {
  createGame,
  indexObjects,
  stubGameGlobals,
  TEST_AVATAR_KEY,
  type TestGame,
} from '../fixtures';

/**
 * **A camp obeys the fog, in both directions.**
 *
 * Two reports from one match, and they are the same omission seen from either
 * end. `nearestThreat` has always asked `visibleTo` before *picking* a target,
 * so walking past a crab in a brush never startled it — but nothing asked
 * again afterwards, and nothing on a camp's own swing ever called
 * `revealForAttack`. So a camp could hit you out of a brush you could not see
 * into, and a camp already chasing you kept hitting after you hid in one.
 *
 *   > "quái rừng đứng trong bụi, tướng của t ko có tầm nhìn, nhưng nó vẫn đánh t"
 *   > "quái đang đuổi theo t, mà t trốn vào bụi, quái vẫn đánh được?"
 *
 * `isInsideBush` is set by `TerrainMap` from the real polygons; in a context
 * with no map it is the boolean that still holds, which is what these cases
 * set. `Vision.viewIsClear` reads exactly that.
 */

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const makeWolf = (overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Wolf',
      // The fixture key, not a pack's. A real pack avatar only resolves once
      // some *other* test file in the same worker has installed that pack, so
      // naming one here passes alone and fails in a full run — which is
      // exactly how this file first went red.
      avatar: TEST_AVATAR_KEY,
      camp: CAMP,
      speed: 2,
      size: 40,
      attackRange: 60,
      reviveTime: 100,
      health: 500,
      damage: 5,
      // Stated, not defaulted. At the 1500ms default a wolf swings once in a
      // thirty-frame window, so "it did not swing while blind" would pass for
      // a camp that was merely still on cooldown — the exact shape of vacuous
      // pass this file exists to avoid. At 200ms every window below spans
      // several swings.
      attackInterval: 200,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

/**
 * Frames, driven through the object manager rather than `wolf.update()`.
 *
 * A camp's swing is a real object with a real travel time — it is what carries
 * the damage, and it only runs when the manager ticks it. Calling the wolf's
 * own update alone chases and swings and never hurts anybody, which makes
 * "did it stop attacking" pass for the wrong reason.
 */
const frames = (count: number) => {
  for (let frame = 0; frame < count; frame++) game.objectManager.update();
};

/** A champion standing where a wolf can reach it. */
const championAt = (x: number, y: number) => {
  const champion = new Champion({ game, teamId: 'player-uuid' });
  champion.position.set(x, y);
  return champion;
};

beforeEach(() => {
  stubGameGlobals();
  vi.stubGlobal('deltaTime', 16);
  game = createGame();
});
afterEach(() => vi.unstubAllGlobals());

describe('a camp swinging out of a brush', () => {
  it('gives itself away, the way a champion’s basic attack does', () => {
    const wolf = makeWolf();
    wolf.position.set(CAMP.x, CAMP.y);
    wolf.isInsideBush = true;
    const player = championAt(CAMP.x + 40, CAMP.y);
    game.setPlayer(player);
    indexObjects(game, [wolf, player]);

    expect(canSee(player, wolf), 'the brush should be hiding it to begin with').toBe(false);

    wolf.launchAttack(player, 100);

    // Not "the wolf is visible": the reveal is granted to the attacker's
    // enemies and lasts a while, which is the whole of League's rule.
    expect(canSee(player, wolf)).toBe(true);
  });

  it('is not revealed by merely standing there', () => {
    const wolf = makeWolf();
    wolf.position.set(CAMP.x, CAMP.y);
    wolf.isInsideBush = true;
    const player = championAt(CAMP.x + 40, CAMP.y);
    game.setPlayer(player);
    indexObjects(game, [wolf, player]);

    frames(30);

    expect(canSee(player, wolf)).toBe(false);
  });
});

describe('a camp chasing somebody who ducks into a brush', () => {
  /** A wolf mid-fight with the player, both in the open. */
  const fightInProgress = () => {
    const wolf = makeWolf();
    wolf.position.set(CAMP.x, CAMP.y);
    const player = championAt(CAMP.x + 50, CAMP.y);
    game.setPlayer(player);
    indexObjects(game, [wolf, player]);
    wolf.aggroOn(player);
    return { wolf, player };
  };

  /**
   * Counted in swings, not in health.
   *
   * The first draft of this asserted the target's health stopped changing and
   * failed against the fix working perfectly: a champion standing still
   * *regenerates*, so the number moved by -0.26 over the window and `toBe`
   * was measuring base regen. A swing is also the thing the rule is actually
   * about — a committed one still lands, and should.
   */
  it('stops swinging the moment it loses sight', () => {
    const { wolf, player } = fightInProgress();
    const swings = vi.spyOn(wolf, 'launchAttack');

    frames(30);
    expect(swings.mock.calls.length, 'the control arm never swung at all').toBeGreaterThan(0);

    player.isInsideBush = true;
    swings.mockClear();
    frames(60);

    expect(swings).not.toHaveBeenCalled();
  });

  it('walks to where it last saw them rather than tracking them through the brush', () => {
    const { wolf, player } = fightInProgress();
    frames(10);

    const lastSeen = { x: player.position.x, y: player.position.y };
    player.isInsideBush = true;
    // And then keeps running, well past the camp's reach.
    player.position.set(CAMP.x + 260, CAMP.y);

    frames(5);

    const chasingLive = Math.hypot(
      wolf.destination.x - player.position.x,
      wolf.destination.y - player.position.y
    );
    const chasingMemory = Math.hypot(
      wolf.destination.x - lastSeen.x,
      wolf.destination.y - lastSeen.y
    );
    expect(chasingMemory, 'it is still following the live position').toBeLessThan(chasingLive);
    expect(chasingMemory).toBeLessThanOrEqual(MONSTER_LAST_SEEN_ARRIVE_PX);
  });

  it('goes home once it has been blind for its give-up delay', () => {
    const { wolf, player } = fightInProgress();
    frames(5);
    expect(wolf.phase).toBe(Monster.PHASES.ATTACK);

    // Hidden, and standing right beside the camp — so the leash never trips
    // and only losing sight can end this.
    player.isInsideBush = true;
    player.position.set(CAMP.x + 50, CAMP.y);

    vi.stubGlobal('deltaTime', 100);
    frames(Math.ceil(wolf.giveUpDelayMs / 100) + 2);

    expect(wolf.phase).not.toBe(Monster.PHASES.ATTACK);
  });

  /**
   * The other half, and the reason hiding is a delay rather than an escape:
   * a camp standing in the same brush can see you again, and resumes.
   */
  it('picks the fight back up once it is in the brush with them', () => {
    const { wolf, player } = fightInProgress();
    frames(5);

    player.isInsideBush = true;
    const swings = vi.spyOn(wolf, 'launchAttack');
    frames(30);
    expect(swings).not.toHaveBeenCalled();

    // It got there.
    wolf.isInsideBush = true;
    frames(30);

    expect(swings).toHaveBeenCalled();
  });
});
