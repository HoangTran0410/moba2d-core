import { ITEM_STAT_KEYS, type ItemStatKey } from '@/game/items/itemStats';
import { STAT_LABEL } from '@/game/hud/itemStatLines';
import { STAT_GROUP_ICON, STAT_ICON } from '@/game/hud/statIcons';
import type { ShopRow } from './shopState';

/**
 * Finding one item on a shelf, without reading the shelf.
 *
 * ## The problem
 *
 * `shopSections` splits the stock two ways — bought whole, or combined out of
 * parts — and that is the only grouping the data supports, because a pack
 * declares no categories. It is a good split and it is not a way to *find*
 * anything: a player who wants armour has to sweep every tile in both sections
 * and read the stat list on each one, and the packs shipped here are already
 * past the point where that is a glance.
 *
 * ## Two filters, because they answer different questions
 *
 * **The box** is for an item somebody already has a name for. It matches the
 * name and the prose, so "hồi máu" finds the item whose description says so
 * even when no stat is called that.
 *
 * **The chips** are for a player who knows what they want and not what it is
 * called — "something with armour". They come off `stats`, the same list the
 * card prints, so a chip exists exactly when some item on this shelf actually
 * grants that stat. A shelf with no lifesteal on it grows no lifesteal chip,
 * rather than a chip that filters to nothing.
 *
 * Each chip wears the stat's own icon from `statIcons.ts` — the same one the
 * roster's stat sheet draws — with the word kept beside it. The icon is what
 * makes a row of a dozen pills scannable; the word is what makes an unfamiliar
 * one readable, so neither replaces the other.
 *
 * Several chips are **or**, not **and**. "Armour or magic resist" is a real
 * shopping question and "armour and magic resist in one item" is a rarer one;
 * with `and` a second tap usually empties the grid, which reads as the filter
 * being broken.
 *
 * ## Diacritics
 *
 * `giay` finds `Giày`. Typing Vietnamese tone marks into a search box mid-match
 * is not something anyone does with one hand on the mouse, and an accent-exact
 * match would make the box useless for precisely the player it is for.
 */

/**
 * The five families the stats sort into — the top tier of a two-tier filter.
 *
 * One chip per stat was the original control, and it aged badly on purpose:
 * a chip exists exactly when the shelf grants that stat, so every shelf the
 * packs grew pushed the row closer to all ~20 keys — three wrapped rows of
 * pills on a screen that measures its height in tile rows. Nobody shops by
 * scanning twenty pills; they think "đồ chống chịu" first and "giáp hay
 * kháng phép" second. So the top row is these five, and picking one unfolds
 * only its own stats as the refinement row.
 *
 * Every `ITEM_STAT_KEYS` member belongs to exactly one family —
 * `shopFilter.test.ts` holds the partition, so a future stat key (a percent
 * variant, say) fails a test instead of silently never appearing in any
 * group's refinement row.
 */
export type StatGroupKey = 'attack' | 'magic' | 'defense' | 'mobility' | 'other';

export interface StatGroup {
  key: StatGroupKey;
  label: string;
  /** From `STAT_GROUP_ICON` — the same table every stat surface reads. */
  icon: string;
  stats: readonly ItemStatKey[];
}

export const STAT_GROUPS: readonly StatGroup[] = [
  {
    key: 'attack',
    label: 'Tấn Công',
    icon: STAT_GROUP_ICON.attack,
    stats: [
      'attackDamage',
      'attackSpeed',
      'critChance',
      'critDamage',
      'armorPenetration',
      'lifesteal',
      'onHitDamage',
      'attackRange',
    ],
  },
  {
    key: 'magic',
    label: 'Phép Thuật',
    icon: STAT_GROUP_ICON.magic,
    stats: ['abilityPower', 'abilityHaste', 'magicPenetration', 'spellVamp', 'maxMana', 'manaRegen'],
  },
  {
    key: 'defense',
    label: 'Phòng Thủ',
    icon: STAT_GROUP_ICON.defense,
    stats: ['maxHealth', 'armor', 'magicResist', 'tenacity', 'healthRegen', 'healingReceived'],
  },
  { key: 'mobility', label: 'Cơ Động', icon: STAT_GROUP_ICON.mobility, stats: ['speed', 'speedPercent'] },
  { key: 'other', label: 'Khác', icon: STAT_GROUP_ICON.other, stats: ['omnivamp', 'visionRadius'] },
];

