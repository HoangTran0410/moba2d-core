/**
 * The shared shop rules, run against a shop built to satisfy them.
 *
 * `describeItemShop` registers cases rather than returning findings, which is
 * what makes it usable from a pack (`items.test.ts` is one line) and means it
 * cannot be driven from inside another `it`. So core's own coverage of it is
 * this: a small, deliberately *correct* shop, whose green run proves every
 * rule body actually executes rather than skipping over an empty list — the
 * failure a shared assertion helper is most likely to have and least likely
 * to show.
 *
 * The fixture is written to exercise each rule at least once: an item with a
 * recipe and one without, one that grants only stats and one with an active,
 * a description carrying all three spans, a component that is used and a
 * standalone item that earns its place by doing something.
 *
 * Every rule is *falsified* against the shipped packs, by breaking their data
 * — which is the only place these rules have anything to be wrong about.
 */
import { describeItemShop } from '@/testing/itemRules';
import type { ContentPackData } from '@/content/ContentPack';

const data: Pick<ContentPackData, 'items' | 'champions' | 'spellDisplay'> = {
  items: {
    cloth: { id: 'cloth', name: 'Vải', icon: 'item_cloth', cost: 300, stats: { armor: 18 } },
    rod: { id: 'rod', name: 'Gậy', icon: 'item_rod', cost: 400, stats: { abilityPower: 0.2 } },
    charm: {
      id: 'charm',
      name: 'Bùa',
      icon: 'item_charm',
      cost: 500,
      // The regen lives on the one item nothing builds out of, so the
      // upgrade rule stays out of the way. It is here at all so the unit rule
      // has something to walk: `0.05` per frame is 3/s, what a real sustain
      // item grants. With no regen stat anywhere in this shop that case would
      // loop over nothing and pass, which is the failure this fixture exists
      // about.
      stats: { maxHealth: 20, healthRegen: 0.05 },
      // Builds into nothing and out of nothing, and earns that by having an
      // ability — the one shape the dead-end rule allows.
      active: 'Item_Charm',
      description: 'Kích hoạt: hồi <span class="buff">40</span> máu trong <span class="time">2 giây</span>.',
    },
    plate: {
      id: 'plate',
      name: 'Giáp',
      icon: 'item_plate',
      cost: 900,
      stats: { armor: 30, abilityPower: 0.25, cooldownReduction: 0.1 },
      passive: 'Item_Plate',
      description: 'Nội tại: phản <span class="damage">15</span> sát thương mỗi đòn.',
      buildsFrom: ['cloth', 'rod'],
    },
  },
  champions: [{ id: 'hero', name: 'Hero', spells: ['Hero_Q', 'Hero_W', 'Hero_E', 'Hero_R'] }],
  spellDisplay: { Hero_Q: { name: 'Q' } } as ContentPackData['spellDisplay'],
};

describeItemShop({
  data,
  assetManifest: { item_cloth: 1, item_rod: 1, item_charm: 1, item_plate: 1 },
  spellCatalog: { Item_Charm: 1, Item_Plate: 1, Hero_Q: 1 },
  label: 'a shop that obeys them',
});
