import type Champion from '@/game/gameObject/attackableUnits/Champion';
import { HeldItem } from '@/game/items/Item';
import { spellClassOfId } from '@/game/spellRegistry';
import { packAsset } from '@/game/config/packAsset';
import type { AssetHandle } from '@/managers/AssetManager';
import type Spell from '@/game/gameObject/Spell';
import type { QualifiedItem } from '@/content/PackRegistry';

/**
 * Buying and selling, and the rules about where.
 *
 * ## At your own fountain, and nowhere else
 *
 * The owner's call, and it is the rule both games this engine's players have
 * played use. It is also the only thing that gives going home a price: without
 * it recall is a movement ability and nothing more, and a player who never
 * leaves the lane is strictly ahead of one who does.
 *
 * ## Why `refusalFor` answers with a reason
 *
 * A bare `false` leaves the panel greying a button out for reasons the player
 * has to guess — and the four reasons want four different sentences ("chưa đủ
 * vàng", "túi đã đầy", "phải về bệ đá"). One function answers which rule said
 * no, and `buyItem` is that same function plus the mutation, so the two can
 * never disagree about what is allowed.
 *
 * ## Nothing half-happens
 *
 * `buyItem` checks everything first and only then touches the wallet and the
 * inventory. The specific failure it is written against is `NOT_LOADED`: a
 * spell class arrives through a dynamic import, an item is bought *once* and
 * held for the rest of the match, and selling the player an inert copy of the
 * thing they wanted — because a chunk had not landed yet — is the one failure
 * here with no way back.
 */

/**
 * What selling gives back, as a fraction of what was paid.
 *
 * Deliberately not 1. A full refund turns an inventory into a set of free stat
 * toggles — buy the armour for this fight, sell it for the damage next fight,
 * pay nothing ever — and a purchase stops being a decision. Deliberately not 0
 * either: a player who buys the wrong thing early should be able to correct
 * it at a cost rather than carry the mistake for the whole match.
 */
export const SELL_REFUND_FRACTION = 0.7;

/** Which rule said no. See the header for why this is not a boolean. */
export type ShopRefusal = 'DEAD' | 'NOT_AT_FOUNTAIN' | 'NO_SLOT' | 'TOO_EXPENSIVE' | 'NOT_LOADED';

/**
 * The bits of a `Game` this file reads. Structural rather than `Game` itself,
 * so a test can drive the whole shop without building a match — and so this
 * module never grows a second reason to know about the game object.
 */
export interface ShopHost {
  readonly fountains: readonly {
    readonly teamId?: string;
    readonly position: { readonly x: number; readonly y: number };
    readonly radius: number;
  }[];
}

/** Standing inside a fountain that belongs to this champion's own side. */
export function atOwnFountain(champion: Champion, host: ShopHost): boolean {
  for (const fountain of host.fountains ?? []) {
    if (fountain.teamId !== champion.teamId) continue;
    const dx = champion.position.x - fountain.position.x;
    const dy = champion.position.y - fountain.position.y;
    if (Math.hypot(dx, dy) <= fountain.radius) return true;
  }
  return false;
}

/** What this item pays back when sold. Whole coins, floored — see `Wallet`. */
export function sellValueOf(def: QualifiedItem): number {
  return Math.floor(def.cost * SELL_REFUND_FRACTION);
}

/**
 * Every spell class this item needs, or `null` if any of them is not in
 * memory yet. All-or-nothing on purpose: an item with half its spells is the
 * `NOT_LOADED` failure in the header, wearing a success.
 */
function resolveSpellClasses(def: QualifiedItem): { passive: unknown; active: unknown } | null {
  const passive = def.passive === undefined ? null : spellClassOfId(def.passive);
  if (def.passive !== undefined && !passive) return null;
  const active = def.active === undefined ? null : spellClassOfId(def.active);
  if (def.active !== undefined && !active) return null;
  return { passive, active };
}