const GROUP_BY_KEY = new Map(STAT_GROUPS.map(group => [group.key, group] as const));

/** One family button above the grid, with how many items on this shelf it covers. */
export interface GroupChip {
  key: StatGroupKey;
  label: string;
  icon: string;
  count: number;
}

/** One toggle above the grid. */
export interface StatChip {
  key: ItemStatKey;
  label: string;
  /**
   * The stat's icon, from the shared table every surface that draws stats
   * reads — `statIcons.ts`. Not chosen here: the roster's stat sheet draws the
   * same seventeen stats, and two hand-written lists would drift into two
   * pictures for one thing with nothing to catch it.
   *
   * It sits *beside* the label, never instead of it. A row of seventeen
   * wordless pills is a puzzle, and the icon's job is to let a player who
   * already knows the word find it without reading all seventeen.
   */
  icon: string;
  /** How many items on this shelf grant it — the chip's own subtitle. */
  count: number;
}

export interface ShopFilter {
  text: string;
  /** The open family, or `null` for the whole shelf. Picking one clears `stats`. */
  group: StatGroupKey | null;
  /** Refinements within `group` — always a subset of the open family's stats. */
  stats: readonly ItemStatKey[];
}

export const EMPTY_FILTER: ShopFilter = { text: '', group: null, stats: [] };

/**
 * Lowercase, accent-stripped, whitespace-collapsed.
 *
 * `NFD` splits a letter into its base and its marks, and the marks are then a
 * character class of their own — so this needs no table of Vietnamese vowels
 * and stays correct for whatever a pack writes next.
 */
