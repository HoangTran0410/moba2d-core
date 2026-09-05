import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_FILTER,
  SHOP_FILTER_KEY,
  filterRows,
  foldText,
  isFiltering,
  loadShopFilter,
  saveShopFilter,
  statChips,
  groupChips,
  groupStatChips,
  STAT_GROUPS,
} from '@/game/hud/shop/shopFilter';
import { STAT_LABEL } from '@/game/hud/itemStatLines';
import { ITEM_STAT_KEYS } from '@/game/items/itemStats';
import { STAT_ICON } from '@/game/hud/statIcons';
import type { ShopRow } from '@/game/hud/shop/shopState';

/**
 * Finding one item on the shelf.
 *
 * `shopSections` splits the stock into bought-whole and combined, which is the
 * only grouping a pack's data supports and is not a way to *find* anything: a
 * player who wants armour has to sweep every tile and read the stat list on
 * each. Two filters answer two different questions — a box for an item you
 * have a name for, chips for one you do not — and both of them are pure
 * functions over rows, which is why they are testable at all.
 */

const row = (over: Partial<ShopRow> = {}): ShopRow => ({
  id: 'ref:boots',
  name: 'Giày Tốc Độ',
  description: 'Đi nhanh hơn.',
  image: '',
  cost: 300,
  price: 300,
  stats: [{ label: STAT_LABEL.speed, amount: '+45' }],
  hasActive: false,
  recipe: [],
  buildsInto: [],
  refusal: null,
  reason: '',
  ...over,
});

const armour = row({
  id: 'ref:cloth',
  name: 'Áo Vải',
  description: 'Một tấm áo.',
  stats: [{ label: STAT_LABEL.armor, amount: '+15' }],
});
const bruiser = row({
  id: 'ref:brute',
  name: 'Đao Phủ',
  description: 'Nặng và bền.',
  stats: [
    { label: STAT_LABEL.attackDamage, amount: '+30' },
    { label: STAT_LABEL.armor, amount: '+20' },
  ],
});
// No stats at all, and prose naming something no stat here is labelled with.
// Its description deliberately avoids the word "giây": folded, that is "giay",
// which is also what "Giày" folds to — a real collision the box is right to
// report and a confusing thing for a fixture to lean on.
const blank = row({
  id: 'ref:tome',
  name: 'Sách Cũ',
  description: 'Hồi máu theo thời gian.',
  stats: [],
});

const SHELF = [row(), armour, bruiser, blank];

describe('folding text for the search box', () => {
  it('strips Vietnamese tone marks, so an unaccented query still matches', () => {
    // The whole point of the box: nobody types tone marks with one hand on the
    // mouse mid-match, and an accent-exact match would make it useless for the
    // player it is for.
    expect(foldText('Giày Tốc Độ')).toBe('giay toc do');
  });

  it('handles đ, which carries its stroke in the base letter', () => {
    // `NFD` splits a letter into its base plus combining marks and leaves this
    // one alone — so the marks class above never sees it and it needs its own
    // line. Without it "dao phu" finds nothing.
    expect(foldText('Đao Phủ')).toBe('dao phu');
  });

  it('collapses whitespace and case', () => {
    expect(foldText('  Kiếm   B.F.  ')).toBe('kiem b.f.');
  });
});

describe('the search box', () => {
  it('matches an unaccented query against an accented name', () => {
    expect(filterRows(SHELF, { text: 'giay', group: null, stats: [] }).map(r => r.id)).toEqual(['ref:boots']);
  });

  it('matches the description too, not only the name', () => {
    // "hồi máu" is a thing a player searches for and not a stat any of these
    // items is labelled with — the prose is where that lives.
    expect(filterRows(SHELF, { text: 'hoi mau', group: null, stats: [] }).map(r => r.id)).toEqual(['ref:tome']);
  });

  it('never matches inside the markup of a description', () => {
    // Descriptions carry spans (`<span class="damage">`), and a search for
    // "span" or "class" returning every item on the shelf would be nonsense.
    const tagged = row({ id: 'ref:tagged', description: '<span class="damage">40</span> sát thương' });
    expect(filterRows([tagged], { text: 'span', group: null, stats: [] })).toEqual([]);
    expect(filterRows([tagged], { text: 'sat thuong', group: null, stats: [] })).toHaveLength(1);
  });

  it('returns the whole shelf, in its own order, when nothing is filtered', () => {
    // Order is never touched: `shopRows` sorts cheapest first, and that
    // ordering is what makes a browse read as a build order.
    expect(filterRows(SHELF, EMPTY_FILTER).map(r => r.id)).toEqual(SHELF.map(r => r.id));
  });
});

