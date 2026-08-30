import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster from '@/game/gameObject/attackableUnits/Monster';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Turret from '@/game/gameObject/structures/Turret';
import TeamId from '@/game/enums/TeamId';
import {
  createGame,
  indexObjects,
  stubGameGlobals,
  TEST_AVATAR_KEY,
  type TestGame,
} from '../fixtures';

/**
 * A camp fights champions, and nothing else.
 *
 * The rule was already written twice — `nearestThreat` queries
 * `PredefinedFilters.type(Champion)`, `forceAttackTarget` refuses anything
 * else — and missing from `aggroOn`, the seam whose own doc comment says every
 * path into a fight goes through it precisely so that a rule cannot be spread
 * over three call sites with a hole in it.
 *
 * What came through the hole was a turret. A camp that wandered into a lane
 * took a shell, retaliated through `takeDamage`, and stood under the tower
 * trading with a building it cannot kill and that cannot be pulled off its
 * foundation — and `alertCamp` brought its packmates along.
 */

let game: TestGame;

const CAMP = { x: 1_000, y: 1_000, r: 300 };

const wolf = (overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Wolf',
      avatar: TEST_AVATAR_KEY,
      camp: CAMP,
      speed: 2,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

const tower = () =>
  new Turret({
    game,
    position: createVector(CAMP.x + 120, CAMP.y),
    teamId: TeamId.BLUE,
    preset: { name: 'Tower', health: 400, damage: 12, attackRange: 430 },
  } as never);

describe('a camp and a turret', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: TeamId.RED }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not swing back when the turret shoots it', () => {
    const body = wolf();
    const gun = tower();
    indexObjects(game, [body, gun]);

    body.takeDamage(12, gun);

    expect(body.targetLock, 'a camp locked onto a building').toBeNull();
  });

  it('does not bring the pack along either', () => {
    // `alertCamp` goes through `aggroOn` too — the reason that seam exists —
    // so gating one gates both. A packmate woken onto a turret is the same
    // fight, with three bodies in it.
    const bitten = wolf();
    const mate = wolf();
    const gun = tower();
    indexObjects(game, [bitten, mate, gun]);

    bitten.takeDamage(12, gun);

    expect(mate.targetLock).toBeNull();
  });

  it('still answers a champion, which is the whole rule it kept', () => {
    // The falsification. Without it a camp that simply never retaliates would
    // pass both cases above.
    const body = wolf();
    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(CAMP.x + 60, CAMP.y);
    indexObjects(game, [body, enemy]);

    body.takeDamage(12, enemy);

    expect(body.targetLock).toBe(enemy);
  });

  /**
   * The other direction is untouched and is not re-proved here:
   * `tests/game/structures/TurretJungle.test.ts` already holds when a turret
   * shoots a camp and when it leaves one alone. Only the answering swing was
   * ever wrong, and only the answering swing changed.
   */
  it('is left where it stood, rather than walked into the tower', () => {
    // The consequence a player actually sees. A camp that retaliated navigated
    // to the turret, so the bug moved bodies out of the jungle and into a lane
    // as well as making them fight something they cannot kill.
    const body = wolf();
    const gun = tower();
    indexObjects(game, [body, gun]);
    const stood = { x: body.destination.x, y: body.destination.y };

    body.takeDamage(12, gun);

    expect(body.destination.x).toBe(stood.x);
    expect(body.destination.y).toBe(stood.y);
  });
});
