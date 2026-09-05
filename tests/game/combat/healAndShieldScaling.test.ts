import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Shield from '@/game/gameObject/buffs/Shield';
import {
  beginAttribution,
  endAttribution,
  resetAttributionForTests,
} from '@/game/combat/DamageAttribution';
import { amplifiedDamageText } from '@/game/combat/Amplification';
import CombatText from '@/game/gameObject/helpers/CombatText';

/**
 * The other two thirds of what a build does to a kit.
 *
 * `Stats.abilityPower` was designed as one multiplier at the funnel every
 * ability already passes through, and exactly one of the three funnels was
 * ever wired to it. Damage scaled; heals and shields did not — so a support
 * with a full ability build restored, to the point, what it restored on the
 * first frame of the match. That is `abilityScaling.test.ts`'s own opening
 * complaint, aimed at the half of a roster that does not deal damage, and it
 * was reported the same obvious way: "my ability power is huge and the heals
 * still heal almost nothing".
 *
 * The shield half arrived with a second symptom that made it undeniable. A
 * shield's description already *promised* the bonus — the HUD rescales a
 * tagged number by the reader's ability power — so one ability read
 * "absorbs 30 (+200) damage" and applied a shield of thirty. The text was
 * right about the design; the engine was the half nobody had written.
 *
 * Everything here is the same gate the damage funnel uses, so the boundary
 * cases are the ones that matter: a heal that no ability cast, and a heal that
 * is a *share of damage already amplified*.
 */
