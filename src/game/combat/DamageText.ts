import { DEFAULT_DAMAGE_TYPE, type DamageType } from '@/game/combat/Mitigation';

/**
 * How a pack writes a number the engine will scale — and the reason this is a
 * function call rather than a span a pack types out by hand.
 *
 * ## What this replaces
 *
 * A description used to be authored HTML with the figure baked into the prose,
 * and `Amplification.amplifiedDamageText` found that figure by *parsing the
 * sentence*: take the first run of digits inside a `damage` span, unless it is
 * followed by `%`, unless it is the head of a longer number, and mind the
 * dash that makes it a range. Every one of those clauses is a guess about
 * Vietnamese prose, made by an engine that does not read Vietnamese.
 *
 * The guesses were wrong in ways nothing could see, because the failure of a
 * guess is **silence** — the span renders exactly as authored, which is also
 * what an unbuilt champion's tooltip looks like. Three shipped that way:
 *
 *   - `<span class="damage">+6 sát thương</span>` — the `+` means the span
 *     does not open with a digit, so it never rescaled at all, for the whole
 *     life of the pack, looking identical in source to one that worked;
 *   - `<span class="damage">4 lần</span>` — a count of sword swings, rescaled
 *     into "4 (+7.6) lần" because it is a number in a damage span;
 *   - `<span class="damage">30 máu</span>` — an execute *threshold*, which no
 *     build moves, advertised as though a build moved it.
 *
 * And the type was worse: a bare `class="damage"` is read as the engine
 * default (`MAGIC`), so an entire pack's physical abilities silently claimed
 * to scale with ability power and silently refused to scale with the attack
 * damage that really does drive them.
 *
 * ## The rule this establishes
 *
 * The number and its type are **arguments**, so the markup is generated rather
 * than typed. A pack cannot forget the type (it is required), cannot break the
 * leading figure (it does not write it), and cannot tag a number that is not a
 * hit (it would have to call `dmg` on a sword count on purpose). What is left
 * for `amplifiedDamageText` to do is read `data-base` — a number it was
 * *given* — and replace a prefix it knows the exact text of.
 *
 * ## `tint` and `pct` are the other half, and they are what make the rule
 * checkable
 *
 * Not every coloured number is a scaled one. A pack colours bare emphasis
 * ("tướng địch", "Chảy Máu") and shares that are shares whatever you buy
 * ("30% sát thương phép"). Those get `data-flat="none"` — an explicit "this is
 * paint, not a promise" — so a shipped span carrying neither attribute is a
 * figure whose author forgot the helper, and `testing/spellRules.ts` can say
 * so without reading a word of the pack's language.
 */

/** The class the stylesheet paints, per type. Mirrors `buffs/describeBuff`'s `DAMAGE_CLASS`. */
const TYPE_CLASS: Record<DamageType, string> = {
  PHYSICAL: 'physical',
  MAGIC: 'magic',
  TRUE: 'true',
};

/**
 * The damage type as a player reads it, and **the reason `dmg` writes the
 * noun rather than taking it**.
 *
 * The words were already core's — `buffs/describeBuff` has needed them since
 * generic buffs started describing their own burns — and its comment there
 * said a pack writes its own, because prose is a pack's business. That was
 * true right up until the helper started taking the damage type as an
 * argument. Now the type is *known at the call site*, and letting the sentence
 * restate it by hand is letting the sentence disagree with it:
 *
 *     dmg(60, 'MAGIC', ' sát thương chuẩn')
 *
 * type-checks, renders in violet, deals magic damage, and tells the player it
 * is true damage. `lol/tests/spells/damageTypeClaims.test.ts` exists because
 * four spells shipped in exactly that state, three of them with a comment
 * above the call already saying the right answer. A scan cannot be the fix for
 * a fact the caller already supplied.
 *
 * So the noun is generated and `tail` is what comes *after* it — " mỗi giây",
 * " mỗi nhịp". A figure that should carry no noun at all (a total in
 * parentheses, the far end of a range) has its own helper, `dmgValue`, so
 * "silent" is never the default.
 */
export const DAMAGE_WORD: Record<DamageType, string> = {
  PHYSICAL: 'vật lý',
  MAGIC: 'phép',
  TRUE: 'chuẩn',
};

/** The attribute carrying a span's authored figure — the whole point of this module. */
export const BASE_ATTRIBUTE = 'data-base';
/** The second end of a range, present only on a charged ability's span. */
export const BASE_HIGH_ATTRIBUTE = 'data-base-high';
/** "Paint, not a promise" — see the header. */
export const FLAT_NONE_ATTRIBUTE = 'data-flat';

/**
 * At most one decimal, and no trailing `.0`.
 *
 * Exported because `amplifiedDamageText` has to reproduce this **exactly**: it
 * strips the printed base off the front of a span before writing the scaled
 * one back, and it finds that prefix by generating it from `data-base` rather
 * than by matching digits. A second rounding rule anywhere would be a prefix
 * that does not match and a span that quietly stops scaling — the failure this
 * module exists to end, reintroduced at the seam.
 */
export const printFigure = (value: number): string => (Math.round(value * 10) / 10).toString();

const classFor = (type: DamageType, kind: 'damage' | 'heal'): string =>
  kind === 'heal' ? 'heal' : `damage ${TYPE_CLASS[type]}`;

