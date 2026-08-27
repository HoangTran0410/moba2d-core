import { describe, expect, it } from 'vitest';
import { abilityPowerMultiplier, amplifiedAbilityDamage } from '@/game/combat/Amplification';

/**
 * The one place a build turns into ability damage.
 *
 * Every expected value below is arithmetic written out by hand, never a call
 * back into the module — the same rule `Mitigation.test.ts` states and for the
 * same reason: a transform asked to verify itself agrees with itself however
 * wrong it is.
 */
const caster = (abilityPower: number) => ({ stats: { abilityPower: { value: abilityPower } } });

describe('abilityPowerMultiplier', () => {
  it('is a no-op at zero, which is what every unit in the game starts with', () => {
    // The whole migration argument: on the day this landed, 308 abilities
    // across the installed packs kept dealing exactly what they dealt before.
    expect(abilityPowerMultiplier(caster(0))).toBe(1);
  });

  it('adds the fraction, so 0.35 is +35%', () => {
    expect(abilityPowerMultiplier(caster(0.35))).toBeCloseTo(1.35, 10);
    expect(abilityPowerMultiplier(caster(2))).toBeCloseTo(3, 10);
  });

  it('reduces on a negative, which is a real effect and not a bug', () => {
    expect(abilityPowerMultiplier(caster(-0.4))).toBeCloseTo(0.6, 10);
  });

  it('floors at zero, so no reduction ever turns a cast into a heal', () => {
    // `Stats.abilityPower` floors its own value at -1, but this function is
    // reachable with a hand-built stat block. -2 would be a multiplier of -1:
    // the ability would restore health equal to its own damage.
    expect(abilityPowerMultiplier(caster(-1))).toBe(0);
    expect(abilityPowerMultiplier(caster(-2))).toBe(0);
    expect(abilityPowerMultiplier(caster(-1e9))).toBe(0);
  });

  it('treats a missing or unreadable stat as no amplification, never NaN', () => {
    // A NaN multiplier makes every ability against everyone NaN, health bars go
    // blank, and nothing in the stack trace says which stat did not exist.
    expect(abilityPowerMultiplier(undefined)).toBe(1);
    expect(abilityPowerMultiplier({})).toBe(1);
    expect(abilityPowerMultiplier({ stats: {} })).toBe(1);
    expect(abilityPowerMultiplier(caster(NaN))).toBe(1);
    expect(abilityPowerMultiplier(caster(Infinity))).toBe(1);
  });
});

describe('amplifiedAbilityDamage', () => {
  it('scales the number by the multiplier and nothing else', () => {
    expect(amplifiedAbilityDamage(40, caster(0))).toBe(40);
    expect(amplifiedAbilityDamage(40, caster(0.5))).toBeCloseTo(60, 10);
    expect(amplifiedAbilityDamage(26, caster(2.5))).toBeCloseTo(91, 10);
  });

  it('does not round — `takeDamage` owns that, once, after this', () => {
    // Rounding here as well would round twice: 25 * 1.35 is 33.75, and
    // 34 is the answer, not 34 via 33.
    expect(amplifiedAbilityDamage(25, caster(0.35))).toBeCloseTo(33.75, 10);
  });

  it('leaves zero at zero however large the build', () => {
    expect(amplifiedAbilityDamage(0, caster(10))).toBe(0);
  });
});
