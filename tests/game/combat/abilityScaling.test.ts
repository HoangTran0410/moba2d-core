import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Spell from '@/game/gameObject/Spell';
import Buff from '@/game/gameObject/Buff';
import SpellObject from '@/game/gameObject/SpellObject';
import BasicAttack from '@/game/gameObject/coreSpells/BasicAttack';
import { MAX_COOLDOWN_REDUCTION, MIN_ABILITY_POWER } from '@/game/gameObject/Stats';
import {
  beginAttribution,
  endAttribution,
  resetAttributionForTests,
} from '@/game/combat/DamageAttribution';

/**
 * What a build does to a kit.
 *
 * The bug this closes, in the numbers that produced it: a full attack build in
 * the installed packs multiplies a champion's damage per swing by about 5.7
 * and its rate by about 1.5, while not one of the 308 abilities across those
 * packs read a single stat of its caster — so the same gold bought abilities a
 * multiplier of exactly 1.00. Players reported it the obvious way: spamming a
 * whole kit did less than holding right-click.
 *
 * The fix is deliberately not in any of those 308 files. Core amplifies at the
 * one funnel every hit already passes through, and decides *what counts as an
 * ability* from the ambient that was already bracketing pack code for the
 * death recap. These tests are therefore mostly about the boundary — the
 * things that must **not** scale — because that is the half a pack cannot see
 * and cannot fix.
 */
