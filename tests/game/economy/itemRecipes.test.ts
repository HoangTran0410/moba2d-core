import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { HeldItem, INVENTORY_SIZE } from '@/game/items/Item';
import { buyItem, componentSlotsFor, priceFor, refusalFor } from '@/game/economy/ItemShop';
import { resetSpellRegistryForTests } from '@/game/spellRegistry';
import type { QualifiedItem } from '@/content/PackRegistry';

/**
 * Ghép đồ — buying the big item out of the small ones already in the bag.
 *
 * ## `cost` stays the total, and that is the whole design
 *
 * A pack author writes one number per item: what it costs from nothing. The
 * *combine* cost — what you pay when the components are already held — is
 * derived and never written, because writing both is writing the same fact
 * twice, and the two drift the first time anyone retunes a price.
 *
 * The consequence worth stating out loud: buying the components and combining
 * costs **exactly** what buying the finished item from nothing costs. A recipe
 * is a way to spend a smaller amount sooner, not a discount, so a player who
 * saves up loses nothing and a player who buys as they go is not punished.
 *
 * ## The bag arithmetic is the part that bites
 *
 * A combine both frees slots and fills one. Six components in a **full** bag
 * combining into one item is legal and has to stay legal — the alternative is
 * a player who cannot finish their build precisely because the bag is full of
 * the things the build needs, which is the worst possible moment to be told no.
 */

const def = (over: Partial<QualifiedItem> = {}): QualifiedItem => ({
  id: 'ref:sword',
  packId: 'ref',
  name: 'Kiếm',
  icon: 'item_sword',
  cost: 300,
  ...over,
});

const LONGSWORD = def({
  id: 'ref:longsword',
  name: 'Kiếm Dài',
  cost: 350,
  stats: { attackDamage: 10 },
});
const CLOAK = def({ id: 'ref:cloak', name: 'Áo Choàng', cost: 400, stats: { armor: 20 } });
/** 350 + 400 held, so 450 left to pay. */
const BLADE = def({
  id: 'ref:blade',
  name: 'Đại Kiếm',
  cost: 1200,
  stats: { attackDamage: 40 },
  buildsFrom: ['ref:longsword', 'ref:cloak'],
});
/** The same component twice, which is a real recipe shape and the one greedy matching gets wrong. */
const TWIN = def({
  id: 'ref:twin',
  name: 'Song Kiếm',
  cost: 900,
  buildsFrom: ['ref:longsword', 'ref:longsword'],
});

