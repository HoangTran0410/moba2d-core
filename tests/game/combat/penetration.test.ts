import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { effectiveDamage, resistanceAgainst } from '../../../src/game/combat/Mitigation';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const body = (armor: number, magicResist: number) => ({
  stats: { armor: { value: armor }, magicResist: { value: magicResist } },
});

const attacker = (armorPenetration: number, magicPenetration: number) => ({
  stats: {
    armorPenetration: { value: armorPenetration },
    magicPenetration: { value: magicPenetration },
  },
});

/**
 * The counter to a resistance, and the mirror of the wound shelf: this shop
 * sells 45 armour on one item and had nothing that could get through it, which
 * is the same shape of hole `combat/Healing.ts` closed on sustain.
 */
describe('penetration', () => {
  it('is inert for an attacker nobody granted any', () => {
    expect(resistanceAgainst('PHYSICAL', body(60, 30))).toBe(60);
    expect(resistanceAgainst('PHYSICAL', body(60, 30), attacker(0, 0))).toBe(60);
    expect(resistanceAgainst('PHYSICAL', body(60, 30), undefined)).toBe(60);
  });

  it('takes its share of the resistance the damage type has to get past', () => {
    expect(resistanceAgainst('PHYSICAL', body(60, 30), attacker(0.4, 0))).toBeCloseTo(36);
    expect(resistanceAgainst('MAGIC', body(60, 30), attacker(0, 0.5))).toBeCloseTo(15);
  });

  it('reads each type from its own stat, and asks TRUE nothing at all', () => {
    // Armour penetration doing anything to a magic hit would make one item the
    // answer to both resistances.
    expect(resistanceAgainst('MAGIC', body(60, 30), attacker(0.9, 0))).toBe(30);
    expect(resistanceAgainst('PHYSICAL', body(60, 30), attacker(0, 0.9))).toBe(60);
    expect(resistanceAgainst('TRUE', body(60, 30), attacker(0.9, 0.9))).toBe(0);
  });

  /**
   * **The trap.** A shred can push a resistance below zero, where the curve is
   * mirrored and the victim takes *extra* damage. Taking a share off a
   * negative number moves it back towards zero — so penetration would undo a
   * shred, and a full-penetration build would make its own shred effects
   * useless against exactly the target they were spent on.
   */
  it('leaves a resistance that is already negative exactly where it is', () => {
    expect(resistanceAgainst('PHYSICAL', body(-40, 0), attacker(0.5, 0))).toBe(-40);
  });

  it('clamps a share nobody should have been given', () => {
    expect(resistanceAgainst('PHYSICAL', body(60, 0), attacker(1.8, 0))).toBe(0);
    expect(resistanceAgainst('PHYSICAL', body(60, 0), attacker(-1, 0))).toBe(60);
    expect(resistanceAgainst('PHYSICAL', body(60, 0), attacker(Number.NaN, 0))).toBe(60);
  });

  it('reaches a real hit through the funnel', () => {
    const game = createGame();
    const hitter = createUnit(game, 0, 'blue');
    const victim = createUnit(game, 50, 'red');
    victim.stats.maxHealth.baseValue = 200;
    victim.stats.health.baseValue = 200;
    victim.stats.armor.baseValue = 100;

    // 100 armour halves it: 40 -> 20.
    victim.takeDamage(40, hitter, 'PHYSICAL');
    expect(victim.stats.health.value).toBe(180);

    // Half the armour ignored: 50 left, 40 * 100/150 = 26.67 -> 27.
    hitter.stats.armorPenetration.baseValue = 0.5;
    victim.takeDamage(40, hitter, 'PHYSICAL');
    expect(victim.stats.health.value).toBe(153);
  });
});
