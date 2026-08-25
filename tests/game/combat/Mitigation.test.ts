import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAMAGE_TYPE,
  effectiveDamage,
  mitigationMultiplier,
  resistanceAgainst,
} from '@/game/combat/Mitigation';

/**
 * The one place a resistance turns into a number.
 *
 * Every expected value below is arithmetic written out by hand, never a call
 * back into the module: a transform asked to verify itself agrees with itself
 * however wrong it is, and this file's whole job is to be the second opinion.
 */
const body = (armor = 0, magicResist = 0) => ({
  stats: { armor: { value: armor }, magicResist: { value: magicResist } },
});

describe('mitigationMultiplier', () => {
  it('is a no-op at zero, which is what every unit starts with', () => {
    expect(mitigationMultiplier(0)).toBe(1);
  });

  it('halves the hit at 100 resistance', () => {
    // 100 / (100 + 100)
    expect(mitigationMultiplier(100)).toBeCloseTo(0.5, 10);
  });

  it('follows 100/(100+r) on the way up', () => {
    expect(mitigationMultiplier(25)).toBeCloseTo(0.8, 10); // 100/125
    expect(mitigationMultiplier(50)).toBeCloseTo(2 / 3, 10); // 100/150
    expect(mitigationMultiplier(300)).toBeCloseTo(0.25, 10); // 100/400
  });

  it('amplifies on negative resistance without ever exploding', () => {
    // The mirrored branch, 2 - 100/(100-r): symmetric at the origin and
    // asymptotic to 2, so shredding armour is worth a lot and then stops being
    // worth more. A bare 100/(100+r) would divide by zero at -100 and go
    // negative past it, which is a heal.
    expect(mitigationMultiplier(-25)).toBeCloseTo(1.2, 10); // 2 - 100/125
    expect(mitigationMultiplier(-100)).toBeCloseTo(1.5, 10); // 2 - 100/200
    expect(mitigationMultiplier(-1_000_000)).toBeLessThan(2);
    expect(mitigationMultiplier(-1_000_000)).toBeGreaterThan(1.99);
  });

  it('never returns a negative multiplier, whatever it is handed', () => {
    for (const resistance of [0, 1, 1e6, -1e6, Number.MAX_SAFE_INTEGER]) {
      expect(mitigationMultiplier(resistance)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('resistanceAgainst', () => {
  it('reads armour for a physical hit and magic resist for a magic one', () => {
    const victim = body(40, 70);
    expect(resistanceAgainst('PHYSICAL', victim)).toBe(40);
    expect(resistanceAgainst('MAGIC', victim)).toBe(70);
  });

  it('is always zero for true damage — that is what true damage means', () => {
    expect(resistanceAgainst('TRUE', body(999, 999))).toBe(0);
  });

  it('treats a unit with no resistance stats at all as having none', () => {
    // Minions, wards and anything a pack builds by hand may carry a partial
    // stat block. A missing field is 0, never NaN — a NaN multiplier makes
    // every hit against that unit deal NaN and the health bar goes blank.
    expect(resistanceAgainst('PHYSICAL', {})).toBe(0);
    expect(resistanceAgainst('MAGIC', { stats: {} })).toBe(0);
  });
});

describe('effectiveDamage', () => {
  it('leaves damage untouched against a unit with no resistances', () => {
    expect(effectiveDamage(40, 'MAGIC', body())).toBe(40);
    expect(effectiveDamage(40, 'PHYSICAL', body())).toBe(40);
  });

  it('halves a physical hit against 100 armour', () => {
    expect(effectiveDamage(40, 'PHYSICAL', body(100, 0))).toBeCloseTo(20, 10);
  });

  it('ignores the wrong resistance', () => {
    // 100 armour does nothing at all to a magic hit. This is the whole point
    // of the feature and the assertion most worth having.
    expect(effectiveDamage(40, 'MAGIC', body(100, 0))).toBe(40);
    expect(effectiveDamage(40, 'PHYSICAL', body(0, 100))).toBe(40);
  });

  it('lets true damage through both', () => {
    expect(effectiveDamage(40, 'TRUE', body(500, 500))).toBe(40);
  });

  it('takes 20% off a magic hit against 25 magic resist', () => {
    expect(effectiveDamage(40, 'MAGIC', body(0, 25))).toBeCloseTo(32, 10); // 40 * 0.8
  });
});

describe('the default type', () => {
  /**
   * `MAGIC`, and the choice is load-bearing. `takeDamage(damage, attacker)` is
   * called from every pack in existence, so the third parameter has to be
   * optional — and whatever it defaults to is retroactively what every ability
   * already written deals. Abilities are the overwhelming majority of those
   * calls, and an ability is magic damage unless it says otherwise;
   * `BasicAttack` is the one caller that passes `PHYSICAL` explicitly.
   *
   * Nothing changes numerically the day this lands: every unit starts at 0
   * armour and 0 magic resist, so the multiplier is exactly 1 everywhere until
   * someone deliberately gives a unit a resistance.
   */
  it('is MAGIC', () => {
    expect(DEFAULT_DAMAGE_TYPE).toBe('MAGIC');
  });
});
