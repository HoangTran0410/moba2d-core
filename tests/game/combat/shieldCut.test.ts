import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { shieldCutFraction, shieldMultiplier } from '../../../src/game/combat/Shielding';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import ShieldCut, { SHIELD_CUT_FRACTION } from '../../../src/game/gameObject/buffs/ShieldCut';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const pair = () => {
  const game = createGame();
  const caster = createUnit(game, 0, 'blue');
  const victim = createUnit(game, 50, 'red');
  for (const unit of [caster, victim]) {
    unit.stats.maxHealth.baseValue = 200;
    unit.stats.health.baseValue = 200;
  }
  return { game, caster, victim };
};

/** A shield of `amount`, granted the way a spell grants one. */
const shieldFor = (unit: ReturnType<typeof createUnit>, amount: number) => {
  const shield = new Shield(5_000, unit, unit);
  shield.amount = amount;
  unit.addBuff(shield);
  return shield;
};

const cut = (unit: ReturnType<typeof createUnit>, fraction = SHIELD_CUT_FRACTION) => {
  const buff = new ShieldCut(3_000, unit, unit);
  buff.shieldCut = fraction;
  unit.addBuff(buff);
  return buff;
};

/**
 * The fourth counter, and the one the shop could not express at all: a
 * champion ability can already *strip* what is up (a pack's own ultimate does
 * exactly that, by deactivating the `Shield` buffs), but nothing could make the
 * shields somebody's team casts *afterwards* worth less. The two are different
 * purchases — stripping is answered by re-casting, this one punishes the
 * re-cast.
 */
describe('the shield cut fraction', () => {
  it('is nothing at all for a unit nobody has cut', () => {
    expect(shieldCutFraction({ buffs: [] })).toBe(0);
    expect(shieldMultiplier({ buffs: [] })).toBe(1);
    expect(shieldMultiplier(undefined)).toBe(1);
  });

  it('takes the strongest live cut rather than summing them', () => {
    expect(shieldCutFraction({ buffs: [{ shieldCut: 0.3 }, { shieldCut: 0.5 }] })).toBe(0.5);
    expect(shieldMultiplier({ buffs: [{ shieldCut: 0.3 }, { shieldCut: 0.5 }] })).toBeCloseTo(0.5);
  });

  it('ignores a buff on its way out, and anything that is not a cut', () => {
    expect(shieldCutFraction({ buffs: [{ shieldCut: 0.5, toRemove: true }] })).toBe(0);
    expect(shieldCutFraction({ buffs: [{}, { shieldCut: Number.NaN }] })).toBe(0);
  });

  it('never turns a shield into a hole', () => {
    expect(shieldMultiplier({ buffs: [{ shieldCut: 1.7 }] })).toBe(0);
    expect(shieldMultiplier({ buffs: [{ shieldCut: -0.4 }] })).toBe(1);
  });
});

describe('what a shield cut reaches', () => {
  it('shrinks a shield granted while it is on', () => {
    const { victim } = pair();
    cut(victim, 0.5);

    const shield = shieldFor(victim, 60);

    expect(shield.amount).toBe(30);
    expect(shield.shieldAmount).toBe(30);
  });

  it('really absorbs only the smaller pool', () => {
    const { caster, victim } = pair();
    cut(victim, 0.5);
    shieldFor(victim, 60);

    victim.takeDamage(50, caster, 'PHYSICAL');

    // 30 of the 50 eaten by what is left of the shield, 20 through to health.
    expect(victim.stats.health.value).toBe(180);
  });

  /**
   * **It does not reach backwards.** A shield already standing when the cut
   * lands keeps its size: the pool was granted, its owner has been playing
   * around that number, and shrinking it retroactively would also have to
   * decide what the health bar's grey overlay is a fraction *of*.
   */
  it('leaves a shield that was already up exactly as it was', () => {
    const { victim } = pair();
    const shield = shieldFor(victim, 60);

    cut(victim, 0.5);

    expect(shield.amount).toBe(60);
  });

  it('stops applying once it has expired', () => {
    const { victim } = pair();
    const buff = cut(victim, 0.5);
    buff.deactivateBuff();

    expect(shieldFor(victim, 60).amount).toBe(60);
  });

  it('renews rather than stacking, so two appliers are one crack', () => {
    const { victim } = pair();
    cut(victim);
    cut(victim);

    expect(victim.buffs.filter(buff => buff instanceof ShieldCut && !buff.toRemove)).toHaveLength(1);
    expect(shieldCutFraction(victim)).toBe(SHIELD_CUT_FRACTION);
  });
});
