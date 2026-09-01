/**
 * How much of a shield actually arrives, and what took the rest.
 *
 * ## Why this is not in `combat/Healing.ts`
 *
 * That module's header says, in as many words, that **a shield is not a heal**
 * — it is a pool standing in front of the body rather than health going back
 * into it, it never passes `takeHeal`, and a grievous wound is deliberately
 * powerless against it. Folding a shield cut in there would make the file
 * contradict its own boundary. Two counters, two modules, one shape.
 *
 * ## Stripping and cutting are different purchases
 *
 * A champion ability can already tear off what is up — walk the target's buffs
 * and `deactivateBuff()` each `Shield`, which is exact because there is no
 * separate pool to disagree with. That answers the shield *standing right now*,
 * and the counter-play to it is simply casting another one.
 *
 * This is the other half: a debuff that makes every shield granted to the unit
 * **while it lasts** worth less. It punishes the re-cast rather than the cast,
 * which is what makes it worth buying next to an ability that already strips.
 *
 * ## It never reaches backwards
 *
 * Only shields created while the cut is on are affected. A pool already
 * standing was granted, its owner has been fighting around that number, and
 * shrinking it after the fact would also have to decide what the health bar's
 * grey overlay is now a fraction of (`Shield._initialAmount`). Applied once, at
 * the moment the shield is built, beside the ability-power amplification that
 * already happens there.
 *
 * Strongest live cut wins and they never sum, for `Healing.ts`'s reason: two
 * carriers of the counter is an ordinary team, not a combo.
 */

/** A buff that cuts shields says so with a number; every other buff has none. */
export interface ShieldCutBuff {
  /** The share of a shield this takes, as a fraction — `0.5` is half of it. */
  shieldCut?: number;
  /** Buffs are marked before they are swept; a dead one has stopped cutting. */
  toRemove?: boolean;
}

/** As little of a unit as the answer needs. */
export interface ShieldingTarget {
  buffs?: readonly ShieldCutBuff[];
}

/**
 * The strongest live cut on `target`, clamped to something between "no crack"
 * and "no shield". A share over 1 would make a shield absorb a negative
 * amount, which is a hit that heals.
 */
export function shieldCutFraction(target: ShieldingTarget | undefined): number {
  const buffs = target?.buffs;
  if (!buffs) return 0;

  let strongest = 0;
  for (const buff of buffs) {
    if (buff.toRemove) continue;
    const cut = buff.shieldCut;
    if (typeof cut !== 'number' || !Number.isFinite(cut)) continue;
    if (cut > strongest) strongest = cut;
  }
  return strongest > 1 ? 1 : strongest;
}

/** What to multiply a shield by: 1 for a unit nobody has cracked. */
export function shieldMultiplier(target: ShieldingTarget | undefined): number {
  const cut = shieldCutFraction(target);
  return cut > 0 ? 1 - cut : 1;
}
