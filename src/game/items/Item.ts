import type Spell from '@/game/gameObject/Spell';
import { StatsModifier } from '@/game/gameObject/Stats';
import { ITEM_STAT_KEYS, type ItemStatKey } from './itemStats';
import type { AssetHandle } from '@/managers/AssetManager';
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
 * Re-exported so `Item.ts` stays the one place a reader looks for what an item
 * is. The list itself lives in a leaf module with no imports, because
 * `content/validate.ts` needs it too and cannot afford this file's reach —
 * see `itemStats.ts`.
 */
export { ITEM_STAT_KEYS, type ItemStatKey };

const GRANTABLE = new Set<string>(ITEM_STAT_KEYS);

/** Every field on a `StatsModifier` that is a stat, which is all but its two methods. */
type ModifierField = Exclude<keyof StatsModifier, 'addModifier' | 'removeModifier'>;

/** The four slots of `Stat`'s formula an item is allowed to write. Never `baseValue`. */
type BonusSlot = 'baseBonus' | 'flatBonus' | 'percentBonus' | 'percentBaseBonus';

/**
 * Where a stat's grant lands, for the stats that are **a share of what the
 * wearer already is** rather than points.
 *
 * Everything absent from this table is points on the stat of the same name,
 * landing on `flatBonus` (see `modifierFor`). The two entries here are the
 * stats that cannot be:
 *
 * **`attackSpeed`** is a *rate*, and every champion has a different one, so a
 * flat "+0.25 swings a second" is a sixth again for a marksman on 1.65 and a
 * third again for a mage on 0.7. The same item would do most for whoever
 * needed it least, and no shelf could be priced against a champion in
 * particular. It takes `percentBaseBonus` — the *inner* factor of `Stat`'s
 * formula — rather than `percentBonus`, and the difference is the whole
 * design: every bonus in that slot pools **additively** before multiplying the
 * base once, which is how League adds up bonus attack speed. The outer
 * `percentBonus` is left free for attack-speed *slows*, which multiply on top
 * of whatever the build reached — also League's own arrangement, and the
 * reason a cripple is worth the same against a fed carry as against a starved
 * one.
 *
 * **`speedPercent`** is the other side of a pair, and the pair is the point.
 * `speed` stays flat, because boots are flat in the source game and a fixed
 * number is deliberately worth more to whoever is slowest. `speedPercent`
 * lands on the *outer* `percentBonus`, so it multiplies the boots rather than
 * ignoring them — `(3 + 0.45) * 1.07`, which is League's own `(base + flat) *
 * (1 + %)`. That also keeps it clear of `Slow`, which writes
 * `speed.percentBaseBonus`: a movement item and a cripple land in different
 * slots and neither can cancel the other by arithmetic accident.
 *
 * The value is `[field, slot]` rather than a bare slot because `speedPercent`
 * is a *key* with no stat of its own — the name a pack writes, pointed at the
 * stat it really moves. Adding another one is one line here and one in
 * `itemStats.ts`.
 */
export const GRANT_SLOT: Partial<Record<ItemStatKey, readonly [ModifierField, BonusSlot]>> = {
  attackSpeed: ['attackSpeed', 'percentBaseBonus'],
  speedPercent: ['speed', 'percentBonus'],
};

/**
 * Builds the modifier an item grants while it is held.
 *
 * Everything lands on a *bonus* slot, never `baseValue`: a bonus is something
 * added on top of what the unit is, and writing `baseValue` would make the
 * item's contribution indistinguishable from the champion's own tuning the
 * moment anything else read the stat. It also has to come back off cleanly on
 * unequip, and `StatModifier.remove` subtracts exactly what was added.
 *
 * *Which* stat and which bonus slot is `GRANT_SLOT`'s decision: points go to
 * `flatBonus` on the stat of the same name, and the share stats go where that
 * table says, because a share has to be granted as a share of what the wearer
 * already has.
 */
export function modifierFor(
  stats: Partial<Record<ItemStatKey, number>> | undefined
): StatsModifier {
  const modifier = new StatsModifier();
  if (!stats) return modifier;
  for (const [key, amount] of Object.entries(stats)) {
    // Silently ignoring an unknown key would be an item that grants nothing
    // and says nothing. `validate.ts` refuses the pack before it gets here, so
    // reaching this branch at runtime means core and the validator disagree.
    if (!GRANTABLE.has(key)) continue;
    if (!Number.isFinite(amount)) continue;
    const [field, slot] = GRANT_SLOT[key as ItemStatKey] ?? [key as ModifierField, 'flatBonus'];
    modifier[field][slot] += amount as number;
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
    readonly active: Spell | null,
    /**
     * The icon, resolved **once, here**, or `null` for an item whose pack named
     * a key nothing registered.
     *
     * Resolved at purchase rather than read by the HUD, because
     * `AssetManager.get` throws on an unknown key and the HUD asks twenty
     * times a second — a bad pack would otherwise take the whole bar down mid
     * match, which is both the worst place to find out and the hardest to read
     * a stack trace from. `ItemShop` owns the guarded lookup.
     */
    readonly icon: AssetHandle | null = null
  ) {
    this.modifier = modifierFor(def.stats);
  }
}