describe('ghép đồ', () => {
  let game: TestGame;
  let champion: Champion;
  let host: {
    fountains: { teamId?: string; position: { x: number; y: number }; radius: number }[];
  };

  const hold = (item: QualifiedItem, slot: number): void => {
    champion.equipItem(new HeldItem(item, null, null), slot);
  };

  const idsHeld = (): (string | null)[] => champion.items.map(held => held?.def.id ?? null);

  beforeEach(() => {
    stubGameGlobals();
    resetSpellRegistryForTests();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };
    champion.wallet!.earn(10_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('what a purchase would consume', () => {
    it('is nothing at all for an item with no recipe', () => {
      hold(LONGSWORD, 0);
      expect(componentSlotsFor(champion, def({ cost: 300 }))).toEqual([]);
    });

    it('is nothing when the bag holds none of the components', () => {
      expect(componentSlotsFor(champion, BLADE)).toEqual([]);
    });

    it('names the slots the components are actually in', () => {
      hold(CLOAK, 1);
      hold(LONGSWORD, 4);
      expect(componentSlotsFor(champion, BLADE).sort()).toEqual([1, 4]);
    });

    it('takes only what it needs when the bag holds a spare', () => {
      // Three longswords, a recipe that asks for one. Consuming all three
      // would be the player paying 700 gold for nothing.
      hold(LONGSWORD, 0);
      hold(LONGSWORD, 1);
      hold(LONGSWORD, 2);
      hold(CLOAK, 3);
      const consumed = componentSlotsFor(champion, BLADE);
      expect(consumed).toHaveLength(2);
      expect(consumed).toContain(3);
    });

    it('consumes two separate copies when the recipe names one twice', () => {
      // The bug greedy matching ships with: both entries resolve to the same
      // held slot, the player is billed for one longsword and loses one.
      hold(LONGSWORD, 0);
      hold(LONGSWORD, 5);
      expect(componentSlotsFor(champion, TWIN).sort()).toEqual([0, 5]);
    });

    it('matches only one of them when only one is held', () => {
      hold(LONGSWORD, 2);
      expect(componentSlotsFor(champion, TWIN)).toEqual([2]);
    });
  });

  describe('what it costs right now', () => {
    it('is the full price for an item with no recipe', () => {
      expect(priceFor(champion, def({ cost: 300 }))).toBe(300);
    });

    it('is the full price when none of the components are held', () => {
      expect(priceFor(champion, BLADE)).toBe(1200);
    });

    it('takes off exactly what the held components cost', () => {
      hold(LONGSWORD, 0);
      expect(priceFor(champion, BLADE)).toBe(850); // 1200 - 350
      hold(CLOAK, 1);
      expect(priceFor(champion, BLADE)).toBe(450); // 1200 - 350 - 400
    });

    it('never goes below zero, whatever a pack declares', () => {
      // `validate.ts` refuses a total under the sum of its parts, so reaching
      // this is core and a pack disagreeing. A negative price would be
      // `Wallet.spend` handing gold out.
      hold(LONGSWORD, 0);
      const underpriced = def({ id: 'ref:cheap', cost: 100, buildsFrom: ['ref:longsword'] });
      expect(priceFor(champion, underpriced)).toBe(0);
    });

    /**
     * The design claim in the header, asserted as arithmetic rather than
     * trusted: two routes to the same item, the same total spent.
     */
    it('makes buying the parts and combining cost the same as buying it outright', () => {
      const start = champion.wallet!.balance;
      buyItem(champion, LONGSWORD, host);
      buyItem(champion, CLOAK, host);
      buyItem(champion, BLADE, host);
      expect(start - champion.wallet!.balance).toBe(1200);
    });
  });

  describe('the refusals', () => {
    it('measures “not enough gold” against the discounted price, not the total', () => {
      hold(LONGSWORD, 0);
      hold(CLOAK, 1);
      champion.wallet!.spend(champion.wallet!.balance - 500); // 500 left, 450 to pay
      expect(refusalFor(champion, BLADE, host)).toBeNull();
    });

    it('still refuses when even the discounted price is out of reach', () => {
      hold(LONGSWORD, 0);
      champion.wallet!.spend(champion.wallet!.balance - 100);
      expect(refusalFor(champion, BLADE, host)).toBe('TOO_EXPENSIVE');
    });

    /**
     * The case the whole slot rewrite exists for. Before it, a bag holding
     * exactly the six pieces of a build refused every combine in it.
     */
    it('allows a combine out of a completely full bag', () => {
      hold(LONGSWORD, 0);
      hold(CLOAK, 1);
      for (let slot = 2; slot < INVENTORY_SIZE; slot++)
        hold(def({ id: `ref:filler${slot}` }), slot);
      expect(champion.firstEmptyItemSlot()).toBe(-1);
      expect(refusalFor(champion, BLADE, host)).toBeNull();
    });

    it('still refuses a full bag when the item combines out of nothing held', () => {
      for (let slot = 0; slot < INVENTORY_SIZE; slot++)
        hold(def({ id: `ref:filler${slot}` }), slot);
      expect(refusalFor(champion, BLADE, host)).toBe('NO_SLOT');
    });
  });

  describe('the purchase itself', () => {
    it('takes the components out of the bag', () => {
      hold(LONGSWORD, 0);
      hold(CLOAK, 1);
      expect(buyItem(champion, BLADE, host)).toBe(true);
      expect(idsHeld()).not.toContain('ref:longsword');
      expect(idsHeld()).not.toContain('ref:cloak');
    });

    it('lands the new item in the lowest slot it just freed', () => {
      // Not `firstEmptyItemSlot`, which would be slot 2 here. A build that
      // walks rightwards across the bar every time it upgrades is a bar the
      // player has to re-read; the upgrade belongs where its parts were.
      hold(LONGSWORD, 3);
      hold(CLOAK, 4);
      buyItem(champion, BLADE, host);
      expect(idsHeld()[3]).toBe('ref:blade');
    });

    it('uses an empty slot when it consumed nothing', () => {
      buyItem(champion, BLADE, host);
      expect(idsHeld()[0]).toBe('ref:blade');
    });

    it('charges the discounted price and nothing more', () => {
      hold(LONGSWORD, 0);
      hold(CLOAK, 1);
      const before = champion.wallet!.balance;
      buyItem(champion, BLADE, host);
      expect(champion.wallet!.balance).toBe(before - 450);
    });

    /**
     * Stats are the half a slot count cannot see. The components' modifiers
     * have to come off in the same breath their slots are emptied — a combine
     * that keeps the longsword's damage is a champion who is permanently
     * stronger than the bar says, and nothing in the engine would report it.
     */
    it('ends with exactly the new item’s stats and none of its parts’', () => {
      const bare = champion.stats.attackDamage.value;
      hold(LONGSWORD, 0);
      hold(CLOAK, 1);
      expect(champion.stats.attackDamage.value).toBe(bare + 10);
      expect(champion.stats.armor.value).toBe(20);

      buyItem(champion, BLADE, host);

      expect(champion.stats.attackDamage.value).toBe(bare + 40);
      expect(champion.stats.armor.value).toBe(0);
    });

    it('changes nothing at all when a rule refuses it', () => {
      hold(LONGSWORD, 0);
      champion.position.set(9_999, 9_999); // off the platform
      const before = champion.wallet!.balance;

      expect(buyItem(champion, BLADE, host)).toBe(false);
      expect(champion.wallet!.balance).toBe(before);
      expect(idsHeld()[0]).toBe('ref:longsword');
    });

    it('leaves a spare copy of a component alone', () => {
      hold(LONGSWORD, 0);
      hold(LONGSWORD, 1);
      hold(CLOAK, 2);
      buyItem(champion, BLADE, host);
      expect(idsHeld().filter(id => id === 'ref:longsword')).toHaveLength(1);
    });
  });
});

/**
 * The recursion that deliberately is not there.
 *
 * Holding the parts of a part is not holding the part. It is the rule both
 * games this engine's players have played use — you buy the intermediate item,
 * which credits its own components at *that* purchase, and the intermediate is
 * then what the next tier consumes. Crediting transitively would let a bag of
 * six cheap components collapse into a top-tier item in one click, which
 * deletes the build path the recipe exists to draw.
 *
 * Written down because it reads like a missing feature, and the fix for a
 * missing feature is to add it.
 *
 * These are characterization tests, and worth saying so: the behaviour is
 * currently true by the *shape* of `componentSlotsFor`, which holds component
 * ids and no way to resolve them, so transitive credit is not something a
 * small mistake can produce — it would take a registry lookup somebody added
 * on purpose. What these pin is that adding one has to come here first. (They
 * do still bite: loosening the id match to "any held item" turns the first of
 * them red along with three of the cases above.)
 */
describe('a two-level build path', () => {
  let game: TestGame;
  let champion: Champion;
  const host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };

  const PART = def({ id: 'ref:part', cost: 300 });
  const MIDDLE = def({ id: 'ref:middle', cost: 800, buildsFrom: ['ref:part'] });
  const TOP = def({ id: 'ref:top', cost: 2000, buildsFrom: ['ref:middle'] });

  beforeEach(() => {
    stubGameGlobals();
    resetSpellRegistryForTests();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    champion.wallet!.earn(10_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives no credit for holding the part of a part', () => {
    champion.equipItem(new HeldItem(PART, null, null), 0);
    expect(priceFor(champion, TOP)).toBe(2000);
    expect(componentSlotsFor(champion, TOP)).toEqual([]);
  });

  it('credits it once the intermediate is actually bought', () => {
    champion.equipItem(new HeldItem(PART, null, null), 0);
    expect(priceFor(champion, MIDDLE)).toBe(500); // 800 - 300
    buyItem(champion, MIDDLE, host);
    expect(priceFor(champion, TOP)).toBe(1200); // 2000 - 800
  });

  it('still costs the same in total whichever way round it is climbed', () => {
    const start = champion.wallet!.balance;
    buyItem(champion, PART, host);
    buyItem(champion, MIDDLE, host);
    buyItem(champion, TOP, host);
    expect(start - champion.wallet!.balance).toBe(2000);
  });
});