describe('the stat chips', () => {
  it('offers a chip only for a stat something on this shelf actually grants', () => {
    // A chip that filters to nothing is worse than no chip: it says the shelf
    // has lifesteal on it somewhere and then proves it does not.
    const keys = statChips(SHELF).map(chip => chip.key);

    expect(keys).toContain('armor');
    expect(keys).toContain('speed');
    expect(keys).toContain('attackDamage');
    expect(keys).not.toContain('omnivamp');
  });

  it('counts how many items grant each one', () => {
    const armourChip = statChips(SHELF).find(chip => chip.key === 'armor')!;
    expect(armourChip.count).toBe(2);
    expect(armourChip.label).toBe(STAT_LABEL.armor);
  });

  /**
   * And carries the icon the roster's stat sheet draws for the same stat,
   * rather than one chosen here. Two hand-written lists would be two pictures
   * for one stat, and nothing renders, compiles or lints differently when they
   * disagree — see `statIcons.test.ts`.
   */
  it('wears the shared icon for the stat, not one of its own', () => {
    for (const chip of statChips(SHELF)) {
      expect(chip.icon, chip.key).toBe(STAT_ICON[chip.key]);
    }
  });

  it('lists them in the card’s own order, not in whatever order items were read', () => {
    // Two shelves granting the same stats must offer the same row of chips —
    // `ITEM_STAT_KEYS` order, the same order `statLinesFor` prints.
    const forwards = statChips(SHELF).map(chip => chip.key);
    const backwards = statChips([...SHELF].reverse()).map(chip => chip.key);
    expect(backwards).toEqual(forwards);
  });

  it('keeps an item that grants any one of several picked stats, not all of them', () => {
    // `or`, not `and`. "Armour or attack damage" is a real shopping question;
    // "both in one item" is a rarer one, and with `and` the second tap usually
    // empties the grid, which reads as the filter being broken.
    const ids = filterRows(SHELF, { text: '', group: null, stats: ['armor', 'speed'] }).map(r => r.id);
    expect(ids).toEqual(['ref:boots', 'ref:cloth', 'ref:brute']);
  });

  it('drops an item that grants no stats at all when any chip is on', () => {
    expect(filterRows(SHELF, { text: '', group: null, stats: ['armor'] }).map(r => r.id)).toEqual([
      'ref:cloth',
      'ref:brute',
    ]);
  });

  it('applies the box and the chips together', () => {
    // Both narrow: `and` between the two controls, `or` inside the chips.
    expect(filterRows(SHELF, { text: 'dao', group: null, stats: ['armor'] }).map(r => r.id)).toEqual([
      'ref:brute',
    ]);
    expect(filterRows(SHELF, { text: 'giay', group: null, stats: ['armor'] })).toEqual([]);
  });
});

describe('whether anything is filtered', () => {
  it('ignores a box holding only whitespace', () => {
    expect(isFiltering({ text: '   ', group: null, stats: [] })).toBe(false);
    expect(isFiltering({ text: 'g', group: null, stats: [] })).toBe(true);
    expect(isFiltering({ text: '', group: null, stats: ['armor'] })).toBe(true);
  });
});

