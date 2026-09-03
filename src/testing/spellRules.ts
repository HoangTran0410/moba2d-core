import { describe, expect, it } from 'vitest';
import {
  BASE_ATTRIBUTE,
  BASE_HIGH_ATTRIBUTE,
  FLAT_NONE_ATTRIBUTE,
  printFigure,
} from '@/game/combat/DamageText';

/**
 * The rules every pack's spell and item text is held to — **one copy**, here,
 * for the same reason `testing/itemRules.ts` is one copy.
 *
 * ## Why this is core's and not each pack's
 *
 * Three packs each grew a description scan, and the three checked different
 * things. One held a span to being a flat figure and never checked its damage
 * type; one checked the type against the file's own `takeDamage` and did not
 * check that heals put the figure first; the third checked neither. So a bug
 * caught in one pack shipped happily in the other two — which is how 38 spans
 * in one pack spent their whole life claiming to scale with ability power
 * while the abilities behind them dealt physical damage.
 *
 * The rules belong beside the parser that gives them meaning
 * (`combat/DamageText.ts` and `combat/Amplification.ts`), because the parser
 * is the thing that decides what "valid" is. A pack restating them is a pack
 * guessing at core's contract from the outside.
 *
 * ## What it holds
 *
 * The load-bearing rule is the first one: **a coloured number is written by a
 * helper**. Everything the old hand-typed spans could get wrong — a missing
 * damage type, a `+` in front of the digits, a sword count wearing the damage
 * class — is either impossible once `dmg()` writes the markup or is an
 * explicit `tint()`. The rest of the cases below are the seams that a helper
 * cannot close on its own.
 */

/** A `damage`/`heal` span, however it was written. */
const ANY_SPAN = /<span class="(damage|heal)([^"]*)"([^>]*)>([\s\S]*?)<\/span>/g;

const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];

export interface SpellTextSubject {
  /** Every description this pack ships, by a name a failure can be chased with. */
  descriptions: () => [string, string][];
  /**
   * Spans this pack is allowed to have typed by hand, by id — an escape hatch
   * that has to be *named*, so an un-migrated file is a line in a diff rather
   * than a silence.
   */
  handWritten?: readonly string[];
}

export function describeSpellDescriptions(subject: SpellTextSubject): void {
  const shipped = () => subject.descriptions();
  const exempt = new Set(subject.handWritten ?? []);

  describe('every coloured number this pack ships', () => {
    it('was written by a helper, so it cannot have forgotten anything', () => {
      // The rule that makes the rest unnecessary. A span carrying neither
      // `data-base` nor `data-flat` is one somebody typed out — which is
      // allowed to work, and is not allowed to be *silent*: it either scales
      // by a parser guessing at prose, or it does not and nothing says so.
      const typed: string[] = [];
      for (const [id, description] of shipped()) {
        if (exempt.has(id)) continue;
        for (const [whole, , , tag] of description.matchAll(ANY_SPAN)) {
          const hasBase = attribute(tag, BASE_ATTRIBUTE) !== undefined;
          const painted = attribute(tag, FLAT_NONE_ATTRIBUTE) !== undefined;
          if (!hasBase && !painted) typed.push(`${id}: ${whole.trim()}`);
        }
      }
      expect(typed).toEqual([]);
    });

    it('prints the figure it declared, so the engine can find it again', () => {
      // `amplifiedDamageText` replaces a *known* prefix rather than matching
      // digits, and the prefix is `printFigure(data-base)`. A span whose text
      // and attribute disagree is one core would silently decline to scale —
      // the failure mode this whole design removes, reintroduced at the seam
      // between a pack's build and core's rounding.
      const mismatched: string[] = [];
      for (const [id, description] of shipped()) {
        for (const [whole, , , tag, inner] of description.matchAll(ANY_SPAN)) {
          const base = attribute(tag, BASE_ATTRIBUTE);
          if (base === undefined) continue;
          if (!inner.startsWith(printFigure(Number(base)))) {
            mismatched.push(`${id}: ${whole.trim()}`);
            continue;
          }
          const high = attribute(tag, BASE_HIGH_ATTRIBUTE);
          if (high !== undefined && !inner.includes(printFigure(Number(high)))) {
            mismatched.push(`${id}: range ends do not appear in "${inner}"`);
          }
        }
      }
      expect(mismatched).toEqual([]);
    });

    it('names a damage type on every damage span', () => {
      // `dmg()` requires one, so this can only fail for a hand-written span or
      // a `tint` that meant to name one. An untyped damage span is read by
      // core as MAGIC and painted by the stylesheet in the physical red, which
      // is two different wrong answers from one omission.
      const untyped: string[] = [];
      for (const [id, description] of shipped()) {
        for (const [whole, kind, classes, tag] of description.matchAll(ANY_SPAN)) {
          if (kind !== 'damage') continue;
          // Paint with no type is legitimate: "tướng địch" is not a hit.
          if (attribute(tag, FLAT_NONE_ATTRIBUTE) !== undefined) continue;
          if (!/^ (physical|magic|true)$/.test(classes)) untyped.push(`${id}: ${whole.trim()}`);
        }
      }
      expect(untyped).toEqual([]);
    });

    it('states the damage type in words, exactly once', () => {
      // Two failures with one cause, and both were reported from a real
      // tooltip. `dmg()` writes "sát thương phép" from the type it was handed,
      // so a caller that *also* passes those words as a tail gets them twice
      // ("35 sát thương phép sát thương phép"), and a figure written with
      // `dmgValue` — which deliberately writes no noun — leaves the sentence
      // saying only "sát thương" with the type carried by colour alone.
      //
      // Vietnamese here for the reason `DAMAGE_WORD` is Vietnamese in core:
      // these are the words core already puts in a buff's own description, so
      // the language was settled long before this rule.
      const NOUN = /sát thương(?: (phép|vật lý|chuẩn|chí mạng))?/g;
      const wrong: string[] = [];
      for (const [id, description] of shipped()) {
        for (const [whole, kind, , tag, inner] of description.matchAll(ANY_SPAN)) {
          // Paint makes no claim about a type; a percentage bonus reading
          // "+15% sát thương" is a legitimate sentence.
          if (attribute(tag, FLAT_NONE_ATTRIBUTE) !== undefined) continue;
          // A shield says what it *absorbs* — "lá chắn hấp thụ 30 sát thương"
          // — and `heal()` takes no damage type because there is none to
          // take: `takeHeal` and `buffs/Shield` read ability power whatever
          // the incoming damage was. Four shields in one pack read exactly
          // that way and are right to.
          if (kind === 'heal') continue;
          const nouns = [...inner.matchAll(NOUN)];
          if (nouns.length > 1) {
            wrong.push(`${id}: says the damage noun twice — ${whole.trim()}`);
          } else if (nouns.length === 1 && nouns[0][1] === undefined) {
            wrong.push(`${id}: "sát thương" with no type — ${whole.trim()}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('reads enough spans to be worth running at all', () => {
      // Against the day a `descriptions()` that returns nothing makes every
      // case above vacuously green.
      const spans = shipped().flatMap(([, text]) => [...text.matchAll(ANY_SPAN)]);
      expect(spans.length).toBeGreaterThan(0);
    });
  });
}
