/**
 * The map's economy, reaching the four places gold actually moves.
 *
 * `resolveEconomy` is covered on plain objects in `config/mapTuning.test.ts`;
 * this is the other half — that the resolved numbers are *applied*, which is
 * the part a pure-function test cannot see. A bounty resolved and never
 * assigned is a config knob that does nothing, and it would look correct in
 * both the schema and the resolver.
 *
 * Builds its own spawner context rather than importing
 * `tests/game/minions/helpers.ts`, which reaches a content pack this checkout
 * may not have (`CLAUDE.md`: new tests must not import through it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapTuning } from '../../../src/content/ContentPack';
import { DEFAULT_ECONOMY } from '../../../src/game/config/mapTuning';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import MinionSpawner from '../../../src/game/managers/MinionSpawner';
import TeamId from '../../../src/game/enums/TeamId';
import { resetLanesForTests, setActiveLanes } from '../../../src/game/lanes';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

type SpawnerGame = TestGame & {
  fountains: Fountain[];
  minionMuster: { teamId?: string; lane: string; x: number; y: number; scatter: number }[];
  mapTuning?: MapTuning;
};

const LANE = 'mid';

const spawnerGame = (tuning?: MapTuning): SpawnerGame => {
  const game = createGame() as SpawnerGame;
  game.mapTuning = tuning;
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  game.fountains = [
    new Fountain({ game, preset: { name: 'A', x: 200, y: 200, r: 100, teamId: TeamId.BLUE } }),
    new Fountain({ game, preset: { name: 'B', x: 3_000, y: 3_000, r: 100, teamId: TeamId.RED } }),
  ];
  game.minionMuster = [
    { teamId: TeamId.BLUE, lane: LANE, x: 400, y: 400, scatter: 0 },
    { teamId: TeamId.RED, lane: LANE, x: 2_800, y: 2_800, scatter: 0 },
  ];
  return game;
};

beforeEach(() => {
  stubGameGlobals();
  // `tests/setup.ts` installs an ambient lane set per file; reset before
  // replacing it or the two stack.
  resetLanesForTests();
  setActiveLanes([
    {
      id: LANE,
      from: 'blue',
      to: 'red',
      waypoints: [
        { x: 200, y: 200 },
        { x: 1_600, y: 1_600 },
        { x: 3_000, y: 3_000 },
      ],
    },
  ]);
});
afterEach(() => {
  resetLanesForTests();
  vi.unstubAllGlobals();
});

describe('champions', () => {
  it('start with core\'s purse when the map says nothing', () => {
    const game = spawnerGame();
    const champion = new Champion({ game, teamId: TeamId.BLUE });

    expect(champion.wallet!.balance).toBe(DEFAULT_ECONOMY.startingGold);
    expect(champion.goldBounty).toBe(DEFAULT_ECONOMY.championBounty);
  });

  it('leave the fountain with what the map gave them', () => {
    const game = spawnerGame({ economy: { startingGold: 1_500, championBounty: 40 } });
    const champion = new Champion({ game, teamId: TeamId.BLUE });

    expect(champion.wallet!.balance).toBe(1_500);
    expect(champion.goldBounty).toBe(40);
  });

  it('earn passive gold at the map\'s pace', () => {
    const fast = new Champion({
      game: spawnerGame({ economy: { passiveGoldPerSecond: 20 } }),
      teamId: TeamId.BLUE,
    });
    const normal = new Champion({ game: spawnerGame(), teamId: TeamId.BLUE });
    const before = { fast: fast.wallet!.balance, normal: normal.wallet!.balance };

    fast.wallet!.accrue(1_000);
    normal.wallet!.accrue(1_000);

    expect(fast.wallet!.balance - before.fast).toBe(20);
    expect(normal.wallet!.balance - before.normal).toBe(
      DEFAULT_ECONOMY.passiveGoldPerSecond
    );
  });
});

describe('minions', () => {
  const firstMinion = (game: SpawnerGame): Minion => {
    const spawner = new MinionSpawner(game);
    spawner.queueWave();
    spawner.releaseQueued();
    const minion = game.objectManager._objectToBeAdd.find(o => o instanceof Minion);
    expect(minion, 'the wave released nothing').toBeTruthy();
    return minion as Minion;
  };

  it('are worth core\'s bounty when the map says nothing', () => {
    expect(firstMinion(spawnerGame()).goldBounty).toBe(DEFAULT_ECONOMY.minionBounty);
  });

  it('are worth what the map says', () => {
    const game = spawnerGame({ economy: { minionBounty: 7 } });
    expect(firstMinion(game).goldBounty).toBe(7);
  });

  it('let a declared type keep its own bounty over the map\'s blanket one', () => {
    // The precedence every other layer in `MapTuning` follows: the more
    // specific statement wins. A type that named a bounty said something the
    // economy group did not.
    const game = spawnerGame({
      economy: { minionBounty: 7 },
      minions: {
        types: {
          rich: {
            name: 'Rich',
            speed: 2.6,
            size: 34,
            health: 140,
            damage: 5,
            attackInterval: 1_100,
            attackRange: 40,
            aggroRange: 300,
            goldBounty: 99,
          },
        },
        waves: { composition: ['rich'] },
      },
    });

    expect(firstMinion(game).goldBounty).toBe(99);
  });
});
