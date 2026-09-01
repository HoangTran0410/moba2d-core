import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { healCutFraction, healingMultiplier } from '../../../src/game/combat/Healing';
import HealCut, { HEAL_CUT_FRACTION } from '../../../src/game/gameObject/buffs/HealCut';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const pair = () => {
  const game = createGame();
  const attacker = createUnit(game, 0, 'blue');
  const victim = createUnit(game, 50, 'red');
  for (const unit of [attacker, victim]) {
    unit.stats.maxHealth.baseValue = 200;
    unit.stats.health.baseValue = 200;
  }
  return { game, attacker, victim };
};

/** A cut of an arbitrary size, applied to `unit` for as long as the test needs. */
const cut = (unit: ReturnType<typeof createUnit>, fraction = HEAL_CUT_FRACTION) => {
  const buff = new HealCut(3_000, unit, unit);
  buff.healCut = fraction;
  unit.addBuff(buff);
  return buff;
};

/**
 * The arithmetic, on the structural shape rather than on a unit — the same
 * reason `combat/Vamp.ts` reads `{ stats }` and not an `AttackableUnit`.
 */
describe('the heal-cut fraction', () => {
  it('is nothing at all for a unit nobody has cut', () => {
    expect(healCutFraction({ buffs: [] })).toBe(0);
    expect(healingMultiplier({ buffs: [] })).toBe(1);
    expect(healingMultiplier(undefined)).toBe(1);
  });

  /**
   * **The strongest wins; they do not add.** Two grievous-wounds items on one
   * team is an ordinary shape — an AD carry and a mage both buying the counter
   * — and adding 40% to 40% would make healing worth 20% for the price of two
   * items nobody coordinated. League answers the same way for the same reason.
   */
  it('takes the strongest live cut rather than summing them', () => {
    expect(healCutFraction({ buffs: [{ healCut: 0.25 }, { healCut: 0.4 }] })).toBe(0.4);
    expect(healingMultiplier({ buffs: [{ healCut: 0.25 }, { healCut: 0.4 }] })).toBeCloseTo(0.6);
  });

  it('ignores a buff on its way out, and anything that is not a cut', () => {
    expect(healCutFraction({ buffs: [{ healCut: 0.4, toRemove: true }] })).toBe(0);
    expect(healCutFraction({ buffs: [{}, { healCut: 0 }] })).toBe(0);
  });

  /** A cut past 1 is a heal that hurts, and a negative one is a heal buff. */
  it('clamps to a multiplier between nothing and unchanged', () => {
    expect(healingMultiplier({ buffs: [{ healCut: 1.4 }] })).toBe(0);
    expect(healingMultiplier({ buffs: [{ healCut: -0.5 }] })).toBe(1);
    expect(healingMultiplier({ buffs: [{ healCut: Number.NaN }] })).toBe(1);
  });
});

