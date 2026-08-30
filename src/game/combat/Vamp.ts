import { DEFAULT_DAMAGE_TYPE, type DamageType } from '@/game/combat/Mitigation';

/**
 * How much of a hit comes back as health, and which stat paid for it.
 *
 * ## Three stats, split by the type of the damage, not by what dealt it
 *
 * League splits sustain by *source*: lifesteal is basic attacks, spell vamp is
 * abilities, omnivamp is both. That split is unavailable here and would be the
 * wrong one anyway — this engine's one damage funnel is
 * `AttackableUnit.takeDamage`, which knows a hit's `DamageType` and knows
 * nothing about whether a swing or a cast produced it. A poison tick from an
 * ability and an on-hit proc from an item arrive identically.
 *
 * So the split is by type, which is the axis this engine actually models and
 * the one a player already builds against:
 *
 *   - `lifesteal` pays out of `PHYSICAL` and `TRUE`,
 *   - `spellVamp` pays out of `MAGIC`,
 *   - `omnivamp` pays out of all three, exactly as it always has.
 *
 * `TRUE` sits with the physical half rather than being its own third stat or
 * being paid by neither. It is the type an armour-shredding, execute-flavoured
 * build deals, and a build that reaches it has bought `lifesteal` on the way
 * — a `TRUE` hit that healed nobody would make the game's most committed
 * damage type its least sustainable.
 *
 * ## Why they add
 *
 * A hit of type T pays `omnivamp + (the typed stat for T)`. Adding rather than
 * taking the larger means the general stat is never wasted on a build that
 * also bought the specific one, which is the whole reason to price omnivamp
 * above either — and it keeps the arithmetic something a player can do in
 * their head at the shop.
 *
 * The sum is clamped at 1 for the reason `Stats.omnivamp` clamps its own: a
 * unit may not profit from hitting something. Each stat carries that ceiling
 * individually too, so the clamp here only matters to a build carrying two.
 */

/** The stats this reads, as little of `Stats` as it needs. */
export interface VampSource {
  stats?: {
    omnivamp?: { value: number };
    lifesteal?: { value: number };
    spellVamp?: { value: number };
  };
}

/**
 * Which typed stat a hit of each type feeds.
 *
 * A table rather than a conditional so the answer is enumerable: a fourth
 * damage type cannot be added without this file being asked which half it
 * belongs to.
 */
export const TYPED_VAMP_STAT: Record<DamageType, 'lifesteal' | 'spellVamp'> = {
  PHYSICAL: 'lifesteal',
  TRUE: 'lifesteal',
  MAGIC: 'spellVamp',
};

const read = (stat: { value: number } | undefined): number => {
  const value = stat?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/**
 * The share of a landed hit that returns to `source` as health. 0 for a unit
 * nobody has bought sustain for, which is every unit until they have.
 */
export function vampFraction(
  source: VampSource | undefined,
  type: DamageType = DEFAULT_DAMAGE_TYPE
): number {
  const stats = source?.stats;
  if (!stats) return 0;

  const total = read(stats.omnivamp) + read(stats[TYPED_VAMP_STAT[type]]);
  if (!(total > 0)) return 0;
  return total > 1 ? 1 : total;
}