/** Which rule refuses this purchase, or `null` when none does. */
export function refusalFor(
  champion: Champion,
  def: QualifiedItem,
  host: ShopHost
): ShopRefusal | null {
  if (champion.isDead) return 'DEAD';
  if (!atOwnFountain(champion, host)) return 'NOT_AT_FOUNTAIN';
  if (champion.firstEmptyItemSlot() < 0) return 'NO_SLOT';
  if ((champion.wallet?.balance ?? 0) < def.cost) return 'TOO_EXPENSIVE';
  if (!resolveSpellClasses(def)) return 'NOT_LOADED';
  return null;
}

/**
 * The item's icon, or `null` when the pack named a key nothing registered.
 *
 * `AssetManager.get` throws on an unknown key, deliberately — a mistyped key
 * should be loud. But the *place* it becomes loud has to be here, once, at
 * purchase, and not in the HUD's twenty-times-a-second read: a bad pack would
 * otherwise take the whole bar down mid match. `validate.ts` checks the icon
 * is a string; nothing can check it names registered art until the art is
 * registered.
 */
function iconOf(def: QualifiedItem): AssetHandle | null {
  try {
    return packAsset(def.icon);
  } catch {
    return null;
  }
}

/**
 * Builds the live item — its two spells and its icon — for `owner`.
 *
 * `null` when a spell class this item names has not landed yet, which is the
 * `NOT_LOADED` refusal. Never a half-built item: see the header.
 */
export function buildHeldItem(champion: Champion, def: QualifiedItem): HeldItem | null {
  const classes = resolveSpellClasses(def);
  if (!classes) return null;

  const build = (SpellClass: unknown): Spell | null =>
    SpellClass ? new (SpellClass as new (owner: Champion) => Spell)(champion) : null;

  return new HeldItem(def, build(classes.passive), build(classes.active), iconOf(def));
}

/**
 * Hands `champion` an item outright — no gold, no fountain, no full-bag check
 * beyond needing a slot. The practice panel's cheat, and the only door into an
 * inventory that is not a purchase.
 *
 * Deliberately its own function rather than a flag on `buyItem`: a cheat that
 * shares a code path with the real thing is a cheat that can be reached by
 * accident, and the gates are the entire content of `buyItem`.
 */
export function grantItem(champion: Champion, def: QualifiedItem): boolean {
  const slot = champion.firstEmptyItemSlot();
  if (slot < 0) return false;

  const held = buildHeldItem(champion, def);
  if (!held) return false;

  champion.equipItem(held, slot);
  return true;
}

/**
 * Buys `def` into the first free slot. Answers whether it happened.
 *
 * Everything is checked before anything is touched — see the header. The gold
 * comes out through `Wallet.spend`, which is itself all-or-nothing, so a
 * purchase can never leave a champion holding an item nobody paid for.
 */
export function buyItem(champion: Champion, def: QualifiedItem, host: ShopHost): boolean {
  if (refusalFor(champion, def, host) !== null) return false;

  const held = buildHeldItem(champion, def);
  if (!held) return false;

  const slot = champion.firstEmptyItemSlot();
  if (slot < 0) return false;
  if (!champion.wallet?.spend(def.cost)) return false;

  champion.equipItem(held, slot);
  return true;
}

/**
 * Sells whatever is in `slot`, and answers how much it paid — `0` for a
 * refusal or an empty slot, which the caller can treat the same way because
 * neither changed anything.
 *
 * Selling is gated on the fountain exactly like buying: an inventory that can
 * be liquidated mid-fight is a second set of abilities, not a build.
 */
export function sellItem(champion: Champion, slot: number, host: ShopHost): number {
  if (champion.isDead || !atOwnFountain(champion, host)) return 0;

  const held = champion.items?.[slot];
  if (!held) return 0;

  const refund = sellValueOf(held.def as QualifiedItem);
  champion.unequipItem(slot);
  champion.wallet?.earn(refund);
  return refund;
}