describe('the filter outliving the panel', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('comes back the way it was left', () => {
    // `ShopPanel` is `v-if`'d, so its own state dies every time the shop
    // closes — and the shop is opened and shut several times on one trip to
    // the fountain. Re-picking three chips each time is the friction this
    // whole feature exists to remove.
    saveShopFilter({ text: 'giay', group: null, stats: ['armor', 'speed'] });
    expect(loadShopFilter()).toEqual({ text: 'giay', group: null, stats: ['armor', 'speed'] });
  });

  it('stores nothing at all once the filter is cleared', () => {
    saveShopFilter({ text: 'giay', group: null, stats: ['armor'] });
    saveShopFilter({ text: '', group: null, stats: [] });

    expect(store.has(SHOP_FILTER_KEY)).toBe(false);
    expect(loadShopFilter()).toEqual(EMPTY_FILTER);
  });

  it('drops a stat key it no longer knows', () => {
    // A stale key from an older build, or a hand-edited store, would otherwise
    // filter every item out and leave a player looking at an empty shop with a
    // chip they cannot see selected.
    store.set(SHOP_FILTER_KEY, JSON.stringify({ text: 'x', group: null, stats: ['armor', 'thorns'] }));
    expect(loadShopFilter()).toEqual({ text: 'x', group: null, stats: ['armor'] });
  });

  it('reads a corrupt store as no filter rather than throwing', () => {
    store.set(SHOP_FILTER_KEY, '{not json');
    expect(loadShopFilter()).toEqual(EMPTY_FILTER);
  });

  it('survives a store that refuses to be read or written', () => {
    // Private browsing, or a browser set to block site data. The filter is
    // lost; the shelf is not.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });

    expect(loadShopFilter()).toEqual(EMPTY_FILTER);
    expect(() => saveShopFilter({ text: 'giay', group: null, stats: [] })).not.toThrow();
  });
});

describe('the family tier', () => {
  it('sorts every stat key into exactly one family', () => {
    // The guard for the next stat key (a percent variant, say): a key in no
    // family never appears in any refinement row, and a key in two makes the
    // same chip answer to two buttons. Both are silent in the UI.
    const seen = new Map<string, number>();
    for (const group of STAT_GROUPS)
      for (const key of group.stats) seen.set(key, (seen.get(key) ?? 0) + 1);
    for (const key of ITEM_STAT_KEYS) expect(seen.get(key), key).toBe(1);
    expect([...seen.values()].every(count => count === 1)).toBe(true);
  });

  it('offers a family button only when the shelf stocks it, with its count', () => {
    const chips = groupChips(SHELF);
    const byKey = new Map(chips.map(chip => [chip.key, chip.count]));
    // boots (speed) -> mobility; cloth + brute (armor) -> defense; brute (AD) -> attack.
    expect(byKey.get('mobility')).toBe(1);
    expect(byKey.get('defense')).toBe(2);
    expect(byKey.get('attack')).toBe(1);
    // Nothing on this shelf grants a magic or an "other" stat.
    expect(byKey.has('magic')).toBe(false);
    expect(byKey.has('other')).toBe(false);
  });

  it('cuts the refinement row down to the open family', () => {
    const keys = groupStatChips(SHELF, 'defense').map(chip => chip.key);
    expect(keys).toEqual(['armor']);
    expect(groupStatChips(SHELF, 'magic')).toEqual([]);
  });

  it('filters by the whole family while nothing in it is picked', () => {
    const ids = filterRows(SHELF, { text: '', group: 'defense', stats: [] }).map(r => r.id);
    expect(ids).toEqual(['ref:cloth', 'ref:brute']);
  });

  it('lets a picked stat narrow past its family', () => {
    // brute grants armor AND attackDamage; picking armor inside defense must
    // not widen back out to the family.
    const ids = filterRows(SHELF, { text: '', group: 'attack', stats: ['attackDamage'] }).map(
      r => r.id
    );
    expect(ids).toEqual(['ref:brute']);
  });

  it('counts an open family as a live filter', () => {
    expect(isFiltering({ text: '', group: 'defense', stats: [] })).toBe(true);
  });

  it('comes back from the store, and drops stats the stored family does not own', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    try {
      saveShopFilter({ text: '', group: 'defense', stats: ['armor'] });
      expect(loadShopFilter()).toEqual({ text: '', group: 'defense', stats: ['armor'] });

      // A hand edit, or a build that moved a stat between families: a lit
      // chip inside a family that does not show it filters invisibly.
      store.set(
        SHOP_FILTER_KEY,
        JSON.stringify({ text: '', group: 'defense', stats: ['armor', 'attackDamage'] })
      );
      expect(loadShopFilter()).toEqual({ text: '', group: 'defense', stats: ['armor'] });

      // An unknown family reads as none at all.
      store.set(SHOP_FILTER_KEY, JSON.stringify({ text: '', group: 'petting-zoo', stats: [] }));
      expect(loadShopFilter()).toEqual(EMPTY_FILTER);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
