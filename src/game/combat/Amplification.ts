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
