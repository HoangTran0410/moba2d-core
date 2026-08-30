import { describe, expect, it } from 'vitest';
import { amplifiedDamageText } from '../../../src/game/combat/Amplification';
import Spell from '../../../src/game/gameObject/Spell';

/**
 * The number a player reads, against the number they take.
 *
 * A spell's description is authored text with its damage baked in, so the HUD
 * showed first-frame tuning for the whole match while `takeDamage` quietly
 * multiplied by `Stats.abilityPower`. Buying 200% ability power tripled the
 * hit and changed nothing on the bar — and an item that silently works is
 * indistinguishable from one that silently does not.
 *
 * Everything here is a plain string transform, so it is driven with plain
 * strings; the wiring half — that the HUD reads the scaled one — is
 * `hudState.spellDescription.test.ts`.
 */

const power = (value: number) => ({ stats: { abilityPower: { value } } });

describe('scaling the printed damage', () => {
  it('keeps the pack\'s own figure and states what the build adds', () => {
    // `15 (+30)`, not `45`. The total alone answers what the spell hits for
    // and loses what the item is contributing, which is the question somebody
    // reading this text is usually asking.
    const text = 'Gây <span class="damage">15 sát thương</span> lên kẻ địch';

    expect(amplifiedDamageText(text, power(2))).toBe(
      'Gây <span class="damage">15 (+30) sát thương</span> lên kẻ địch'
    );
  });

  it('leaves the sentence alone at no ability power, byte for byte', () => {
    // Every unit in the game until an item or a buff grants some, which is
    // also the state every existing screenshot and test was written against.
    const text = 'Gây <span class="damage">15 sát thương</span> lên kẻ địch';

    expect(amplifiedDamageText(text, power(0))).toBe(text);
    expect(amplifiedDamageText(text, undefined)).toBe(text);
  });

  it('scales each span on a line separately, not the first one twice', () => {
    const text =
      '<span class="damage">20 sát thương</span> rồi <span class="damage">4 sát thương</span>';

    expect(amplifiedDamageText(text, power(1))).toBe(
      '<span class="damage">20 (+20) sát thương</span> rồi' +
        ' <span class="damage">4 (+4) sát thương</span>'
    );
  });

  it('touches nothing outside a damage span', () => {
    // Durations, radii, shields and counts are not amplified by ability
    // power. A blanket number-scaler would have promised a 10-second stun.
    const text =
      'Khiên <span class="buff">70</span> trong <span class="time">5 giây</span>, ' +
      'gây <span class="damage">10 sát thương</span> trong <span>150px</span>';

    expect(amplifiedDamageText(text, power(1))).toBe(
      'Khiên <span class="buff">70</span> trong <span class="time">5 giây</span>, ' +
        'gây <span class="damage">10 (+10) sát thương</span> trong <span>150px</span>'
    );
  });

  it('keeps a decimal readable rather than printing a float', () => {
    const text = '<span class="damage">4 sát thương</span> mỗi 0.5 giây';

    // The bonus is 1.4000000000000004 in binary floating point.
    expect(amplifiedDamageText(text, power(0.35))).toBe(
      '<span class="damage">4 (+1.4) sát thương</span> mỗi 0.5 giây'
    );
  });

  it('and drops a trailing .0 rather than showing one', () => {
    const text = '<span class="damage">10 sát thương</span>';
    expect(amplifiedDamageText(text, power(0.5))).toBe(
      '<span class="damage">10 (+5) sát thương</span>'
    );
  });

  it('prints a suppression as a subtraction rather than as (+-5)', () => {
    // `Stats.abilityPower` floors at -1, so a strong enough suppression is a
    // real state and not a hypothetical.
    const text = '<span class="damage">20 sát thương</span>';
    expect(amplifiedDamageText(text, power(-0.25))).toBe(
      '<span class="damage">20 (-5) sát thương</span>'
    );
  });

  it('refuses a percentage, which no amount of power changes', () => {
    // A real line from the shipped pack: three damage spans, of which exactly
    // one is a flat figure. Scaling the other two would have promised 300%.
    const text =
      'sát thương từ <span class="damage">40%</span> tới <span class="damage">100%</span>' +
      ' của <span class="damage">30</span>';

    expect(amplifiedDamageText(text, power(2))).toBe(
      'sát thương từ <span class="damage">40%</span> tới <span class="damage">100%</span>' +
        ' của <span class="damage">30 (+60)</span>'
    );
  });

  /**
   * The day a pack labels its damage types, every span it owns gains a second
   * class — and the pattern that decides what gets amplified was written to
   * match `class="damage"` exactly. A silent stop here is the worst kind: the
   * sentence still renders, still reads correctly, and quietly promises the
   * spell's first-frame number for the rest of the match.
   */
  it('scales a span that also names its damage type', () => {
    for (const type of ['physical', 'magic', 'true']) {
      expect(
        amplifiedDamageText(`gây <span class="damage ${type}">40 sát thương</span>`, power(0.5))
      ).toBe(`gây <span class="damage ${type}">40 (+20) sát thương</span>`);
    }
  });

  it('and still refuses a class it was never told about', () => {
    // The three names are spelled out in the pattern rather than matched with
    // a wildcard, so a class this engine has no rule for cannot enrol itself
    // into being amplified by inventing a name.
    const written = 'gây <span class="damage chaos">40 sát thương</span>';
    expect(amplifiedDamageText(written, power(0.5))).toBe(written);
  });

  it('leaves a span that does not open with a number exactly as written', () => {
    // Guessing at "sát thương bằng 60% máu tối đa" would print a number the
    // spell never deals.
    const text = '<span class="damage">sát thương bằng 60% máu tối đa</span>';
    expect(amplifiedDamageText(text, power(2))).toBe(text);
  });
});

describe('the spell that owns the description', () => {
  class Probe extends Spell {
    description = 'Gây <span class="damage">30 sát thương</span>';
  }

  const wielder = (abilityPower: number) => ({
    stats: { abilityPower: { value: abilityPower } },
  });

  it('reports what this owner actually hits for', () => {
    const spell = new Probe(wielder(1) as never);
    expect(spell.effectiveDescription).toBe('Gây <span class="damage">30 (+30) sát thương</span>');
  });

  it('but not for a spell that declined the scaling rule', () => {
    // `damageScalesWithAbilityPower` is what `takeDamage` asks before
    // amplifying, so the printed number has to ask the same question or the
    // bar promises damage the cast path will not deal.
    const spell = new Probe(wielder(1) as never);
    spell.damageScalesWithAbilityPower = false;

    expect(spell.effectiveDescription).toBe('Gây <span class="damage">30 sát thương</span>');
  });

  it('and not for an ownerless catalogue instance', () => {
    // `pregameCatalog` builds these to list a kit before a match exists;
    // there is no build to count and nothing to scale by.
    const spell = new Probe(undefined as never);
    expect(spell.effectiveDescription).toBe('Gây <span class="damage">30 sát thương</span>');
  });

  it('survives a spell that has no description at all', () => {
    const spell = new Spell(wielder(1) as never);
    expect(spell.effectiveDescription).toBeNull();
  });
});
