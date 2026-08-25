import type Spell from '@/game/gameObject/Spell';
import { StatModifier, StatsModifier } from '@/game/gameObject/Stats';
import type { ItemDef } from '@/content/ContentPack';

/**
 * An item a champion is carrying, and the three things carrying one can do.
 *
 * ## Why this is a row of its own and not a longer kit
 *
 * The obvious reading of "an active item is an extra spell" is that the kit
 * has to grow — that `SpellHotKeys` and `SLOT_COUNT` stop being seven. It is
 * the wrong reading and it would be an expensive one: `spells[]` is the array
 * the loadout editor lets a player rearrange, `savedKits` validates its
 * length, and every persisted config carries exactly that many entries.
 *
 * Items are a **parallel row**. A champion has a kit *and* an inventory, each
 * with its own hotkeys, and neither knows about the other. `spells[]`, the kit
 * builder and every saved loadout are untouched by this file existing —
 * which is also why an active item works the moment it is picked up rather
 * than needing a slot freed for it.
 *
 * ## Three grants, three existing mechanisms
 *
 * Nothing here is a new kind of thing:
 *
 *   - **Stats** are a `StatsModifier`, added on equip and removed on unequip —
 *     the same object a buff uses, so an item that grants armour and a buff
 *     that grants armour are indistinguishable to everything downstream.
 *   - **A passive** is a `Spell` armed once per life, which is exactly what
 *     `Champion.passive` already is. `Champion.armPassives` walks the champion's
 *     own passive and every held item's in one pass, because they are the same
 *     mechanism with different owners.
 *   - **An active** is a `Spell` bound to a key, which is exactly what a kit
 *     slot already is. `SpellInputController` takes its bindings and its
 *     `getSpell(slot)` as options, so a second instance pointed at the
 *     inventory gives item actives press, hold-and-release and charging with
 *     no new input code at all.
 */

/** Six, like both games this engine's players have played. */
export const INVENTORY_SIZE = 6;

/**
 * The stats an item may grant.
 *
 * An allow-list rather than "every field on `StatsModifier`", and the
 * exclusions are the point. `health` and `mana` are *current pools*, not
 * capacities — an item granting `health` would top a champion up on equip and
 * **take that health back on unequip**, which is a shop that can kill you.
 * `size` and `height` are presentation and collision, and an item that changed
 * a champion's body radius would silently change every ability range measured
 * against it (`combat/Reach.ts`).
 *
 * `itemStats.test.ts` checks every key here is a real `StatsModifier` field, so
 * a typo is a caught error rather than an item that silently grants nothing.
 */
export const ITEM_STAT_KEYS = [
  'maxHealth',
  'maxMana',
  'healthRegen',
  'manaRegen',
  'speed',
  'attackDamage',
  'attackSpeed',
  'attackRange',
  'armor',
  'magicResist',
  'critChance',
  'critDamage',
  'omnivamp',
  'onHitDamage',
  'visionRadius',
] as const;

export type ItemStatKey = (typeof ITEM_STAT_KEYS)[number];

const GRANTABLE = new Set<string>(ITEM_STAT_KEYS);

/**
 * Builds the modifier an item grants while it is held.
 *
 * Everything lands on `flatBonus`, never `baseValue`: a bonus is something
 * added on top of what the unit is, and writing `baseValue` would make the
 * item's contribution indistinguishable from the champion's own tuning the
 * moment anything else read the stat. It also has to come back off cleanly on
 * unequip, and `StatModifier.remove` subtracts exactly what was added.
 */
export function modifierFor(stats: Partial<Record<ItemStatKey, number>> | undefined): StatsModifier {
  const modifier = new StatsModifier();
  if (!stats) return modifier;
  for (const [key, amount] of Object.entries(stats)) {
    // Silently ignoring an unknown key would be an item that grants nothing
    // and says nothing. `validate.ts` refuses the pack before it gets here, so
    // reaching this branch at runtime means core and the validator disagree.
    if (!GRANTABLE.has(key)) continue;
    if (!Number.isFinite(amount)) continue;
    (modifier as unknown as Record<string, StatModifier>)[key].flatBonus += amount as number;
  }
  return modifier;
}

/**
 * One item in one inventory slot: what it is, what it granted, and the two
 * spells it brought.
 *
 * Holds the *live* `StatsModifier` instance rather than rebuilding one on
 * unequip. `Stats.removeModifier` subtracts field by field from whatever it is
 * handed, so handing it a freshly-built equivalent would work only for as long
 * as nothing ever made an item's grant depend on anything — and the day one
 * does, the champion silently keeps a fraction of it forever.
 */
export class HeldItem {
  readonly modifier: StatsModifier;

  constructor(
    readonly def: ItemDef,
    /** Armed once per life by `Champion.armPassives`, exactly like the champion's own. */
    readonly passive: Spell | null,
    /** Bound to this slot's key by the inventory's own `SpellInputController`. */
    readonly active: Spell | null
  ) {
    this.modifier = modifierFor(def.stats);
  }
}
