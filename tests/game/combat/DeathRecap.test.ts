import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import {
  DEATH_RECAP_ENGAGEMENT_GAP_MS,
  DEATH_RECAP_MAX_ENTRIES,
  DEATH_RECAP_MERGE_MS,
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

  describe('how far back it reaches', () => {
    /** One hit at `t`, from a source named so it will not merge with its neighbour. */
    const hitAt = (victim: any, killer: any, t: number, source: string) => {
      game.matchTimeMs = t;
      victim.takeDamage(5, killer, 'PHYSICAL', source);
    };

    it('keeps the whole fight, however long the finisher takes over it', () => {
      // The reported bug. Under a flat window measured from the newest hit,
      // every blow from the finisher pushed the cutoff forward and ate the
      // earlier fight a hit at a time — until only the finisher was left.
      const { victim, killer } = duo();
      for (let t = 0; t <= 6_000; t += 1_500) hitAt(victim, killer, t, `Đòn ${t}`);
      // Three seconds of quiet, then a finisher that takes five more.
      for (let t = 9_000; t <= 14_000; t += 1_000) hitAt(victim, killer, t, `Kết liễu ${t}`);

      expect(victim.recentDamageLog[0].atMs).toBe(0);
      expect(victim.recentDamageLog.some(e => e.source === 'Đòn 0')).toBe(true);
    });

    it('drops a fight that really was a separate one', () => {
      const { victim, killer } = duo();
      hitAt(victim, killer, 0, 'Trận cũ');
      hitAt(victim, killer, DEATH_RECAP_ENGAGEMENT_GAP_MS + 500, 'Trận mới');

      expect(victim.recentDamageLog).toHaveLength(1);
      expect(victim.recentDamageLog[0].source).toBe('Trận mới');
    });

    it('folds a tick stream into one entry instead of spending the ledger on it', () => {
      // What makes the rule above survive contact with a damage-over-time: 40
      // ticks used to be 40 entries, `DEATH_RECAP_MAX_ENTRIES` trimmed from
      // the front, and the start of the fight was gone again.
      const { victim, killer } = duo();
      // Deep enough to survive the burn: `die()` clears the ledger, and a
      // corpse proves nothing about merging.
      victim.stats.maxHealth.baseValue = 10_000;
      victim.stats.health.baseValue = 10_000;
      for (let tick = 0; tick < 40; tick++) {
        game.matchTimeMs = tick * (DEATH_RECAP_MERGE_MS / 4);
        victim.takeDamage(3, killer, 'MAGIC', 'Độc');
      }

      expect(victim.recentDamageLog).toHaveLength(1);
      expect(victim.recentDamageLog[0].hits).toBe(40);
      expect(victim.recentDamageLog[0].amount).toBe(120);
    });

    it('still caps the ledger for a fight that genuinely runs that long', () => {
      const { victim, killer } = duo();
      for (let hit = 0; hit < DEATH_RECAP_MAX_ENTRIES + 10; hit++) {
        // Distinct sources and spaced past the merge window, so nothing folds.
        game.matchTimeMs = hit * (DEATH_RECAP_MERGE_MS + 100);
        victim.takeDamage(1, killer, 'PHYSICAL', `Đòn ${hit}`);
      }
      expect(victim.recentDamageLog.length).toBeLessThanOrEqual(DEATH_RECAP_MAX_ENTRIES);
    });
  });

  it('splits what an attacker dealt by damage type', () => {
    // The engine kept one `damageDealt` number, which cannot answer the
    // question a player tuning a build is actually asking. Split at the same
    // site so the two can never disagree about a hit.
    const { victim, killer } = duo();
    victim.name = 'Bị đánh';
    victim.stats.maxHealth.baseValue = 5_000;
    victim.stats.health.baseValue = 5_000;

    victim.takeDamage(30, killer, 'PHYSICAL');
    victim.takeDamage(12, killer, 'MAGIC');
    victim.takeDamage(5, killer, 'TRUE');
    victim.takeDamage(10, killer, 'PHYSICAL');

    // The total every other reader uses still adds up to the same hits.
    expect(killer.tally.damageDealt).toBe(57);

    // And the split the recap prints, on the dealer's own ledger, pruned by
    // the same rule as the incoming one so the two totals in the panel cover
    // one stretch of time. Only here, never also on `MatchTally`: two places
    // keeping the same number is how the two drift.
    const dealt = killer.recentDamageDealtLog;
    const byType = (want: string) =>
      dealt.filter(entry => entry.type === want).reduce((sum, e) => sum + e.amount, 0);
    expect([byType('PHYSICAL'), byType('MAGIC'), byType('TRUE')]).toEqual([40, 12, 5]);
    expect(dealt.reduce((sum, entry) => sum + entry.amount, 0)).toBe(57);
    expect(dealt.every(entry => entry.attackerName === victim.name)).toBe(true);
  });

  it('forgets the outgoing ledger at its own death, exactly as the incoming one', () => {
    // Both are published into the recap and both start clean for the next
    // life; a dealer that kept its old ledger would print the last life's
    // fight beside this life's.
    const { victim, killer } = duo();
    victim.stats.maxHealth.baseValue = 5_000;
    victim.stats.health.baseValue = 5_000;
    victim.takeDamage(20, killer, 'MAGIC');
    expect(killer.recentDamageDealtLog).toHaveLength(1);

    killer.die({ attacker: victim, reviveAfter: 1_000 } as never);
    expect(killer.recentDamageDealtLog).toHaveLength(0);
    expect(killer.deathRecap?.dealt).toHaveLength(1);
  });

  it('keeps a bot that re-rolled mid-fight as two attackers, not one', () => {
    // A bot becomes a different champion every time it dies
    // (`AIChampion._autoReroll`), so one unit id can be Jinx for the first
    // half of a skirmish and Alistar for the second. Keyed on the id alone and
    // labelled from its *first* entry, everything that body ever did collected
    // under whoever it was first — a death screen reading "Hạ gục bởi Alistar"
    // with no Alistar row and his abilities filed under Jinx. Reported from a
    // real match, and it reads as nonsense because it is.
    const { victim } = duo();
    victim.stats.maxHealth.baseValue = 5_000;
    victim.stats.health.baseValue = 5_000;
    const bot = new Champion({ game, position: createVector(50, 0), teamId: 'red' });
    bot.name = 'Jinx';
    indexObjects(game, [victim, bot]);

    game.matchTimeMs = 0;
    victim.takeDamage(88, bot, 'MAGIC', 'Giật Bắn!');
    // It dies and comes back as somebody else — the same body, a new champion.
    bot.name = 'Alistar';
    game.matchTimeMs = 4_000;
    victim.takeDamage(65, bot, 'MAGIC', 'Nghiền Nát');

    const groups = new Set(victim.recentDamageLog.map(entry => entry.attackerId));
    expect(groups.size).toBe(2);
    expect(victim.recentDamageLog.map(entry => entry.attackerName)).toEqual(['Jinx', 'Alistar']);
  });

  it('files every minion of a kind under one attacker, and keeps champions apart', () => {
    // A wave is six units with six ids, and the recap gave it six rows of a
    // dozen damage each. Champions keep their own id: two bots can be the
    // same champion, and folding two players into one row misreports the kill.
    const { victim } = duo();
    const wave = [0, 1, 2].map(i => {
      const minion = new Champion({ game, position: createVector(20 + i, 0), teamId: 'red' });
      minion.name = 'Lính cận chiến';
      minion.killCredit = 'minion';
      return minion;
    });
    indexObjects(game, [victim, ...wave]);

    wave.forEach((minion, i) => {
      game.matchTimeMs = i * (DEATH_RECAP_MERGE_MS + 100);
      victim.takeDamage(12, minion, 'PHYSICAL', 'Đánh thường');
    });

    expect(new Set(victim.recentDamageLog.map(e => e.attackerId))).toEqual(
      new Set(['Lính cận chiến'])
    );

    const twins = [0, 1].map(i => {
      const bot = new Champion({ game, position: createVector(40 + i, 0), teamId: 'red' });
      bot.name = 'Ahri';
      return bot;
    });
    indexObjects(game, [victim, ...twins]);
    twins.forEach((bot, i) => {
      game.matchTimeMs = 5_000 + i * (DEATH_RECAP_MERGE_MS + 100);
      victim.takeDamage(9, bot, 'MAGIC', 'Hỏa Cầu');
    });

    const champIds = victim.recentDamageLog
      .filter(e => e.attackerName === 'Ahri')
      .map(e => e.attackerId);
    expect(new Set(champIds).size).toBe(2);
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
