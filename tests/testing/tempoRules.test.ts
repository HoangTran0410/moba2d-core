/**
 * The pace band, and the two ways a pack leaves it.
 *
 * Written against the numbers that produced it: a ninety-second ultimate and
 * a twenty-six-second basic, both shipped in a pack whose own build was
 * entirely green, because nothing anywhere compares a cooldown to anything.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_BASIC_COOLDOWN_MS,
  MAX_ULTIMATE_COOLDOWN_MS,
  tempoIssues,
} from '../../src/testing/tempoRules';

const kit = (cooldowns: number[]) => ({
  spellCatalog: Object.fromEntries(cooldowns.map((ms, i) => [`S${i}`, { coolDownMs: ms }])),
  champions: [{ id: 'hero', spells: cooldowns.map((_, i) => `S${i}`) }],
});

describe('tempo rules', () => {
  it('passes a kit inside the band', () => {
    expect(tempoIssues(kit([8_000, 10_000, 12_000, 10_000]))).toEqual([]);
  });

  it('catches an ultimate a player waits out rather than plays around', () => {
    const issues = tempoIssues(kit([8_000, 8_000, 8_000, 90_000]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.slot).toBe(4);
    expect(issues[0]?.message).toContain('90s');
  });

  it('holds a basic to the looser ceiling, not the ultimate one', () => {
    // 11s is over an ultimate's 10 and under a basic's 12 — the one input
    // that tells the two ceilings apart.
    expect(MAX_BASIC_COOLDOWN_MS).toBeGreaterThan(MAX_ULTIMATE_COOLDOWN_MS);
    expect(tempoIssues(kit([11_000, 8_000, 8_000, 10_000]))).toEqual([]);
    expect(tempoIssues(kit([8_000, 8_000, 8_000, 11_000]))).toHaveLength(1);
  });

  it('measures a form ability too, which no roster lists', () => {
    const fixture = {
      spellCatalog: { Q: { coolDownMs: 8_000 }, Q2: { coolDownMs: 30_000 } },
      champions: [{ id: 'hero', spells: ['Q', 'Q', 'Q', 'Q'] }],
      formSpells: ['Q2'],
    };
    expect(tempoIssues(fixture).map(issue => issue.spellId)).toEqual(['Q2']);
  });

  it('lets a pack state a band of its own, out loud', () => {
    expect(tempoIssues({ ...kit([8_000, 8_000, 8_000, 45_000]), maxUltimateMs: 60_000 })).toEqual([]);
  });
});