describe('abilities scale with the caster’s build', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    resetAttributionForTests();
    game = createGame();
  });
  afterEach(() => {
    resetAttributionForTests();
    vi.unstubAllGlobals();
  });

  const duo = () => {
    const victim = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    const caster = new Champion({ game, position: createVector(100, 0), teamId: 'red' });
    victim.stats.maxHealth.baseValue = 10_000;
    victim.stats.health.baseValue = 10_000;
    game.setPlayer(victim);
    indexObjects(game, [victim, caster]);
    return { victim, caster };
  };

  /** Damage that actually reached the health pool, which is what a player feels. */
  const dealt = (victim: Champion, body: () => void): number => {
    const before = victim.stats.health.baseValue;
    body();
    return before - victim.stats.health.baseValue;
  };

  /** A hit landed the way an ordinary ability lands one: from inside its cast. */
  const asAbility = (victim: Champion, caster: Champion, damage: number): number =>
    dealt(victim, () => {
      const previous = beginAttribution({ name: 'Hỏa Cầu', damageScalesWithAbilityPower: true });
      try {
        victim.takeDamage(damage, caster, 'MAGIC');
      } finally {
        endAttribution(previous);
      }
    });

  describe('the amplification itself', () => {
    it('is inert until something grants the stat', () => {
      // The migration argument, as a test: no ability in any pack was retuned
      // when this landed, because every unit starts at zero.
      const { victim, caster } = duo();
      expect(caster.stats.abilityPower.value).toBe(0);
      expect(asAbility(victim, caster, 40)).toBe(40);
    });

    it('adds the fraction to an ability’s damage', () => {
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 1.5;

      expect(asAbility(victim, caster, 40)).toBe(100);
    });

    it('runs before the victim’s resistances, the way attack damage does', () => {
      // A swing is built up from `attackDamage` at its source and *then* meets
      // armour. An ability amplified after mitigation would instead be worth
      // more against a resistant target than against a bare one, which is
      // backwards. 40 × 2 = 80, then 100 magic resist halves it.
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 1;
      victim.stats.magicResist.baseValue = 100;

      expect(asAbility(victim, caster, 40)).toBe(40);
    });

    it('cannot be pushed past zero into a heal', () => {
      // `Mitigation.ts` documents the same failure for armour shred. Here the
      // floor is on the stat, so two stacking reductions cannot reach it.
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = -5;

      expect(caster.stats.abilityPower.value).toBe(MIN_ABILITY_POWER);
      expect(asAbility(victim, caster, 40)).toBe(0);
    });
  });

  describe('what must not scale', () => {
    it('leaves a hit with nothing running alone', () => {
      // Core's own periodic effects, a hazard, anything a future caller adds:
      // the ambient is opt-in, so silence means no amplification rather than
      // an accidental one.
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 2;

      expect(dealt(victim, () => victim.takeDamage(40, caster, 'MAGIC'))).toBe(40);
    });

    it('leaves a basic attack alone, however much ability power the swinger has', () => {
      // A swing already scales on `attackDamage`, which items pay for
      // handsomely. Drawing from both stats would make one purchase buy two
      // halves of a champion.
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 2;
      const swing = new BasicAttack(caster);
      expect(swing.damageScalesWithAbilityPower).toBe(false);

      const damage = dealt(victim, () => {
        const previous = beginAttribution(swing);
        try {
          victim.takeDamage(40, caster, 'PHYSICAL', 'Đánh thường');
        } finally {
          endAttribution(previous);
        }
      });
      expect(damage).toBe(40);
    });

    it('cannot be opted into by a damage type, because a type says nothing', () => {
      // `takeDamage` sees a number, an attacker and a type, and none of the
      // three separates a swing from a cast — a third of the abilities in the
      // installed packs are `PHYSICAL` since they started declaring types.
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 1;

      const previous = beginAttribution({ name: 'Chém', damageScalesWithAbilityPower: true });
      const physical = dealt(victim, () => victim.takeDamage(40, caster, 'PHYSICAL'));
      endAttribution(previous);

      expect(physical, 'an ability is an ability whatever it is typed').toBe(80);
    });
  });

  describe('an ability’s objects and buffs inherit it', () => {
    it('carries through a spell object that lands frames after the cast', () => {
      // The common shape: a missile deals its damage in its own `update`, on an
      // object with no back-link to the spell that fired it.
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 1;

      const previous = beginAttribution({ name: 'Hỏa Cầu', damageScalesWithAbilityPower: true });
      const missile = new SpellObject(caster);
      endAttribution(previous);
      missile.update = () => victim.takeDamage(40, caster, 'MAGIC');

      game.objectManager.addObject(missile);
      // `addObject` queues: the first pass admits it, the second ticks it.
      game.objectManager.update();
      const damage = dealt(victim, () => game.objectManager.update());

      expect(damage).toBe(80);
    });

    it('carries into a buff an ability applied, and stops at one an item applied', () => {
      // A damage-over-time ticks frames later with the cast long returned, so
      // it reads the flag once, at construction, inside the applying spell's
      // own bracket. The two cases are the whole reason it is a field.
      const { victim, caster } = duo();

      const fromAbility = beginAttribution({ name: 'Thiêu', damageScalesWithAbilityPower: true });
      const burn = new Buff(1_000, caster, victim);
      endAttribution(fromAbility);

      const fromItem = beginAttribution({ name: 'Giáp Gai', damageScalesWithAbilityPower: false });
      const thorns = new Buff(1_000, caster, victim);
      endAttribution(fromItem);

      expect(burn.damageScalesWithAbilityPower).toBe(true);
      expect(thorns.damageScalesWithAbilityPower).toBe(false);
      expect(new Buff(1_000, caster, victim).damageScalesWithAbilityPower).toBe(false);
    });
  });

  describe('cooldown reduction', () => {
    class Fireball extends Spell {
      targetingMode = 'POINT' as const;
      coolDown = 10_000;
    }

    it('is inert until something grants the stat', () => {
      const { caster } = duo();
      expect(new Fireball(caster).effectiveCoolDownMs).toBe(10_000);
    });

    it('shortens an ability by the fraction', () => {
      const { caster } = duo();
      caster.stats.cooldownReduction.baseValue = 0.25;

      expect(new Fireball(caster).effectiveCoolDownMs).toBe(7_500);
    });

    it('is capped, because 1.0 is not a short cooldown but a held key', () => {
      const { caster } = duo();
      caster.stats.cooldownReduction.baseValue = 5;

      expect(caster.stats.cooldownReduction.value).toBe(MAX_COOLDOWN_REDUCTION);
      expect(new Fireball(caster).effectiveCoolDownMs).toBeCloseTo(
        10_000 * (1 - MAX_COOLDOWN_REDUCTION),
        6
      );
    });

    it('leaves the casts that are not abilities at their full duration', () => {
      // The swing rhythm belongs to `stats.attackSpeed` and its own controller;
      // an item's cooldown is not shortened by another item either.
      const { caster } = duo();
      caster.stats.cooldownReduction.baseValue = 0.5;

      const item = new Fireball(caster);
      item.countsAsAbilityCast = false;

      expect(item.effectiveCoolDownMs).toBe(10_000);
    });
  });
});
