/**
 * What a build does to an ability, and the only place that question is
 * answered.
 *
 * ## The problem this exists for
 *
 * Items made basic attacks better and abilities exactly as good as they were
 * on the first frame of the match. Measured on the two installed packs the
 * gap was not subtle: a full attack build multiplies a champion's damage per
 * swing by about 5.7 and its rate by about 1.5, and not one of the 308
 * abilities across those packs read a single stat of its caster, so the same
 * gold bought them a multiplier of exactly 1.00. Players reported it the
 * obvious way — spamming a whole kit did less than holding right-click.
 *
 * ## Why it is a multiplier and not points
 *
 * The expressive fix is flat ability power with a ratio per ability, and it
 * was not available: a flat number means nothing until each ability declares
 * what share of it to take, which is 308 files across two repositories that
 * ship independently of this one. A multiplier is the only form that can be
 * applied *once*, at the funnel every hit already passes through, and have all
 * of them scale without a single edit. `Stats.abilityPower`'s own comment
 * covers the rest, including why an ability that wants a scaling of its own is
 * not shut out by this.
 *
 * ## The mirror of `Mitigation.ts`, on purpose
 *
 * Amplification belongs to the unit *dealing* the damage and mitigation to the
 * unit taking it, so `takeDamage` runs this first and that second: a hit is
 * made bigger at its source and then smaller by the body it lands on, which is
 * exactly the order a basic attack already goes through — `attackDamage` is
 * summed into the swing before `armor` ever sees it. Both modules take a
 * structural type rather than `AttackableUnit`, so both stay arithmetic a test
 * can drive without constructing a match.
 *
 * **What it deliberately does not touch:** whether the damage *is* an ability.
 * That is not knowable from a number and an attacker — see
 * `combat/DamageAttribution.ts`'s `abilityPowerScales`, which is what
 * `takeDamage` asks before calling in here.
 */

/** Anything with enough of a stat block to amplify. See `MitigationTarget`. */
export interface AmplificationSource {
  stats?: {
    abilityPower?: { value: number };
  };
}

/**
 * What this unit's abilities hit for, as a multiplier. `0.35` of ability power
 * is `1.35`, and a unit that has none is exactly `1` — which is every unit in
 * the game until an item or a buff grants some.
 *
 * Floored at zero. `Stats.abilityPower` already floors its own value at -1, but
 * this function is reachable with a hand-built stat block from a pack's tests,
 * and a negative multiplier is the failure `Mitigation.ts` documents at length:
 * an ability suppression strong enough to make casting on the victim *heal*
 * them. A missing or non-finite stat is no amplification, never `NaN`.
 */
export function abilityPowerMultiplier(source: AmplificationSource | undefined): number {
  const value = source?.stats?.abilityPower?.value;
  if (!Number.isFinite(value)) return 1;
  const multiplier = 1 + (value as number);
  return multiplier > 0 ? multiplier : 0;
}

/** The whole question, in one call: what this ability is worth out of this unit. */
export function amplifiedAbilityDamage(
  damage: number,
  source: AmplificationSource | undefined
): number {
  return damage * abilityPowerMultiplier(source);
}

/**
 * A damage number inside a spell's own description, as a pack writes it:
 * `<span class="damage">15 sát thương</span>`. Non-greedy, so two of them on
 * one line stay two.
 */
const DAMAGE_SPAN = /(<span class="damage">)([\s\S]*?)(<\/span>)/g;

/**
 * The figure at the front of such a span, which is the part a build changes.
 *
 * A percentage is refused outright: `100%` of something is still `100%` of it
 * however much power you buy, and a description that reads "from 40% to 100%
 * of 30 damage" has three numbers in damage spans of which exactly one is a
 * flat figure. The lookahead is the only unit test core can run without
 * knowing what language a pack writes in — everything past the number is a
 * word core has no business reading. Which numbers are damage at all is the
 * pack's to say, by tagging them; see this function's own doc comment.
 *
 * `(?![\d.])` is load-bearing and not a tidy-up. Without it the engine
 * answers a refused `40%` by backtracking `\d+` down to `4`, whose next
 * character is `0` rather than `%` — so the guard passes, and the span that
 * was supposed to be left alone reads `120%`. Pinning the number's own end
 * before testing what follows it is what makes the refusal mean anything.
 */
const LEADING_NUMBER = /^(\s*)(\d+(?:\.\d+)?)(?![\d.])(?!\s*%)/;

/** At most one decimal, and no trailing `.0` — `45`, not `45.0`. */
const printable = (value: number): string => (Math.round(value * 10) / 10).toString();

/**
 * `15 (+30)` — the pack's own number, then what this build adds to it.
 *
 * A bare total would answer "what does this hit for" and lose the question a
 * player is usually asking while shopping, which is "what is this item doing
 * for me". Both numbers together answer both, and the base staying visible is
 * also what makes the sentence recognisable as the one the pack wrote.
 *
 * A suppression (a multiplier under 1) prints `15 (-5)` rather than `(+-5)`.
 */
const withBonus = (base: number, multiplier: number): string => {
  const bonus = base * multiplier - base;
  const sign = bonus < 0 ? '-' : '+';
  return `${printable(base)} (${sign}${printable(Math.abs(bonus))})`;
};

/**
 * The same amplification, applied to the number a player *reads* instead of
 * the one they take.
 *
 * A description is authored text with its damage baked in, so the HUD showed
 * a spell's first-frame tuning for the whole match: buy 200% ability power
 * and the bar still promised 15. The arithmetic was right and the only place
 * a player could check it was wrong, which is the worse half — an item that
 * silently works is indistinguishable from an item that silently does not.
 *
 * Printed as `15 (+30)`, not as `45`. The total alone would answer what the
 * spell hits for and lose what the build is contributing, which is the
 * question being asked at the moment somebody is reading item text at all.
 *
 * Only the leading figure of a `damage` span moves, and only when it is a
 * flat one — a percentage, or a span whose text does not open with a number
 * at all, is left exactly as written rather than guessed at.
 *
 * **`class="damage"` is a claim, and it is the pack's to make**: it means
 * "a flat number `takeDamage` will multiply by this caster's ability power".
 * A heal, a shield and a duration are none of them amplified — only
 * `takeDamage` calls `amplifiedAbilityDamage` — so a pack that tags one of
 * those as damage is asking this to lie for it. It is also already lying to
 * the player in a second way, since that class is what paints the number in
 * the damage colour.
 *
 * Returns the input unchanged at a multiplier of 1, which is every unit in
 * the game until an item or a buff grants some.
 */
export function amplifiedDamageText(
  description: string,
  source: AmplificationSource | undefined
): string {
  const multiplier = abilityPowerMultiplier(source);
  if (multiplier === 1) return description;
  return description.replace(DAMAGE_SPAN, (whole, open, inner, close) => {
    if (!LEADING_NUMBER.test(inner)) return whole;
    const scaled = inner.replace(
      LEADING_NUMBER,
      (_match: string, space: string, digits: string) =>
        space + withBonus(Number(digits), multiplier)
    );
    return open + scaled + close;
  });
}
