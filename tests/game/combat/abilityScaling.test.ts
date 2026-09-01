import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Spell from '@/game/gameObject/Spell';
import Buff from '@/game/gameObject/Buff';
import SpellObject from '@/game/gameObject/SpellObject';
import BasicAttack from '@/game/gameObject/coreSpells/BasicAttack';
import { MAX_ABILITY_HASTE, MIN_ABILITY_POWER } from '@/game/gameObject/Stats';
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
      // installed packs are `PHYSICAL` since they started declaring types. The
      // type decides *which* stat amplifies, never *whether* anything does;
      // that answer only ever comes from the attribution.
      const { victim, caster } = duo();
      caster.stats.attackDamage.baseValue = 10;
      caster.stats.attackDamage.flatBonus = 20;

      const unattributed = dealt(victim, () => victim.takeDamage(40, caster, 'PHYSICAL'));
      expect(unattributed, 'a typed hit with nothing running is not an ability').toBe(40);
    });
  });

  /**
   * The half that was missing, and the bug the whole damage-type effort was
   * started for: ability power amplified *every* ability whatever it dealt, so
   * an item selling magic power made a physical ability hit exactly as much
   * harder as it made a magic one. Invisible while nothing declared a type,
   * and a real defect the day everything did.
   */
  describe('and each type reads the stat that buys it', () => {
    const asAbility = (body: () => void) => {
      const previous = beginAttribution({ name: 'Chiêu', damageScalesWithAbilityPower: true });
      try {
        body();
      } finally {
        endAttribution(previous);
      }
    };

    it('gives a magic ability ability power and nothing else', () => {
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 1;
      caster.stats.attackDamage.baseValue = 10;
      caster.stats.attackDamage.flatBonus = 20;

      const magic = dealt(victim, () => asAbility(() => victim.takeDamage(40, caster, 'MAGIC')));
      expect(magic, 'attack damage leaked into a magic ability').toBe(80);
    });

    it('gives a physical ability the attack damage its holder bought', () => {
      const { victim, caster } = duo();
      caster.stats.abilityPower.baseValue = 1;
      // 20 bought over a base of 10, at 5% a point: +100%.
      caster.stats.attackDamage.baseValue = 10;
      caster.stats.attackDamage.flatBonus = 20;

      const physical = dealt(victim, () =>
        asAbility(() => victim.takeDamage(40, caster, 'PHYSICAL'))
      );
      expect(physical, 'ability power is still amplifying physical damage').toBe(80);
    });

    it('counts only the bonus half, because the base is the champion', () => {
      const { victim, caster } = duo();
      caster.stats.attackDamage.baseValue = 60;

      const physical = dealt(victim, () =>
        asAbility(() => victim.takeDamage(40, caster, 'PHYSICAL'))
      );
      expect(physical, 'a champion with a big base got a build it never bought').toBe(40);
    });

    it('gives true damage whichever of the two the caster actually built', () => {
      // True damage has no resistance to read a stat off, and upstream it is
      // not a school — it is a property attached to abilities that scale on
      // whatever their champion is built around. Picking one stat for all of
      // them zeroes out a whole class of ultimates for half a roster.
      const { victim, caster } = duo();
      caster.stats.attackDamage.baseValue = 10;
      caster.stats.attackDamage.flatBonus = 20;

      const built = dealt(victim, () =>
        asAbility(() => victim.takeDamage(40, caster, 'TRUE'))
      );
      expect(built).toBe(80);

      const { victim: other, caster: mage } = duo();
      mage.stats.abilityPower.baseValue = 1;
      const cast = dealt(other, () =>
        asAbility(() => other.takeDamage(40, mage, 'TRUE'))
      );
      expect(cast).toBe(80);
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

    /**
     * `100 / (100 + haste)`, which is League's own curve and the reason the
     * stat is points rather than a percentage: 25 haste is a fifth off, and the
     * *next* 25 is another fifth off what is left. Every point is worth the
     * same against the base rate, so a shop can keep selling haste for ever
     * without a cap and without the last item being worthless.
     */
    it('shortens an ability by the haste curve', () => {
      const { caster } = duo();
      caster.stats.abilityHaste.baseValue = 25;

      expect(new Fireball(caster).effectiveCoolDownMs).toBe(8_000);
    });

    it('adds point for point, and the second helping is worth as much as the first', () => {
      const { caster } = duo();
      caster.stats.abilityHaste.baseValue = 100;
      expect(new Fireball(caster).effectiveCoolDownMs).toBe(5_000);

      // Casts per second is what haste is linear in: 100 haste doubles the
      // rate, 200 triples it. The *duration* curve flattening is what a
      // fraction-with-a-cap could never express.
      caster.stats.abilityHaste.baseValue = 200;
      expect(new Fireball(caster).effectiveCoolDownMs).toBeCloseTo(10_000 / 3, 6);
    });

    it('never reaches zero, so no amount of it turns a key into a held button', () => {
      const { caster } = duo();
      caster.stats.abilityHaste.baseValue = 100_000;

      const cooldown = new Fireball(caster).effectiveCoolDownMs;
      expect(cooldown).toBeGreaterThan(0);
      expect(caster.stats.abilityHaste.value).toBe(MAX_ABILITY_HASTE);
    });

    it('is floored at nothing, so a debuff cannot lengthen a cooldown past its tuning', () => {
      const { caster } = duo();
      caster.stats.abilityHaste.baseValue = -50;

      expect(new Fireball(caster).effectiveCoolDownMs).toBe(10_000);
    });

    it('leaves the casts that are not abilities at their full duration', () => {
      // The swing rhythm belongs to `stats.attackSpeed` and its own controller;
      // an item's cooldown is not shortened by another item either.
      const { caster } = duo();
      caster.stats.abilityHaste.baseValue = 100;

      const item = new Fireball(caster);
      item.countsAsAbilityCast = false;

      expect(item.effectiveCoolDownMs).toBe(10_000);
    });
  });
});
