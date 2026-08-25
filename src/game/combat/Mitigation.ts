/**
 * What a resistance does to a hit, and the only place that question is
 * answered.
 *
 * ## Why damage has a type at all
 *
 * Before this, `takeDamage(damage, attacker)` was a single flat number and a
 * unit had nothing to say about it. That is enough to build a game, and it was
 * — but it makes a whole class of design inexpressible, and the gap showed up
 * the first time content wanted it: a channelled ability whose real mechanic
 * is *70% damage reduction* had to ship as a flat absorb pool instead, because
 * a pool was the only mitigation primitive that existed. `Shield` is a fine
 * effect and a bad translation of a percentage.
 *
 * ## Two rules that keep this from breaking every pack ever written
 *
 * **The type is optional and defaults to `MAGIC`.** Every ability in every
 * published pack calls `takeDamage` with two arguments and will keep doing so,
 * so whatever this defaults to is retroactively what all of them deal.
 * Abilities are almost all of those call sites and an ability is magic damage
 * unless it says otherwise; `combat/BasicAttack.ts` is the one caller that
 * passes `PHYSICAL`, and it passes it explicitly.
 *
 * **Every unit starts at zero of both.** So on the day this lands the
 * multiplier is exactly 1 for every hit in the game and not one number moves.
 * The feature is inert until a champion, a buff or a pack deliberately puts a
 * resistance on something — which is the only way to add a combat rule to a
 * live engine without re-tuning 240 abilities in the same commit.
 *
 * ## Where it applies, and why that is before the shields
 *
 * `AttackableUnit.takeDamage` mitigates first, then runs
 * `Buff.modifyIncomingDamage`. The order is not arbitrary: armour is a
 * property of the body being hit, so it makes the hit *smaller*, while a
 * shield is a pool standing in front of the body that eats a hit whose size is
 * already settled. It also decides what `swung` means for retaliation — a
 * reflect answers the hit that arrived, and 40 damage stopped down to 20 by
 * armour genuinely *was* a 20, whereas 40 eaten by a shield was still a 40.
 */

/**
 * `TRUE` is not "a lot of damage" — it is damage that asks no resistance
 * anything, which is why it reads `0` out of `resistanceAgainst` rather than
 * skipping the pipeline. One path, one place to get wrong.
 */
export type DamageType = 'PHYSICAL' | 'MAGIC' | 'TRUE';

/** See the header: chosen so that no existing two-argument call changes meaning. */
export const DEFAULT_DAMAGE_TYPE: DamageType = 'MAGIC';

/**
 * Anything with enough of a stat block to be hit. Structural rather than
 * `AttackableUnit` on purpose: minions, wards and anything a pack builds by
 * hand may carry a partial block, and this module is pure arithmetic that a
 * test can drive without constructing a match.
 */
export interface MitigationTarget {
  stats?: {
    armor?: { value: number };
    magicResist?: { value: number };
  };
}

/**
 * The curve. `100 / (100 + r)` on the way up — the familiar one, where 100
 * resistance halves the hit and each further point is worth slightly less than
 * the last, so stacking is never a wall.
 *
 * Negative resistance takes the mirrored branch, `2 - 100 / (100 - r)`, and
 * that is the half worth writing down. The naive extension of the first
 * formula divides by zero at exactly `-100` and returns a **negative**
 * multiplier past it — which is to say a shred effect strong enough would
 * start healing its victim. The mirror is symmetric at the origin, rises to a
 * hard ceiling of 2, and never reaches it.
 */
export function mitigationMultiplier(resistance: number): number {
  if (!Number.isFinite(resistance) || resistance === 0) return 1;
  if (resistance > 0) return 100 / (100 + resistance);
  return 2 - 100 / (100 - resistance);
}

/** Which of the target's two resistances this damage type has to get past. */
export function resistanceAgainst(type: DamageType, target: MitigationTarget): number {
  if (type === 'TRUE') return 0;
  const stat = type === 'PHYSICAL' ? target.stats?.armor : target.stats?.magicResist;
  const value = stat?.value;
  // A missing or non-finite stat is *no resistance*, never `NaN`. A NaN
  // multiplier makes every hit against that unit NaN, its health bar goes
  // blank, and nothing in the stack trace says which of the two stats was the
  // one that did not exist.
  return Number.isFinite(value) ? (value as number) : 0;
}

/** The whole question, in one call: what this hit is actually worth against this body. */
export function effectiveDamage(
  damage: number,
  type: DamageType,
  target: MitigationTarget
): number {
  return damage * mitigationMultiplier(resistanceAgainst(type, target));
}