/**
 * `dmg(26, 'MAGIC', ' sát thương')` — a flat figure the caster's build scales.
 *
 * `tail` is the words that belong *inside* the colour, and it is written with
 * its own leading space because that is where the space lives in the sentence:
 * a pack that wants only the number coloured passes nothing.
 */
export function dmg(amount: number, type: DamageType, tail = ''): string {
  return dmgValue(amount, type, ` sát thương ${DAMAGE_WORD[type]}${tail}`);
}

/**
 * The same figure with **no noun** — a total in parentheses, or the far end of
 * a pair the sentence has already named.
 *
 * Separate rather than `dmg(n, type, '')` so that leaving the words off is a
 * different call and not a forgotten argument. "(tổng `dmgValue(60,'MAGIC')`)"
 * says what it is; `dmg(60, 'MAGIC', '')` reads like an oversight.
 */
export function dmgValue(amount: number, type: DamageType, tail = ''): string {
  return (
    `<span class="${classFor(type, 'damage')}" ${BASE_ATTRIBUTE}="${amount}">` +
    `${printFigure(amount)}${tail}</span>`
  );
}

/**
 * The same claim about an ability whose damage is two numbers — a charge, or a
 * shot that gets stronger with distance.
 *
 * Both ends carry their own bonus when rendered (`18 (+34)–48 (+90)`), because
 * the end a player is reading for is whichever one they are about to hit for.
 * `separator` is the pack's own punctuation; an en dash is what the shipped
 * packs use, and a plain hyphen reads as a subtraction once a bonus is printed
 * beside it.
 */
export function dmgRange(
  low: number,
  high: number,
  type: DamageType,
  tail = '',
  separator = '–'
): string {
  return dmgRangeValue(low, high, type, ` sát thương ${DAMAGE_WORD[type]}${tail}`, separator);
}

/** `dmgRange` without the noun — see `dmgValue`. */
export function dmgRangeValue(
  low: number,
  high: number,
  type: DamageType,
  tail = '',
  separator = '–'
): string {
  return (
    `<span class="${classFor(type, 'damage')}" ${BASE_ATTRIBUTE}="${low}" ` +
    `${BASE_HIGH_ATTRIBUTE}="${high}">` +
    `${printFigure(low)}${separator}${printFigure(high)}${tail}</span>`
  );
}

/**
 * A restored number — a heal or a shield.
 *
 * No damage type, and that is the engine's rule rather than a simplification:
 * `AttackableUnit.takeHeal` and `buffs/Shield` amplify by ability power alone,
 * because there is nothing for a restored number to read off attack damage.
 */
export function heal(amount: number, tail = ''): string {
  return (
    `<span class="heal" ${BASE_ATTRIBUTE}="${amount}">` + `${printFigure(amount)}${tail}</span>`
  );
}

/**
 * Colour with no promise attached — emphasis, or a share that is a share
 * however much power you buy.
 *
 * `type` is optional because most of these are not a damage type at all
 * ("tướng địch", "Chảy Máu"); pass one for a percentage that *is* ("30% sát
 * thương phép") so the words wear the colour of the hit they describe.
 *
 * The `data-flat="none"` it writes is what separates "deliberately unscaled"
 * from "a figure whose author forgot `dmg`". Without it the two are the same
 * span and no test can tell them apart — which is the state this module was
 * written to leave behind.
 */
export function tint(text: string, type?: DamageType): string {
  const className = type === undefined ? 'damage' : classFor(type, 'damage');
  return `<span class="${className}" ${FLAT_NONE_ATTRIBUTE}="none">${text}</span>`;
}

/** `pct(30, 'MAGIC', ' sát thương phép')` — `tint` for the shape that is always a share. */
export function pct(share: number, type?: DamageType, tail = ''): string {
  return tint(`${printFigure(share)}%${tail}`, type);
}

/**
 * The opening tag of a scaling span, **tolerant of the attributes the helpers
 * write** — and exported so nothing has to keep its own copy.
 *
 * `ai/BotShopper.ts` had a copy that required `">` immediately after the
 * class, which is what the spans looked like before `data-base` existed. The
 * day the packs migrated, that regex silently matched nothing, every champion
 * read as a kit no stat amplifies, and every bot in the game started buying
 * attack damage — a mage included. `Amplification.ts`'s own header warns about
 * exactly this failure one layer down ("a wildcard there would silently enrol
 * whatever class a pack invents next"), and the answer is the same both times:
 * one pattern, in the module that emits the markup.
 *
 * Group 1 is the damage type, absent for a span that names none.
 *
 * A `tint`/`pct` span is **not** one of these and the lookahead says so: it
 * carries `data-flat="none"` precisely to mean "paint, no promise", and a
 * reader counting it as a scaling figure is the same mistake in the other
 * direction — it made a control kit's colour-only emphasis read to
 * `ai/BotShopper.ts` as an ability that ability power multiplies.
 */
export const SCALING_SPAN_OPEN =
  /<span class="(?:damage|heal)(?: (physical|magic|true))?"(?![^>]*\bdata-flat=)[^>]*>/g;

/** The default a span with no type names, stated once so callers agree with the parser. */
export const DEFAULT_TEXT_TYPE: DamageType = DEFAULT_DAMAGE_TYPE;
