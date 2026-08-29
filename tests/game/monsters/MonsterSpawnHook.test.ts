import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { createGame, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

/**
 * `MonsterAbility.onSpawn` — `onKilled`'s counterpart.
 *
 * The hook a camp needs to say something *before* anyone fights it: `cast`
 * runs only once a fight is already underway, and `onKilled` runs a life too
 * late. What it must get right is the count — once per life, never twice, and
 * again after a respawn. A hook that fired every frame would spawn a pit decal
 * sixty times a second, and one that fired only on the first life would leave
 * the pit unmarked for the rest of the match.
 */

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const spy = () => {
  const seen: Monster[] = [];
  return { seen, ability: { name: 'probe', cooldownMs: 1_000, range: -1, cast() {}, onSpawn: (monster: Monster) => void seen.push(monster) } };
};

const makeCamp = (abilities: unknown[], overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: TEST_AVATAR_KEY,
      camp: { ...CAMP },
      speed: 2,
      size: 80,
      attackRange: 50,
      reviveTime: 100,
      health: 300,
      abilities,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('a camp announces itself once per life', () => {
  it('on its first frame, not in its constructor', () => {
    const { seen, ability } = spy();

    const camp = makeCamp([ability]);
    // The world the callback reaches for has to exist by then, which is the
    // whole reason this is not in the constructor.
    expect(seen, 'the hook fired before the camp had a frame').toEqual([]);

    camp.update();

    expect(seen).toEqual([camp]);
  });

  it('and never again while it stays alive', () => {
    const { seen, ability } = spy();
    const camp = makeCamp([ability]);

    for (let frame = 0; frame < 40; frame += 1) camp.update();

    expect(seen).toHaveLength(1);
  });

  it('but again after it has been killed and come back', () => {
    const { seen, ability } = spy();
    const camp = makeCamp([ability]);
    camp.update();

    camp.takeDamage(9_999, new Champion({ game, teamId: 'other' }));
    expect(camp.isDead, 'the camp survived, so nothing here is tested').toBe(true);
    // Past its own 100ms revive time, one stubbed 16ms frame at a time.
    for (let frame = 0; frame < 20; frame += 1) camp.update();

    expect(camp.isDead).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it('and says nothing at all while it is a corpse', () => {
    const { seen, ability } = spy();
    const camp = makeCamp([ability], { reviveTime: 10_000 });
    camp.update();

    camp.takeDamage(9_999, new Champion({ game, teamId: 'other' }));
    for (let frame = 0; frame < 40; frame += 1) camp.update();

    expect(camp.isDead).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('leaves a camp whose abilities do not want it alone', () => {
    // Optional, like `onKilled`: every camp written before this hook existed
    // declares neither, and must not crash on a frame that looks for them.
    const camp = makeCamp([{ name: 'plain', cooldownMs: 1_000, range: -1, cast() {} }]);
    expect(() => camp.update()).not.toThrow();
  });
});