describe('what a heal cut reaches', () => {
  it('cuts a heal at the one funnel every heal goes through', () => {
    const { victim } = pair();
    victim.stats.health.baseValue = 100;

    cut(victim, 0.4);
    victim.takeHeal(50);

    expect(victim.stats.health.value).toBe(130);
  });

  /**
   * Regeneration is the sustain a bruiser actually lives on, and it never
   * touches `takeHeal` — `Stats.update` adds it straight onto the pool. Cutting
   * one and not the other would make the counter-item useless against exactly
   * the build it is sold to answer.
   */
  it('cuts health regeneration too, and gives it back when the cut expires', () => {
    const { victim } = pair();
    victim.stats.health.baseValue = 100;
    victim.stats.healthRegen.baseValue = 1;

    const buff = cut(victim, 0.4);
    victim.update();
    expect(victim.stats.health.baseValue).toBeCloseTo(100.6, 6);

    buff.deactivateBuff();
    victim.update();
    expect(victim.stats.health.baseValue).toBeCloseTo(101.6, 6);
  });

  /** Mana is not healing. A grievous wound does not stop you casting. */
  it('leaves mana regeneration alone', () => {
    const { victim } = pair();
    victim.stats.maxMana.baseValue = 100;
    victim.stats.mana.baseValue = 50;
    victim.stats.manaRegen.baseValue = 1;

    cut(victim, 0.4);
    victim.update();

    expect(victim.stats.mana.baseValue).toBeCloseTo(51, 6);
  });

  /**
   * Vamp pays through `attacker.takeHeal`, so a cut on the *attacker* is what
   * reduces their drain — a cut on the victim does nothing to it, which is the
   * right way round: the wound is on the body that heals, not on the body that
   * is hit.
   */
  it('cuts the attacker’s lifesteal, and only the attacker’s', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.lifesteal.baseValue = 0.5;

    cut(victim, 0.4);
    victim.takeDamage(40, attacker, 'PHYSICAL');
    expect(attacker.stats.health.value, 'a cut on the victim reduced the attacker’s drain').toBe(
      120
    );

    cut(attacker, 0.4);
    victim.takeDamage(40, attacker, 'PHYSICAL');
    expect(attacker.stats.health.value).toBe(132);
  });

  /**
   * A shield is not a heal: it is a pool standing in front of the body, and
   * `Shield` never reaches `takeHeal`. Stated as a test because "all healing"
   * is exactly the phrase somebody will read as including it.
   */
  it('leaves a shield at full strength', () => {
    const { victim } = pair();
    cut(victim, 0.4);

    const shield = new Shield(3_000, victim, victim);
    shield.amount = 50;
    victim.addBuff(shield);

    victim.takeDamage(50, undefined, 'PHYSICAL');
    expect(victim.stats.health.value).toBe(200);
  });
});

/**
 * The other direction, and the reason it lives in the same file: a shop that
 * sells a wound owes players something to answer it with, and both are one
 * multiplier at the same two doors.
 */
describe('heal power', () => {
  it('is 1 for a unit nobody granted any', () => {
    expect(healingMultiplier({ stats: { healingReceived: { value: 0 } } })).toBe(1);
    expect(healingMultiplier({ buffs: [] })).toBe(1);
  });

  it('multiplies a heal by what the build bought', () => {
    const { victim } = pair();
    victim.stats.health.baseValue = 100;
    victim.stats.healingReceived.baseValue = 0.25;

    victim.takeHeal(40);

    expect(victim.stats.health.value).toBe(150);
  });

  it('reaches regeneration too, the same as the cut does', () => {
    const { victim } = pair();
    victim.stats.health.baseValue = 100;
    victim.stats.healthRegen.baseValue = 1;
    victim.stats.healingReceived.baseValue = 0.5;

    victim.update();

    expect(victim.stats.health.baseValue).toBeCloseTo(101.5, 6);
  });

  /**
   * A wound beats the build that bought its way around it: they multiply, so
   * 25% more healing under a 40% wound is 0.75 of normal, not 0.85. Two
   * effects that each move the same number have to compose, or the answer
   * depends on which one the reader thinks of first.
   */
  it('composes with a wound rather than cancelling it', () => {
    const { victim } = pair();
    victim.stats.health.baseValue = 100;
    victim.stats.healingReceived.baseValue = 0.25;
    cut(victim, 0.4);

    victim.takeHeal(40);

    // 40 * 1.25 * 0.6 = 30
    expect(victim.stats.health.value).toBe(130);
  });
});

describe('the buff itself', () => {
  it('renews rather than stacking, so two appliers are one wound', () => {
    const { victim } = pair();
    cut(victim);
    cut(victim);

    expect(victim.buffs.filter(buff => buff instanceof HealCut && !buff.toRemove)).toHaveLength(1);
    expect(healCutFraction(victim)).toBe(HEAL_CUT_FRACTION);
  });

  it('says what it does, in the number it was given', () => {
    const { victim } = pair();
    const buff = cut(victim, 0.4);
    expect(buff.description).toContain('40%');
  });
});
