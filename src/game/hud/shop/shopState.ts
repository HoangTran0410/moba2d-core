import { refusalFor, sellValueOf, type ShopHost, type ShopRefusal } from '@/game/economy/ItemShop';
import { shopItems } from '@/game/economy/itemCatalog';
import { packAsset } from '@/game/config/packAsset';
import { ITEM_STAT_KEYS, type ItemStatKey } from '@/game/items/itemStats';
import type Champion from '@/game/gameObject/attackableUnits/Champion';
import type { QualifiedItem } from '@/content/PackRegistry';

/**
 * Everything the shop panel draws, computed away from Vue.
 *
 * The same split `participantStats.ts` already uses and for the same reason:
 * `<script setup>` *is* the setup function, it reruns on every mount, and
 * none of this wants to be re-derived by Vue or tested through one.
 *
 * The rule it exists to protect: **the panel never decides whether something
 * can be bought.** `ItemShop.refusalFor` answers that, once, and this module
 * only turns its answer into a sentence. A greyed-out button whose greying was
 * computed in the template is a second implementation of the shop's rules, and
 * the day the two disagree the player is looking at a button that says yes and
 * a purchase that says no.
 */

/**
 * What each stat is called on a shop card.
 *
 * Written out rather than derived from the key, because the derivation would
 * be "insert spaces and capitalise", which produces `Magic Resist` — English,
 * in a UI that is Vietnamese everywhere else.
 */
const STAT_LABEL: Record<ItemStatKey, string> = {
  maxHealth: 'Máu tối đa',
  maxMana: 'Năng lượng tối đa',
  healthRegen: 'Hồi máu',
  manaRegen: 'Hồi năng lượng',
  speed: 'Tốc chạy',
  attackDamage: 'Sát thương',
  attackSpeed: 'Tốc đánh',
  attackRange: 'Tầm đánh',
  armor: 'Giáp',
  magicResist: 'Kháng phép',
  critChance: 'Chí mạng',
  critDamage: 'Sát thương chí mạng',
  omnivamp: 'Hút máu',
  onHitDamage: 'Sát thương cộng thêm',
  visionRadius: 'Tầm nhìn',
};

/** Stats a player reads as a percentage rather than as points. */
const AS_PERCENT = new Set<ItemStatKey>(['critChance', 'critDamage', 'omnivamp']);

/** Why the shop said no, in the player's own language. */
export const REFUSAL_TEXT: Record<ShopRefusal, string> = {
  DEAD: 'Đang chết',
  NOT_AT_FOUNTAIN: 'Phải đứng ở bệ đá',
  NO_SLOT: 'Túi đồ đã đầy',
  TOO_EXPENSIVE: 'Không đủ vàng',
  NOT_LOADED: 'Đang tải…',
};

export interface StatLine {
  label: string;
  /** Already formatted — `+40`, `+8%`. */
  amount: string;
}

export interface ShopRow {
  id: string;
  name: string;
  description: string;
  /** '' when the pack named art nothing registered — the card draws its initial instead. */
  image: string;
  cost: number;
  /** What the stats grant, in reading order. Empty for an item that grants none. */
  stats: StatLine[];
  /** True when this item brings a key to press. */
  hasActive: boolean;
  /** Null when it can be bought right now. */
  refusal: ShopRefusal | null;
  /** '' when there is no refusal. See `REFUSAL_TEXT`. */
  reason: string;
}

const formatAmount = (key: ItemStatKey, amount: number): string => {
  const sign = amount < 0 ? '' : '+';
  if (AS_PERCENT.has(key)) return `${sign}${Math.round(amount * 100)}%`;
  return `${sign}${Math.round(amount * 100) / 100}`;
};

/**
 * `ITEM_STAT_KEYS` order, not the def's own key order, so two items that grant
 * the same pair of stats list them the same way round — a card a player can
 * compare against the card beside it.
 */
const statLines = (def: QualifiedItem): StatLine[] => {
  const lines: StatLine[] = [];
  for (const key of ITEM_STAT_KEYS) {
    const amount = def.stats?.[key];
    if (typeof amount !== 'number' || amount === 0) continue;
    lines.push({ label: STAT_LABEL[key], amount: formatAmount(key, amount) });
  }
  return lines;
};

/**
 * The icon path, or '' — the same guarded lookup `ItemShop.iconOf` does, for
 * the same reason: `AssetManager.get` throws on an unknown key and this runs
 * every time the panel repaints.
 */
const iconPath = (def: QualifiedItem): string => {
  try {
    return packAsset(def.icon).path ?? '';
  } catch {
    return '';
  }
};

/** Every item on sale, cheapest first, each carrying why it cannot be bought. */
export function shopRows(champion: Champion, host: ShopHost): ShopRow[] {
  return shopItems()
    .map(def => {
      const refusal = refusalFor(champion, def, host);
      return {
        id: def.id,
        name: def.name,
        description: def.description ?? '',
        image: iconPath(def),
        cost: def.cost,
        stats: statLines(def),
        hasActive: def.active !== undefined,
        refusal,
        reason: refusal ? REFUSAL_TEXT[refusal] : '',
      };
    })
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

export interface SellRow {
  slot: number;
  name: string;
  image: string;
  /** What selling it pays. See `SELL_REFUND_FRACTION` for why it is not the price. */
  refund: number;
}

/** What is in the bag right now, sellable. Empty slots are left out. */
export function sellRows(champion: Champion): SellRow[] {
  const rows: SellRow[] = [];
  const held = champion.items ?? [];
  for (let slot = 0; slot < held.length; slot++) {
    const item = held[slot];
    if (!item) continue;
    rows.push({
      slot,
      name: item.def.name,
      image: item.icon?.path ?? '',
      refund: sellValueOf(item.def as QualifiedItem),
    });
  }
  return rows;
}
