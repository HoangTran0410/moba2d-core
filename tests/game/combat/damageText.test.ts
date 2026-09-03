import { describe, expect, it } from 'vitest';
import { dmg, dmgRange, dmgValue, heal, pct, tint } from '@/game/combat/DamageText';
import { amplifiedDamageText } from '@/game/combat/Amplification';

/** A caster with 100% ability power and 20 points of bonus attack damage. */
const build = { stats: { abilityPower: { value: 1 }, attackDamage: { value: 30, baseValue: 10 } } };
/** Bought nothing. */
const bare = { stats: { abilityPower: { value: 0 }, attackDamage: { value: 10, baseValue: 10 } } };

const scale = (text: string) => amplifiedDamageText(text, build);
const strip = (html: string) => html.replace(/<[^>]*>/g, '');

describe('a figure a helper wrote', () => {
  it('scales on the stat its own type names, not on whichever is bigger', () => {
    // 20 bonus attack damage at `ABILITY_SCALING_PER_ATTACK_DAMAGE` is +100%,
    // deliberately the same multiplier the ability power grants, so a wrong
    // stat would still be caught by the *other* half of each case below.
    // The noun comes from the type, so the sentence cannot contradict the code.
    expect(strip(scale(dmg(26, 'MAGIC')))).toBe('26 (+26) sát thương phép');
    expect(strip(scale(dmg(26, 'PHYSICAL')))).toBe('26 (+26) sát thương vật lý');

    const apOnly = { stats: { abilityPower: { value: 1 }, attackDamage: { value: 10, baseValue: 10 } } };
    // A physical figure gets nothing from a pure ability-power build.
    expect(amplifiedDamageText(dmg(26, 'PHYSICAL'), apOnly)).toBe(dmg(26, 'PHYSICAL'));
    expect(strip(amplifiedDamageText(dmg(26, 'MAGIC'), apOnly))).toBe('26 (+26) sát thương phép');
  });

  it('survives a leading sign, which is what the old parser could not', () => {
    // `<span class="damage">+6 …</span>` shipped in a pack and never rescaled
    // once, because the span did not open with a digit. The helper writes the
    // figure, so the sign is simply outside it and nothing depends on where a
    // digit happens to fall.
    expect(strip(scale(`+${dmg(6, 'MAGIC')}`))).toBe('+6 (+6) sát thương phép');
  });

  it('has no tail to confuse, and does not rewrite its own attribute', () => {
    // `inner` is `26` and the tag carries `data-base="26"`. A string replace
    // would hit the attribute first and produce unparseable markup.
    const out = scale(dmgValue(26, 'MAGIC'));
    expect(out).toContain('data-base="26"');
    expect(strip(out)).toBe('26 (+26)');
  });

  it('carries a bonus on both ends of a range, keeping the pack’s punctuation', () => {
    expect(strip(scale(dmgRange(18, 48, 'MAGIC')))).toBe(
      '18 (+18)–48 (+48) sát thương phép'
    );
    expect(strip(scale(dmgRange(3, 5, 'MAGIC', '', ' - ')))).toBe(
      '3 (+3) - 5 (+5) sát thương phép'
    );
  });

  it('scales a heal by ability power, which is the only stat a heal reads', () => {
    expect(strip(scale(heal(40, ' máu')))).toBe('40 (+40) máu');
    const adOnly = { stats: { abilityPower: { value: 0 }, attackDamage: { value: 30, baseValue: 10 } } };
    expect(amplifiedDamageText(heal(40, ' máu'), adOnly)).toBe(heal(40, ' máu'));
  });

  it('leaves paint alone, and says in the markup that it meant to', () => {
    // The population that used to be indistinguishable from a broken figure.
    for (const painted of [tint('tướng địch'), tint('Chảy Máu'), pct(30, 'MAGIC', ' sát thương phép')]) {
      expect(scale(painted)).toBe(painted);
      expect(painted).toContain('data-flat="none"');
    }
  });

  it('returns a description untouched for a caster who has bought nothing', () => {
    const text = `gây ${dmg(26, 'MAGIC')} và hồi ${heal(40, ' máu')}`;
    expect(amplifiedDamageText(text, bare)).toBe(text);
  });

  it('scales two figures of different types in one sentence, each on its own stat', () => {
    const apOnly = { stats: { abilityPower: { value: 1 }, attackDamage: { value: 10, baseValue: 10 } } };
    const text = `${dmgValue(20, 'PHYSICAL')} rồi ${dmgValue(20, 'MAGIC')}`;
    expect(strip(amplifiedDamageText(text, apOnly))).toBe('20 rồi 20 (+20)');
  });
});

describe('a span typed out by hand', () => {
  it('still scales, so a pack built against an older core keeps working', () => {
    // The prose-guessing parser is kept for exactly this and is unreachable
    // from the packs shipped here — `describeSpellDescriptions` holds those to
    // the helpers.
    expect(strip(scale('<span class="damage magic">26 sát thương</span>'))).toBe(
      '26 (+26) sát thương'
    );
  });

  it('and the helpers are not raked over a second time by it', () => {
    // Both passes run over the same string. A helper span that the legacy
    // regex also matched would have its bonus scaled twice.
    expect(strip(scale(dmg(26, 'MAGIC')))).toBe('26 (+26) sát thương phép');
  });

  it('writes the noun from the type, so prose cannot contradict the code', () => {
    // The defect this closes: `dmg(60, 'MAGIC', ' sát thương chuẩn')` used to
    // type-check, render violet, deal magic damage and tell the player it was
    // true damage. Four spells in one pack shipped exactly that way.
    expect(strip(dmg(60, 'TRUE'))).toBe('60 sát thương chuẩn');
    expect(strip(dmg(60, 'MAGIC'))).toBe('60 sát thương phép');
    // A tail is what comes *after* the noun, never instead of it.
    expect(strip(dmg(3, 'MAGIC', ' mỗi giây'))).toBe('3 sát thương phép mỗi giây');
    // And a figure that should carry no noun says so with its own helper,
    // rather than by passing an empty string nobody can tell from an oversight.
    expect(strip(dmgValue(60, 'MAGIC'))).toBe('60');
  });
});