describe('a build reaches heals and shields', () => {
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
    const ally = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    const caster = new Champion({ game, position: createVector(100, 0), teamId: 'blue' });
    ally.stats.maxHealth.baseValue = 10_000;
    ally.stats.health.baseValue = 100;
    game.setPlayer(ally);
    indexObjects(game, [ally, caster]);
    return { ally, caster };
  };

  /** Whatever `body` does, done the way an ability does it: inside its cast. */
  const asAbility = <T>(body: () => T): T => {
    const previous = beginAttribution({ name: 'Ban Phước', damageScalesWithAbilityPower: true });
    try {
      return body();
    } finally {
      endAttribution(previous);
    }
  };

  describe('a heal', () => {
    it('is inert until something grants the stat', () => {
      // The migration argument: no pack's heal was retuned when this landed.
      const { ally, caster } = duo();
      asAbility(() => ally.takeHeal(40, caster));
      expect(ally.stats.health.baseValue).toBe(140);
    });

    it('takes the caster’s ability power, like the caster’s damage does', () => {
      const { ally, caster } = duo();
      caster.stats.abilityPower.baseValue = 1.5;

      asAbility(() => ally.takeHeal(40, caster));

      expect(ally.stats.health.baseValue).toBe(200);
    });

    it('reads the *healer*, not the unit being healed', () => {
      // The parameter had been in the signature since heals existed, spelled
      // `_healer` and never read. Both packs already passed the caster, which
      // is why turning it on needed no pack edit — and why getting the side
      // wrong here would be invisible in most matches and wrong in every one.
      const { ally, caster } = duo();
      ally.stats.abilityPower.baseValue = 5;
      caster.stats.abilityPower.baseValue = 1;

      asAbility(() => ally.takeHeal(40, caster));

      expect(ally.stats.health.baseValue).toBe(180);
    });

    it('is not amplified when no ability is casting', () => {
      // A regeneration tick, a fountain, anything core does on its own: the
      // ambient answers `false` and nothing scales. Opt-in, like the damage
      // funnel — see `DamageAttribution.abilityPowerScales`.
      const { ally, caster } = duo();
      caster.stats.abilityPower.baseValue = 1.5;

      ally.takeHeal(40, caster);

      expect(ally.stats.health.baseValue).toBe(140);
    });

    it('does not pay omnivamp twice out of one stat', () => {
      // The one place this could go badly wrong. Life-steal heals a share of
      // damage that has *already* been amplified, from inside the damage pass
      // — so healing it under the same ambient would multiply the caster's
      // ability power into the same number a second time.
      const { caster } = duo();
      const victim = new Champion({ game, position: createVector(50, 0), teamId: 'red' });
      victim.stats.maxHealth.baseValue = 10_000;
      victim.stats.health.baseValue = 10_000;
      indexObjects(game, [victim]);

      caster.stats.abilityPower.baseValue = 1;
      caster.stats.omnivamp.baseValue = 0.5;
      caster.stats.maxHealth.baseValue = 10_000;
      caster.stats.health.baseValue = 100;

      // 100 base, amplified once to 200; half of 200 is 100 back.
      asAbility(() => victim.takeDamage(100, caster, 'MAGIC'));

      expect(caster.stats.health.baseValue).toBe(200);
    });
  });

  describe('a shield', () => {
    const shieldOn = (ally: Champion, caster: Champion, amount: number): Shield => {
      const shield = new Shield(5_000, caster, ally);
      shield.amount = amount;
      asAbility(() => ally.addBuff(shield));
      return shield;
    };

    it('absorbs what the build says, not what the pack typed', () => {
      const { ally, caster } = duo();
      caster.stats.abilityPower.baseValue = 1.5;

      const shield = shieldOn(ally, caster, 30);

      expect(shield.amount).toBe(75);
      expect(ally.shieldAmount).toBe(75);
    });

    it('draws its bar against what it actually started at', () => {
      // `_initialAmount` is the denominator the shield bar reads. Amplifying
      // after it is set gives a shield that starts at 75 and reads as full at
      // 30 — a worse bug than the one being fixed, and an easy one to write.
      const { ally, caster } = duo();
      caster.stats.abilityPower.baseValue = 1.5;

      expect(shieldOn(ally, caster, 30)._initialAmount).toBe(75);
    });

    it('really eats the bigger number on the way in', () => {
      const { ally, caster } = duo();
      caster.stats.abilityPower.baseValue = 1;
      shieldOn(ally, caster, 30);
      const health = ally.stats.health.baseValue;

      const attacker = new Champion({ game, position: createVector(200, 0), teamId: 'red' });
      ally.takeDamage(50, attacker, 'TRUE');

      expect(ally.stats.health.baseValue).toBe(health);
    });

    it('is not amplified when an item granted it', () => {
      // Item abilities opt out of ability scaling — they already read
      // `attackDamage`, and paying one purchase out of two stats is the rule
      // `economy/ItemShop` sets `damageScalesWithAbilityPower: false` for.
      const { ally, caster } = duo();
      caster.stats.abilityPower.baseValue = 1.5;

      const shield = new Shield(5_000, caster, ally);
      shield.amount = 30;
      const previous = beginAttribution({ name: 'Vòng Sắt', damageScalesWithAbilityPower: false });
      try {
        ally.addBuff(shield);
      } finally {
        endAttribution(previous);
      }

      expect(shield.amount).toBe(30);
    });
  });

  describe('what the description promises', () => {
    it('rescales a heal span the way it rescales a damage one', () => {
      // Two classes, one claim, differing only in the colour the stylesheet
      // paints. Before the engine amplified heals at all, a pack that wanted
      // to promise this bonus had only `damage` to tag it with — which printed
      // a heal in the damage red *and* promised a scaling that never happened.
      const source = { stats: { abilityPower: { value: 1 } } };

      expect(amplifiedDamageText('hồi <span class="heal">40 máu</span>', source)).toBe(
        'hồi <span class="heal">40 (+40) máu</span>'
      );
    });

    it('still leaves a duration and a percentage alone', () => {
      const source = { stats: { abilityPower: { value: 1 } } };
      const text = 'chậm <span class="buff">30%</span> trong <span class="time">4 giây</span>';

      expect(amplifiedDamageText(text, source)).toBe(text);
    });
  });

  /**
   * A heal lands only into missing health, and the floating number reports
   * what landed — exactly as takeDamage's number is the landed hit.
   *
   * Reported from a real match: a Heart-style "regenerate after 5s out of
   * combat" item passive ticks `takeHeal` every second, and on a full-health
   * champion the old code showed the requested amount before the clamp — a
   * green number every second, forever, healing nothing.
   */
  describe('a heal against a full or nearly full pool', () => {
    // A plain loop, not `.filter(predicate)` — the polyfilled prototypes put
    // the non-narrowing overload first, the CLAUDE.md trap.
    const liveTexts = (): CombatText[] => {
      const texts: CombatText[] = [];
      for (const object of [...game.objectManager.objects, ...game.objectManager._objectToBeAdd])
        if (object instanceof CombatText) texts.push(object);
      return texts;
    };

    it('shows nothing and changes nothing on a full-health unit', () => {
      const { ally, caster } = duo();
      ally.stats.health.baseValue = ally.stats.maxHealth.value;

      ally.takeHeal(20, caster);

      expect(ally.stats.health.baseValue).toBe(ally.stats.maxHealth.value);
      expect(liveTexts()).toHaveLength(0);
    });

    it('floats the landed amount, not the requested one, when the pool almost has room', () => {
      const { ally, caster } = duo();
      ally.stats.health.baseValue = ally.stats.maxHealth.value - 5;

      ally.takeHeal(20, caster);

      expect(ally.stats.health.baseValue).toBe(ally.stats.maxHealth.value);
      const [text] = liveTexts();
      expect(text.amount).toBe(5);
    });
  });
});
