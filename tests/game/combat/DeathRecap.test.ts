import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Shield from '../../../src/game/gameObject/buffs/Shield';
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const duo = () => {
    const victim = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    const killer = new Champion({ game, position: createVector(100, 0), teamId: 'red' });
    killer.name = 'Vera';
    game.setPlayer(victim);
    indexObjects(game, [victim, killer]);
    return { victim, killer };
  };

  it('records the landed hit with who and, when named, what', () => {
    const { victim, killer } = duo();
    victim.takeDamage(20, killer, 'MAGIC', 'Hỏa Cầu');
    victim.takeDamage(10, killer, 'PHYSICAL');

    expect(victim.recentDamageLog).toHaveLength(2);
    expect(victim.recentDamageLog[0]).toMatchObject({
      amount: 20,
      type: 'MAGIC',
      attackerName: 'Vera',
      source: 'Hỏa Cầu',
    });
    expect(victim.recentDamageLog[1].source).toBeUndefined();
  });

  describe('what a shield ate', () => {
    /** A bubble on the victim, big enough to be asked to eat what follows. */
    const bubble = (victim: Champion, amount: number) => {
      const shield = new Shield(10_000, victim, victim);
      shield.amount = amount;
      victim.addBuff(shield);
      return shield;
    };

    it('records the part a shield absorbed beside the part that landed', () => {
      const { victim, killer } = duo();
      bubble(victim, 30);

      victim.takeDamage(50, killer, 'MAGIC', 'Hỏa Cầu');

      expect(victim.recentDamageLog).toHaveLength(1);
      expect(victim.recentDamageLog[0].amount).toBe(20);
      expect(victim.recentDamageLog[0].blocked).toBe(30);
    });

    it('records a hit the shield ate whole, which used to vanish entirely', () => {
      // The reported bug. A hit fully absorbed took `takeDamage`'s early
      // return before anything was written, so a player who died behind a big
      // bubble read a recap that never mentioned it — the shield looked as
      // though it had done nothing at all.
      const { victim, killer } = duo();
      bubble(victim, 500);

      victim.takeDamage(120, killer, 'MAGIC', 'Hỏa Cầu');

      expect(victim.recentDamageLog).toHaveLength(1);
      expect(victim.recentDamageLog[0].amount).toBe(0);
      expect(victim.recentDamageLog[0].blocked).toBe(120);
      expect(victim.recentDamageLog[0].source).toBe('Hỏa Cầu');
    });

    it('counts nothing as blocked when there is no shield to count', () => {
      // So the field cannot quietly start reporting mitigation, which is a
      // different thing: armour makes the hit smaller and never stands in
      // front of it. `swung` is read after resistances for that reason.
      const { victim, killer } = duo();
      victim.stats.armor.baseValue = 100;

      victim.takeDamage(40, killer, 'PHYSICAL');

      expect(victim.recentDamageLog[0].blocked).toBe(0);
      expect(victim.recentDamageLog[0].amount).toBeLessThan(40);
    });

    it('still refuses to record the unit shielding itself against itself', () => {
      const { victim } = duo();
      bubble(victim, 500);
      victim.takeDamage(60, victim, 'TRUE');
      expect(victim.recentDamageLog).toHaveLength(0);
    });
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
    victim.takeDamage(30, killer, 'MAGIC', 'Hỏa Cầu');
    victim.takeDamage(99_999, killer, 'TRUE');

    expect(victim.isDead).toBe(true);
    expect(victim.deathRecap).not.toBeNull();
    expect(victim.deathRecap!.killerName).toBe('Vera');
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