export function foldText(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // đ/Đ carries its stroke in the base letter, so NFD leaves it alone.
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Strip the markup a pack's description carries, so a search never matches a tag. */
const plainText = (html: string): string => html.replace(/<[^>]*>/g, ' ');

/** Every stat some item on this shelf actually grants, in the card's own order. */
export function statChips(rows: readonly ShopRow[]): StatChip[] {
  const counts = new Map<ItemStatKey, number>();
  for (const row of rows) {
    // `row.stats` is already `statLinesFor`'s output — labels, not keys — so
    // the key comes back off the label. One map, built once, rather than a
    // second pass over the defs this module cannot see.
    for (const line of row.stats) {
      const key = KEY_BY_LABEL.get(line.label);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const chips: StatChip[] = [];
  for (const key of ITEM_STAT_KEYS) {
    const count = counts.get(key);
    if (count) chips.push({ key, label: STAT_LABEL[key], icon: STAT_ICON[key], count });
  }
  return chips;
}

const KEY_BY_LABEL = new Map<string, ItemStatKey>(
  ITEM_STAT_KEYS.map(key => [STAT_LABEL[key], key] as const)
);

/**
 * The five family buttons, each counting the items it would show. A family
 * nothing on this shelf belongs to grows no button — the same rule the stat
 * chips have always followed, for the same reason: a control that filters to
 * an empty grid reads as broken, not as thorough.
 */
export function groupChips(rows: readonly ShopRow[]): GroupChip[] {
  const chips: GroupChip[] = [];
  for (const group of STAT_GROUPS) {
    let count = 0;
    for (const row of rows) if (grantsAny(row, group.stats)) count++;
    if (count) chips.push({ key: group.key, label: group.label, icon: group.icon, count });
  }
  return chips;
}

/** The open family's own stat chips — `statChips` cut down to its members. */
export function groupStatChips(rows: readonly ShopRow[], group: StatGroupKey): StatChip[] {
  const members = GROUP_BY_KEY.get(group)?.stats ?? [];
  return statChips(rows).filter(chip => members.includes(chip.key));
}

/** Whether `row` grants any of `stats`. */
const grantsAny = (row: ShopRow, stats: readonly ItemStatKey[]): boolean => {
  for (const line of row.stats) {
    const key = KEY_BY_LABEL.get(line.label);
    if (key && stats.includes(key)) return true;
  }
  return false;
};

/**
 * The shelf, filtered. Order is never touched — `shopRows` sorts cheapest
 * first and that ordering is what makes a browse read as a build order.
 */
export function filterRows(rows: readonly ShopRow[], filter: ShopFilter): ShopRow[] {
  const needle = foldText(filter.text);
  // A refinement narrows further than its family, so when both are set the
  // stats answer alone; the open family matters only while nothing in it has
  // been picked yet ("đồ chống chịu, cái nào cũng được").
  const stats =
    filter.stats.length > 0
      ? filter.stats
      : filter.group !== null
        ? (GROUP_BY_KEY.get(filter.group)?.stats ?? [])
        : [];
  if (!needle && stats.length === 0) return [...rows];

  return rows.filter(row => {
    if (stats.length > 0 && !grantsAny(row, stats)) return false;
    if (!needle) return true;
    return foldText(`${row.name} ${plainText(row.description)}`).includes(needle);
  });
}

/** Whether anything is being filtered — what the clear button is shown for. */
export const isFiltering = (filter: ShopFilter): boolean =>
  filter.text.trim().length > 0 || filter.group !== null || filter.stats.length > 0;

/* ------------------------------------------------------------- persistence */

/**
 * The filter outlives the panel.
 *
 * `ShopPanel` is `v-if`'d, so `<script setup>` state dies every time the shop
 * closes — and the shop is opened and closed several times a trip to the
 * fountain. Re-picking three chips each time is the whole of the friction this
 * feature exists to remove, so it is a *setting*, kept the guarded `moba2d:*`
 * way every preference in this codebase is kept: a blocked store reads as the
 * default and swallows the write.
 *
 * Stat keys are validated on the way back in. A stale key from an older build,
 * or a hand-edited store, would otherwise filter every item out and leave a
 * player looking at an empty shop with a chip they cannot see selected.
 */
export const SHOP_FILTER_KEY = 'moba2d:shopFilter:v1';

export function loadShopFilter(): ShopFilter {
  try {
    const raw = localStorage.getItem(SHOP_FILTER_KEY);
    if (!raw) return EMPTY_FILTER;
    const parsed = JSON.parse(raw) as Partial<ShopFilter>;
    const known = new Set<string>(ITEM_STAT_KEYS);
    // A store written before the family tier existed carries no `group` —
    // that reads as `null`, which is exactly what it meant then.
    const group =
      typeof parsed.group === 'string' && GROUP_BY_KEY.has(parsed.group as StatGroupKey)
        ? (parsed.group as StatGroupKey)
        : null;
    const members = group === null ? null : new Set(GROUP_BY_KEY.get(group)!.stats);
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      group,
      // Stats are refinements OF the open family, so beyond being real keys
      // they must belong to it — a stray pair (an old store, a hand edit)
      // would otherwise filter by a stat no visible chip is lit for.
      stats: Array.isArray(parsed.stats)
        ? (parsed.stats.filter(
            key =>
              typeof key === 'string' &&
              known.has(key) &&
              (members === null || members.has(key as ItemStatKey))
          ) as ItemStatKey[])
        : [],
    };
  } catch {
    return EMPTY_FILTER;
  }
}

export function saveShopFilter(filter: ShopFilter): void {
  try {
    if (!isFiltering(filter)) {
      localStorage.removeItem(SHOP_FILTER_KEY);
      return;
    }
    localStorage.setItem(
      SHOP_FILTER_KEY,
      JSON.stringify({ text: filter.text, group: filter.group, stats: filter.stats })
    );
  } catch {
    // a blocked store loses the filter, never the shelf
  }
}
