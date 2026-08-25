import {
  componentSlotsFor,
  priceFor,
  refusalFor,
  sellRefusalFor,
  sellValueOf,
  type SellRefusal,
  type ShopHost,
  type ShopRefusal,
} from '@/game/economy/ItemShop';
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
export const REFUSAL_TEXT: Record<ShopRefusal | SellRefusal, string> = {
  DEAD: 'Đang chết',
  NOT_AT_FOUNTAIN: 'Phải đứng ở bệ đá',
  NO_SLOT: 'Túi đồ đã đầy',
  TOO_EXPENSIVE: 'Không đủ vàng',
  NOT_LOADED: 'Đang tải…',
  EMPTY: 'Ô trống',
};

export interface StatLine {
  label: string;
  /** Already formatted — `+40`, `+8%`. */
  amount: string;
}

/**
 * One edge of the build tree, in either direction — a part this item is made
 * of, or a bigger item it goes into.
 *
 * Carries the neighbour's whole card face rather than its id, because the
 * panel draws these as small tiles and a template that had to look each one up
 * would be a second index over the catalogue, rebuilt on every 20Hz repaint.
 */
export interface RecipeLink {
  id: string;
  name: string;
  /** '' when the pack named art nothing registered. */
  image: string;
  /** The neighbour's own total price. */
  cost: number;
  /**
   * On a `recipe` entry: **this purchase would consume that copy**, not merely
   * "one is somewhere in the bag". The distinction is real for a recipe naming
   * one component twice while the bag holds one — ticking both would promise a
   * discount the shop is not going to give.
   *
   * On a `buildsInto` entry: the champion already owns that bigger item.
   */
  owned: boolean;
}

