import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import {
  DEATH_RECAP_MAX_ENTRIES,
  DEATH_RECAP_WINDOW_MS,
} from '../../../src/game/gameObject/attackableUnits/AttackableUnit';

/**
 * The rolling damage ledger and the recap `die()` publishes from it — the
 * data half of the death-recap panel. Display grouping is pinned beside
 * `computeHudState` in `hudState.test.ts`; this file owns the recording
 * rules: landed amounts only, who and what, the window, the snapshot.
 */
describe('the death-recap ledger', () => {
  let game: TestGame & { matchTimeMs?: number };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame() as TestGame & { matchTimeMs?: number };
    game.matchTimeMs = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  const duo = () => {
    const victim = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    const killer = new Champion({ game, position: createVector(100, 0), teamId: 'red' });
    killer.name = 'Ahri';
    game.setPlayer(victim);
    indexObjects(game, [victim, killer]);
    return { victim, killer };
  };

  it('records the landed hit with who and, when named, what', () => {
    const { victim, killer } = duo();
    victim.takeDamage(20, killer, 'MAGIC', 'Quả Cầu Ma Thuật');
    victim.takeDamage(10, killer, 'PHYSICAL');

    expect(victim.recentDamageLog).toHaveLength(2);
    expect(victim.recentDamageLog[0]).toMatchObject({
      amount: 20,
      type: 'MAGIC',
      attackerName: 'Ahri',
      source: 'Quả Cầu Ma Thuật',
    });
    expect(victim.recentDamageLog[1].source).toBeUndefined();
  });

  it('never records the unit hurting itself', () => {
    const { victim } = duo();
    victim.takeDamage(10, victim, 'TRUE');
    expect(victim.recentDamageLog).toHaveLength(0);
  });

  it('prunes what fell out of the window, and caps the ledger', () => {
    const { victim, killer } = duo();
    victim.takeDamage(5, killer, 'PHYSICAL');
    game.matchTimeMs = DEATH_RECAP_WINDOW_MS + 1_000;
    victim.takeDamage(5, killer, 'PHYSICAL');

    expect(victim.recentDamageLog).toHaveLength(1);
    expect(victim.recentDamageLog[0].atMs).toBe(DEATH_RECAP_WINDOW_MS + 1_000);

    for (let hit = 0; hit < DEATH_RECAP_MAX_ENTRIES + 10; hit++) {
      victim.takeDamage(1, killer, 'PHYSICAL');
    }
    expect(victim.recentDamageLog.length).toBeLessThanOrEqual(DEATH_RECAP_MAX_ENTRIES);
  });

  it('die() publishes the recap — killing blow included — and clears the ledger', () => {
    const { victim, killer } = duo();
    victim.takeDamage(30, killer, 'MAGIC', 'Quả Cầu Ma Thuật');
    victim.takeDamage(99_999, killer, 'TRUE');

    expect(victim.isDead).toBe(true);
    expect(victim.deathRecap).not.toBeNull();
    expect(victim.deathRecap!.killerName).toBe('Ahri');
    expect(victim.deathRecap!.seq).toBe(1);
    const amounts = victim.deathRecap!.entries.map(entry => entry.amount);
    expect(amounts[0]).toBe(30);
    expect(amounts[amounts.length - 1]).toBeGreaterThan(0);
    expect(victim.recentDamageLog).toHaveLength(0);
  });

  it('a second death re-publishes with a bumped seq', () => {
    const { victim, killer } = duo();
    victim.takeDamage(99_999, killer, 'TRUE');
    expect(victim.deathRecap!.seq).toBe(1);

    victim.respawn?.();
    victim.deathData = null;
    victim.stats.health.baseValue = 100;
    victim.takeDamage(99_999, killer, 'TRUE');
    expect(victim.deathRecap!.seq).toBe(2);
  });
});
