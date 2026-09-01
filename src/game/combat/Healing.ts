/**
 * How much of a heal actually arrives, and what took the rest.
 *
 * ## One number, read at every place health goes up
 *
 * A wound that "reduces healing" has to mean *all* of it or it means nothing:
 * this engine puts health back through two doors that share no code —
 * `AttackableUnit.takeHeal`, which every spell heal, fountain tick and vamp
 * payout goes through, and `Stats.update`, which adds `healthRegen` straight
 * onto the pool sixty times a second. An item sold as the answer to sustain
 * that cut the first and not the second would be useless against exactly the
 * build a player buys it for — the one living on regeneration.
 *
 * So both doors ask this module, and neither knows what applied the cut.
 *
 * ## What it does not reach
 *
 * **A shield is not a heal.** It is a pool standing in front of the body
 * (`buffs/Shield.ts`), it never passes `takeHeal`, and it is deliberately left
 * whole: cutting it would make one item quietly answer half the defensive
 * catalogue. **Mana is not health**, for the same reason — `manaRegen` and
 * `restoreMana` are untouched.
 *
 * ## Strongest wins; cuts do not add
 *
 * Two carriers of the counter is an ordinary team shape, not a combo. Adding
 * 40% to 40% would leave healing worth a fifth for the price of two items
 * nobody coordinated, so the strongest live cut is the whole answer and the
 * rest are free riders. It is also the arithmetic a player can do at a glance:
 * one number is on you or it is not.
 *
 * Structural rather than typed to `AttackableUnit`, the same way
 * `combat/Vamp.ts` reads `{ stats }`: this is read from inside `Stats.update`,
 * and a stat object that had to import a unit to know its own regeneration
 * would be a cycle.
 */

/** A buff that cuts healing says so with a number; every other buff has none. */
export interface HealCutBuff {
  /** The share of a heal this wound takes, as a fraction — `0.4` is 40%. */
  healCut?: number;
  /** Buffs are marked before they are swept; a dead one has stopped cutting. */
  toRemove?: boolean;
}

/** As little of a unit as the answer needs. */
export interface HealingSource {
  buffs?: readonly HealCutBuff[];
  stats?: {
    /** What the build bought: `0.25` is a quarter again of every heal. */
    healingReceived?: { value: number };
  };
}

/**
 * The strongest live cut on `target`, clamped to something between "no wound"
 * and "no healing". A heal may be stopped; it may never be turned into damage,
 * which is what a fraction over 1 would do at both call sites.
 */
export function healCutFraction(target: HealingSource | undefined): number {
  const buffs = target?.buffs;
  if (!buffs) return 0;

  let strongest = 0;
  for (const buff of buffs) {
    if (buff.toRemove) continue;
    const cut = buff.healCut;
    if (typeof cut !== 'number' || !Number.isFinite(cut)) continue;
    if (cut > strongest) strongest = cut;
  }
  return strongest > 1 ? 1 : strongest;
}

/**
 * What to multiply a heal by: 1 for a unit nobody has wounded and nobody has
 * bought anything for, which is every unit until one of the two happens.
 *
 * **The two compose, they do not cancel.** A quarter again of a heal under a
 * 40% wound is `1.25 × 0.6` = 0.75 of normal, not `1 + 0.25 - 0.4` = 0.85.
 * Multiplying is the only order-independent answer, and order-independence is
 * the whole property worth having when the wound and the buff arrive from two
 * different players' shopping.
 */
export function healingMultiplier(target: HealingSource | undefined): number {
  const cut = healCutFraction(target);
  const boostValue = target?.stats?.healingReceived?.value;
  const boost =
    typeof boostValue === 'number' && Number.isFinite(boostValue) && boostValue > -1
      ? boostValue
      : 0;

  const multiplier = (1 + boost) * (cut > 0 ? 1 - cut : 1);
  return multiplier > 0 ? multiplier : 0;
}
