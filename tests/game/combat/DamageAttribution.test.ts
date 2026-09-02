import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import SpellObject from '../../../src/game/gameObject/SpellObject';
import {
  abilityPowerScales,
  beginAttribution,
  currentAttribution,
  currentAttributionName,
  endAttribution,
  resetAttributionForTests,
} from '../../../src/game/combat/DamageAttribution';

/**
 * Who a nameless hit is filed under.
 *
 * `takeDamage`'s fourth argument is the ability's display name and the death
 * recap prints it; a caller that omits it used to land under the damage type,
 * so a player read "Sát thương phép" and learned nothing about what killed
 * them. Reported from a real match against an installed pack.
 *
 * Asking every ability to remember the string is what produced the state this
 * replaces — 224 sites across two packs pass it, 20 do not — so core infers it
 * instead, from the three places it already brackets the call into pack code.
 * See `src/game/combat/DamageAttribution.ts`.
 */
describe('damage attribution', () => {
  let game: TestGame & { matchTimeMs?: number };

  beforeEach(() => {
    stubGameGlobals();
    resetAttributionForTests();
    game = createGame() as TestGame & { matchTimeMs?: number };
    game.matchTimeMs = 0;
  });
  afterEach(() => {
    resetAttributionForTests();
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

  describe('the ambient itself', () => {
    it('is empty until something claims it', () => {
      expect(currentAttributionName()).toBeUndefined();
      expect(currentAttribution()).toBeNull();
    });

    it('restores what it replaced, so attributions nest', () => {
      // Not hypothetical: `DamageReflect` pays out by re-entering `takeDamage`
      // on the attacker from inside the victim's own damage pass, so a second
      // attribution opens while the first is still standing.
      const outer = beginAttribution({ name: 'Hỏa Cầu' });
      expect(currentAttributionName()).toBe('Hỏa Cầu');

      const inner = beginAttribution({ name: 'Giáp Gai' });
      expect(currentAttributionName()).toBe('Giáp Gai');
      endAttribution(inner);

      expect(currentAttributionName(), 'the outer attribution did not come back').toBe('Hỏa Cầu');
      endAttribution(outer);
      expect(currentAttributionName()).toBeUndefined();
    });

    it('answers whether an ability is running, opt-in and never by default', () => {
      // The second question the ambient answers, for `Stats.abilityPower`.
      // Opt-in is the load-bearing half: anything core adds later that deals
      // damage without saying it is an ability is amplified by nothing, rather
      // than silently inheriting a champion's whole build.
      expect(abilityPowerScales(), 'nothing running').toBe(false);

      const bare = beginAttribution({ name: 'Hỏa Cầu' });
      expect(abilityPowerScales(), 'a claimant that says nothing').toBe(false);
      endAttribution(bare);

      const swing = beginAttribution({ name: 'Đánh thường', damageScalesWithAbilityPower: false });
      expect(abilityPowerScales()).toBe(false);
      endAttribution(swing);

      const ability = beginAttribution({ name: 'Hỏa Cầu', damageScalesWithAbilityPower: true });
      expect(abilityPowerScales()).toBe(true);
      endAttribution(ability);

      expect(abilityPowerScales(), 'the ambient did not come back down').toBe(false);
    });

    it('unwinds the ability answer with the name, so a nested hit is judged on its own', () => {
      // An item's damage reflect re-enters `takeDamage` from inside the
      // victim's own pass. The inner hit is the item's and must not be
      // amplified by the ability that provoked it, and the outer hit must not
      // lose its amplification on the way back out.
      const outer = beginAttribution({ name: 'Hỏa Cầu', damageScalesWithAbilityPower: true });
      const inner = beginAttribution({ name: 'Giáp Gai', damageScalesWithAbilityPower: false });
      expect(abilityPowerScales()).toBe(false);
      endAttribution(inner);

      expect(abilityPowerScales()).toBe(true);
      endAttribution(outer);
    });

    it('treats a nameless claimant as no claim at all', () => {
      // A `SpellObject` built outside any cast is stamped `null`, and an
      // anonymous class has `name` undefined. Either way the recap has to fall
      // back to the damage type exactly as it did before, not to an empty row.
      const previous = beginAttribution({});
      expect(currentAttributionName()).toBeUndefined();
      endAttribution(previous);
    });
  });

  describe('what the ledger records', () => {
    it('names the hit after whatever was running', () => {
      const { victim, killer } = duo();
      const previous = beginAttribution({ name: 'Hỏa Cầu (Vera_Q)' });
      victim.takeDamage(20, killer, 'MAGIC');
      endAttribution(previous);

      expect(victim.recentDamageLog[0].source).toBe('Hỏa Cầu (Vera_Q)');
    });

    it('lets an explicit source win, because five sites mean something by it', () => {
      // Five sites across the installed packs name a sub-ability or a single
      // projectile rather than the spell that fired it. An ambient that
      // overrode those would be a downgrade, so it only ever fills silence.
      const { victim, killer } = duo();
      const previous = beginAttribution({ name: 'Ánh Trăng' });
      victim.takeDamage(20, killer, 'MAGIC', 'Trăng Lưỡi Liềm');
      endAttribution(previous);

      expect(victim.recentDamageLog[0].source).toBe('Trăng Lưỡi Liềm');
    });

    it('leaves the hit nameless when nothing is running', () => {
      // The pre-existing behaviour, and it has to survive: `hudState` falls back
      // to the damage-type label, which is right for a hit that genuinely has no
      // ability behind it.
      const { victim, killer } = duo();
      victim.takeDamage(20, killer, 'MAGIC');

      expect(victim.recentDamageLog[0].source).toBeUndefined();
    });
  });

  describe('a spell object carries its cast with it', () => {
    it('is stamped with whatever was casting when it was built', () => {
      const { killer } = duo();
      const spell = { name: 'Hỏa Cầu (Vera_Q)' };

      const previous = beginAttribution(spell);
      const missile = new SpellObject(killer);
      endAttribution(previous);

      expect(missile.attributedTo).toBe(spell);
    });

    it('is stamped null when built outside a cast', () => {
      const { killer } = duo();
      expect(new SpellObject(killer).attributedTo).toBeNull();
    });

    it('names the damage it deals frames later, through ObjectManager', () => {
      // The whole point. A missile's `onHit` runs during `objectManager.update()`
      // long after the cast returned, on an object with no `name` of its own.
      const { victim, killer } = duo();
      const spell = { name: 'Hỏa Cầu (Vera_Q)' };

      const previous = beginAttribution(spell);
      const missile = new SpellObject(killer);
      endAttribution(previous);

      // What a real missile does on the frame it connects.
      missile.update = () => victim.takeDamage(20, killer, 'MAGIC');
      game.objectManager.addObject(missile);
      // `addObject` queues; the drain happens *after* the update walk, so the
      // first pass is the one that admits it and the second is the one that
      // ticks it. Two passes is what a real missile's first live frame is.
      game.objectManager.update();
      game.objectManager.update();

      expect(victim.recentDamageLog.at(-1)?.source).toBe('Hỏa Cầu (Vera_Q)');
    });

    /**
     * `onRemoved` is where a missile that reached its range does its work —
     * three abilities in the installed packs end that way, and each builds its
     * blast object there. Outside the bracket that object is stamped
     * `attributedTo: null`, so the blast it deals frames later is not ability
     * damage and `Stats.abilityPower` never reaches it: a throw that hit
     * somebody was amplified and the identical throw that landed on the ground
     * was not.
     */
    it('names the damage a missile deals on the frame it is removed', () => {
      const { victim, killer } = duo();
      const spell = { name: 'Hỏa Cầu (Vera_Q)' };

      const previous = beginAttribution(spell);
      const missile = new SpellObject(killer);
      endAttribution(previous);

      missile.onRemoved = () => victim.takeDamage(20, killer, 'MAGIC');
      missile.toRemove = true;
      game.objectManager.addObject(missile);
      game.objectManager.update();
      game.objectManager.update();

      expect(victim.recentDamageLog.at(-1)?.source).toBe('Hỏa Cầu (Vera_Q)');
    });

    /**
     * And `onAdded`, where an effect that acts on arrival acts. A pack moving a
     * bite from its update clock to its arrival — the fix for a 180ms gap
     * between a burst and its number — took a champion from 449 damage to 31,
     * with the tooltip still promising the 449.
     */
    it('and the damage an effect deals in the frame it arrives', () => {
      const { victim, killer } = duo();
      const spell = { name: 'Hỏa Cầu (Vera_Q)' };

      const previous = beginAttribution(spell);
      const blast = new SpellObject(killer);
      endAttribution(previous);

      blast.onAdded = () => victim.takeDamage(20, killer, 'MAGIC');
      game.objectManager.addObject(blast);
      game.objectManager.update();

      expect(victim.recentDamageLog.at(-1)?.source).toBe('Hỏa Cầu (Vera_Q)');
    });

    /**
     * The half a name cannot show: `abilityPowerScales()` is what `takeDamage`
     * asks before multiplying by the caster's build, and it reads the same
     * ambient. A callback outside the bracket answers `false` and the whole
     * shop disappears from the number, silently.
     */
    it('and pays the caster’s ability power from every one of the three', () => {
      for (const hook of ['update', 'onAdded', 'onRemoved'] as const) {
        const { victim, killer } = duo();
        killer.stats.abilityPower.baseValue = 1;
        // Otherwise the pool ticks back up between the two passes and the
        // subtraction measures regeneration as well as the hit.
        victim.stats.healthRegen.baseValue = 0;
        // The flag is what `abilityPowerScales()` actually reads; a `Spell`
        // sets it true and an item's own ability sets it false.
        const previous = beginAttribution({
          name: 'Hỏa Cầu (Vera_Q)',
          damageScalesWithAbilityPower: true,
        });
        const object = new SpellObject(killer);
        endAttribution(previous);

        const before = victim.stats.health.baseValue;
        object[hook] = () => victim.takeDamage(20, killer, 'MAGIC');
        if (hook === 'onRemoved') object.toRemove = true;
        game.objectManager.addObject(object);
        game.objectManager.update();
        game.objectManager.update();

        expect(before - victim.stats.health.baseValue, `${hook} dropped the build`).toBe(40);
      }
    });

    it('leaves the ambient clean afterwards, even when an update throws', () => {
      const { killer } = duo();
      const missile = new SpellObject(killer);
      missile.update = () => {
        throw new Error('boom');
      };
      game.objectManager.addObject(missile);
      game.objectManager.update();

      expect(() => game.objectManager.update()).toThrow('boom');
      expect(currentAttributionName(), 'a thrown update leaked its attribution').toBeUndefined();
    });
  });

  describe('a buff names its own ticks', () => {
    it('files damage dealt during its update under itself', () => {
      // `DamageOverTime` and an item's `DamageReflect` both deal damage from
      // inside a tick and neither names a source; both already carry the display
      // name the recap wants.
      const { victim, killer } = duo();
      const burn = {
        name: 'Thiêu Rụi',
        toRemove: false,
        statusFlagsToEnable: 0,
        statusFlagsToDisable: 0,
        update: () => victim.takeDamage(5, killer, 'MAGIC'),
        // `takeDamage` walks every buff twice — once to let it change the
        // number, once to let it react. A stub missing either is a stub that
        // cannot reach the line under test.
        modifyIncomingDamage: (damage: number) => damage,
        onDamageTaken: () => undefined,
      };
      victim.buffs.push(burn as never);

      victim.update();

      expect(victim.recentDamageLog.at(-1)?.source).toBe('Thiêu Rụi');
    });
  });
});