export interface ShopRow {
  id: string;
  name: string;
  description: string;
  /** '' when the pack named art nothing registered — the card draws its initial instead. */
  image: string;
  /** The **total**: what this is worth, and what it costs from an empty bag. */
  cost: number;
  /**
   * What it costs *this champion, right now* — `cost` less whatever of the
   * recipe is already held. Equal to `cost` for an item with no recipe, and
   * for one whose parts are not in the bag.
   *
   * Comes from `ItemShop.priceFor` and is never re-derived downstream: what a
   * combine costs changes the moment a component enters or leaves the bag, and
   * a template doing its own subtraction would disagree with the purchase in
   * exactly the frame the player clicked.
   */
  price: number;
  /** What the stats grant, in reading order. Empty for an item that grants none. */
  stats: StatLine[];
  /** True when this item brings a key to press. */
  hasActive: boolean;
  /** The parts, in the order the pack wrote them. Empty for a component. */
  recipe: RecipeLink[];
  /** The bigger items this is a part of. Empty for a finished item. */
  buildsInto: RecipeLink[];
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

/** The card face of one neighbour in the build tree. */
const linkTo = (def: QualifiedItem | undefined, owned: boolean): RecipeLink | null =>
  def ? { id: def.id, name: def.name, image: iconPath(def), cost: def.cost, owned } : null;

/** Every item on sale, cheapest first, each carrying why it cannot be bought. */
export function shopRows(champion: Champion, host: ShopHost): ShopRow[] {
  const stock = shopItems();

  // Built once per call, not once per card. Both directions of the tree need a
  // lookup by id, and doing it per card is quadratic over a catalogue that
  // repaints twenty times a second.
  const byId = new Map<string, QualifiedItem>();
  for (const def of stock) byId.set(def.id, def);

  const parents = new Map<string, QualifiedItem[]>();
  for (const def of stock) {
    for (const partId of new Set(def.buildsFrom ?? [])) {
      const list = parents.get(partId);
      if (list) list.push(def);
      else parents.set(partId, [def]);
    }
  }

  const held = new Set((champion.items ?? []).map(item => item?.def.id).filter(Boolean));

  return stock
    .map(def => {
      const refusal = refusalFor(champion, def, host);

      // `componentSlotsFor` and not "is this id in the bag": a recipe naming
      // one part twice against a bag holding one must tick exactly one entry,
      // or the card promises a discount the purchase will not give. The Nth
      // entry for a part is consumed when the bag holds at least N of it.
      const claimed = componentSlotsFor(champion, def);
      const claimedIds = claimed.map(slot => champion.items?.[slot]?.def.id);
      const spent = new Map<string, number>();
      const recipe: RecipeLink[] = [];
      for (const partId of def.buildsFrom ?? []) {
        const used = spent.get(partId) ?? 0;
        const available = claimedIds.filter(id => id === partId).length;
        spent.set(partId, used + 1);
        const link = linkTo(byId.get(partId), used < available);
        if (link) recipe.push(link);
      }

      const buildsInto: RecipeLink[] = [];
      for (const parent of parents.get(def.id) ?? []) {
        const link = linkTo(parent, held.has(parent.id));
        if (link) buildsInto.push(link);
      }

      return {
        id: def.id,
        name: def.name,
        description: def.description ?? '',
        image: iconPath(def),
        cost: def.cost,
        price: priceFor(champion, def),
        stats: statLines(def),
        hasActive: def.active !== undefined,
        recipe,
        buildsInto,
        refusal,
        reason: refusal ? REFUSAL_TEXT[refusal] : '',
      };
    })
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

export interface SellRow {
  slot: number;
  /**
   * The qualified item id. Carried as well as the slot because a bag tile
   * opens the same detail view a shelf tile does, and a slot number cannot
   * find a card.
   */
  id: string;
  name: string;
  image: string;
  /** Its own total, so the panel can show what selling costs as well as what it pays. */
  cost: number;
  /** What selling it pays. See `SELL_REFUND_FRACTION` for why it is not the price. */
  refund: number;
  /**
   * Null when it can be sold right now. From `ItemShop.sellRefusalFor`, for
   * the same reason the buy side reads `refusalFor`: the panel gated its Bán
   * button on `canShop` alone, which is one of the two rules a sale applies,
   * so a dead champion's sell button looked enabled and did nothing.
   */
  refusal: SellRefusal | null;
  /** '' when there is no refusal. See `REFUSAL_TEXT`. */
  reason: string;
}

/** What is in the bag right now, sellable. Empty slots are left out. */
export function sellRows(champion: Champion, host: ShopHost): SellRow[] {
  const rows: SellRow[] = [];
  const held = champion.items ?? [];
  for (let slot = 0; slot < held.length; slot++) {
    const item = held[slot];
    if (!item) continue;
    const refusal = sellRefusalFor(champion, slot, host);
    rows.push({
      slot,
      id: item.def.id,
      name: item.def.name,
      image: item.icon?.path ?? '',
      cost: item.def.cost,
      refund: sellValueOf(item.def as QualifiedItem),
      refusal,
      reason: refusal ? REFUSAL_TEXT[refusal] : '',
    });
  }
  return rows;
}

/* ------------------------------------------------------------------------ *
 * What the grid-and-detail panel reads.
 *
 * `ShopPanel.vue` draws a sweep of icon tiles with a detail pane beside it, so
 * between them they ask four questions the old full-width card never had to:
 * which section of the shelf is this in, which of the two prices does the tile
 * print, is this already in the bag, and what does the build tree under it
 * look like. Each one is a `v-if` waiting to happen, and a `v-if` in this
 * panel is exactly the failure the file header names.
 *
 * None of them answers "can this be bought" — `ShopRow.refusal` is still the
 * only answer to that, and it still comes from `ItemShop.refusalFor`.
 * ------------------------------------------------------------------------ */

/** The two shelves a player browses by. */
export type ShopSectionKey = 'basic' | 'combined';

export interface ShopSection {
  key: ShopSectionKey;
  title: string;
  rows: ShopRow[];
}

/**
 * Section headings. Written out here beside `STAT_LABEL` and `REFUSAL_TEXT`
 * rather than in the template, for the same reason those are: every string a
 * player reads in this panel is Vietnamese and lives in one file.
 */
const SECTION_TITLE: Record<ShopSectionKey, string> = {
  basic: 'Trang bị cơ bản',
  combined: 'Trang bị ghép',
};

/**
 * The shelf, split in two: bought whole, or combined out of parts.
 *
 * The only grouping the data actually supports — a pack declares no category —
 * and it happens to be the one worth having, because it is the same line
 * `buildsFrom` draws. Components are what a player buys on the first trip
 * back; combines are what they are saving for. A flat list of fourteen icons
 * says neither.
 *
 * Order inside a section is whatever `shopRows` chose (cheapest first), never
 * re-sorted: that ordering is what makes a browse read as a build order.
 */
export function shopSections(rows: readonly ShopRow[]): ShopSection[] {
  const basic: ShopRow[] = [];
  const combined: ShopRow[] = [];
  for (const row of rows) (row.recipe.length === 0 ? basic : combined).push(row);

  const sections: ShopSection[] = [];
  // An empty section is a heading over nothing, which reads as a shelf that
  // failed to load rather than as a shelf with nothing of that kind on it.
  if (basic.length) sections.push({ key: 'basic', title: SECTION_TITLE.basic, rows: basic });
  if (combined.length) {
    sections.push({ key: 'combined', title: SECTION_TITLE.combined, rows: combined });
  }
  return sections;
}

/** The two numbers a tile and a detail pane print, already formatted. */
export interface PriceLabel {
  /** What this champion pays right now. */
  pay: string;
  /** What it is worth from an empty bag. */
  total: string;
  /** `cost - price`, as a number, for the "đã có … trong túi" line. */
  saved: number;
  /** The two differ, so both are worth printing. */
  discounted: boolean;
}

/**
 * `price` is what a player pays and `cost` is what the item is worth, and the
 * moment a component lands in the bag those stop being the same number. A
 * panel that printed only the first would show a price that dropped for no
 * visible reason; one that printed only the second would lie about the
 * purchase. So both, and the comparison that decides whether the second is
 * worth the space, are answered once, here — never as `v-if="row.price <
 * row.cost"` in a template.
 */
export function priceLabel(row: ShopRow): PriceLabel {
  return {
    pay: String(row.price),
    total: String(row.cost),
    saved: row.cost - row.price,
    discounted: row.price < row.cost,
  };
}

/**
 * Every item id the bag is holding, for the tick a shelf tile wears.
 *
 * Deliberately *not* a count and not a slot: the tile only says "you have one
 * of these", and which one it is, is `bagSlotOf`'s question.
 */
export function heldItemIds(bag: readonly SellRow[]): Set<string> {
  return new Set(bag.map(row => row.id));
}

/**
 * The bag row holding `id`, or null — what the detail pane's Bán button needs.
 *
 * Lowest slot when two copies are held. Arbitrary, but not ambiguous:
 * `sellItem` takes a slot number and "one of them" has to resolve to a slot
 * that is really there.
 */
export function bagSlotOf(bag: readonly SellRow[], id: string): SellRow | null {
  let found: SellRow | null = null;
  for (const row of bag) {
    if (row.id !== id) continue;
    if (found === null || row.slot < found.slot) found = row;
  }
  return found;
}

/** One node of the build tree: a part, and the parts it is made of. */
export interface RecipeNode {
  link: RecipeLink;
  parts: RecipeNode[];
}

/**
 * How many levels of parts the pane draws. Three is what Wild Rift's own tree
 * shows and about what fits: past that the indentation is wider than a phone.
 */
export const RECIPE_TREE_DEPTH = 3;

/**
 * The build tree under one item — its parts, and their parts.
 *
 * `ShopRow.recipe` is one level deep by construction, which is enough to say
 * "this is made of these two" and not enough to say what those two are made
 * of. The second level is where a build order lives, and it is a lookup rather
 * than new data: every part is itself a row on the shelf, carrying its own
 * recipe and its own `owned` marks. So this joins rows to rows and invents
 * nothing.
 *
 * Each node's `owned` is that node's own row's answer — "buying *this* would
 * consume that copy" — and not the root's, because that is the question the
 * player is asking when reading one branch of a tree.
 *
 * Two guards, both because this walks a stranger's content twenty times a
 * second and a hang here is the whole HUD, not one card: a depth cap, and a
 * path set so a cycle stops instead of recursing. `validate.ts` refuses a
 * cyclic pack, which is why this is a guard and not a feature.
 */
export function recipeTree(
  rows: readonly ShopRow[],
  id: string,
  depth: number = RECIPE_TREE_DEPTH
): RecipeNode[] {
  const byId = new Map<string, ShopRow>();
  for (const row of rows) byId.set(row.id, row);

  const walk = (rowId: string, left: number, path: Set<string>): RecipeNode[] => {
    const row = byId.get(rowId);
    if (!row || left <= 0 || path.has(rowId)) return [];
    const deeper = new Set(path).add(rowId);
    return row.recipe.map(link => ({ link, parts: walk(link.id, left - 1, deeper) }));
  };

  return walk(id, depth, new Set());
}
