import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import MatchDirectorSource, {
  type MatchDirectorHost,
} from '@/game/hud/config/MatchDirectorSource';
import Spell from '@/game/gameObject/Spell';

/**
 * What the Đội tab says a champion's ability does.
 *
 * ## Two reports, one control
 *
 * *"khi ở in-game đang ko xem đc chỉ số sau khi cộng items vào, nên ko xem đc
 * damage thật sự của từng chiêu thức của champ khác"* — the card quoted the
 * spell's authored text, which has a first-frame number baked into it, while
 * `takeDamage` scales that number by the owner's `Stats.abilityPower`. So a
 * champion with six items read exactly like a champion with none, and an item
 * that silently works is indistinguishable from one that silently does not.
 * `Spell.effectiveDescription` had existed for this since the HUD bar hit the
 * same bug; this call site simply read past it.
 *
 * *"render item detail và spell detail đang khác nhau? 1 cái inline, 1 cái hiện
 * modal"* — and the heavier shape was on the lighter question. Both are now
 * cards in the same strip between the row and its stat sheet.
 *
 * The scaling itself is `amplifiedDamageText.test.ts` and the bar's half is
 * `hudState.test.ts`; what is left for here is the wiring, which is the part
 * that was wrong.
 */

const roster = (unit: unknown): MatchDirectorHost =>
  ({ director: { roster: () => [{ unit }] } }) as unknown as MatchDirectorHost;

/** A champion carrying one real `Spell`, with as much ability power as asked. */
const championWith = (abilityPower: number, description: string) => {
  const unit: Record<string, unknown> = {
    id: 'blue-1',
    stats: { abilityPower: { value: abilityPower } },
    game: { matchRules: { cooldownMultiplier: 1, manaFree: false } },
  };
  const spell = new Spell(unit);
  // `Spell` refuses to exist without one; nothing here casts, but the base
  // class checks in its constructor.
  spell.targetingMode = 'SELF';
  spell.name = 'Chiêu';
  spell.description = description;
  unit.spells = { 1: spell };
  return unit;
};

const RAW = 'Gây <span class="damage">100 sát thương</span> phép';

describe('the ability card in the Đội tab', () => {
  it('quotes the damage the champion’s build actually deals', () => {
    const source = new MatchDirectorSource(roster(championWith(1.5, RAW)));

    // `100 (+150)`, not `100` and not `250`: the pack's own figure, and what
    // the build adds beside it. See `Amplification.ts`.
    expect(source.describeAbility('blue-1', 'Q')?.description).toBe(
      'Gây <span class="damage">100 (+150) sát thương</span> phép'
    );
  });

  it('leaves a champion with no items reading exactly as authored', () => {
    const source = new MatchDirectorSource(roster(championWith(0, RAW)));
    expect(source.describeAbility('blue-1', 'Q')?.description).toBe(RAW);
  });
});

/**
 * The shape half. There is no DOM in this suite, so what can be checked is
 * that the modal is gone and the card is in the strip the bag square's card
 * already uses — and, the part that made the numbers *stay* wrong, that the
 * card re-describes the spell instead of holding a display taken at open time.
 */
describe('the card’s shape', () => {
  const tab = (): string =>
    readFileSync(join(__dirname, '../../../src/game/hud/config/RosterTab.vue'), 'utf8');

  it('opens in the row rather than as a dialog over it', () => {
    const source = tab();
    expect(source).not.toContain('SpellPreviewModal');
    expect(source).toContain('class="practice-spell-card"');
    // Directly beside the bag square's card, which is what "the same slot"
    // means — both are children of the row, above the stat sheet.
    expect(source.indexOf('practice-item-card')).toBeLessThan(
      source.indexOf('class="practice-spell-card"')
    );
    expect(source.indexOf('class="practice-spell-card"')).toBeLessThan(
      source.indexOf('class="practice-stat-sheet"')
    );
  });

  /**
   * The reason the state is `{ rowId, letter }` and not a `SpellDisplay`: a
   * display resolved once is a description that stops being true the moment
   * the champion buys the ability power it quotes. Reading `panel.version` is
   * what re-runs it on the panel's own tick.
   */
  it('re-describes the spell on every repaint instead of snapshotting it', () => {
    const source = tab();
    const at = source.indexOf('const openedSpellOf');
    expect(at, 'openedSpellOf is gone').toBeGreaterThan(0);
    const body = source.slice(at, source.indexOf('};', at));
    expect(body).toContain('void panel.version.value;');
    expect(body).toContain('source.describeAbility(');
  });

  /**
   * `GameScene` calls `preventDefault()` on every touch on the page, so a
   * `@click`-only control is perfect under a mouse and dead under a thumb —
   * the failure this codebase has shipped three times. The kit icon was one:
   * it had no `v-tap` while every other control in the file did, so on the
   * phone this was reported from, the icons did nothing at all.
   */
  it('answers a thumb, not only a mouse', () => {
    const source = tab();
    const at = source.indexOf('class="practice-roster-spell"');
    // A fixed window rather than a slice to the next `>`: the handlers are
    // arrow functions, so the first `>` in this element is inside one.
    const button = source.slice(at, at + 600);
    expect(button).toContain('@click="ability.describable && toggleSpell(');
    expect(button).toContain('v-tap="() => ability.describable && toggleSpell(');
  });
});
