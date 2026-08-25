import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Spell from '@/game/gameObject/Spell';
import { HeldItem, INVENTORY_SIZE } from '@/game/items/Item';
import {
  SELL_REFUND_FRACTION,
  atOwnFountain,
  buyItem,
  refusalFor,
  sellItem,
  sellValueOf,
} from '@/game/economy/ItemShop';
import { registerSpellForTests, resetSpellRegistryForTests } from '@/game/spellRegistry';
import type { CastSpec } from '@/game/spell/runtime/types';
import type { QualifiedItem } from '@/content/PackRegistry';

class ItemSpell extends Spell {
  name = 'Item Spell';
  coolDown = 0;
  manaCost = 0;
  targetingMode = 'SELF' as const;
  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: 0 },
    };
  }
}

const def = (over: Partial<QualifiedItem> = {}): QualifiedItem => ({
  id: 'ref:boots',
  packId: 'ref',
  name: 'Giày',
  icon: 'item_boots',
  cost: 300,
  ...over,
});

/**
 * Where a shop may be used, and what it refuses.
 *
 * The rule the owner chose: **at your own fountain, and nowhere else.** It is
 * the same rule both games this engine's players have played use, and it is
 * what gives going home a price and a reward — without it, recall is a
 * movement ability and nothing more.
 *
 * `refusalFor` answers with *which* rule said no rather than a bare false, so
 * the panel can say "chưa đủ vàng" instead of greying a button out for
 * reasons the player has to guess.
 */
describe('the shop', () => {
  let game: TestGame;
  let champion: Champion;
  let host: {
    fountains: { teamId?: string; position: { x: number; y: number }; radius: number }[];
  };

  beforeEach(() => {
    stubGameGlobals();
    resetSpellRegistryForTests();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('standing at the fountain', () => {
    it('is true inside your own platform', () => {
      expect(atOwnFountain(champion, host)).toBe(true);
    });

    it('is false one pixel outside it', () => {
      // Absolute, not `radius + n`: a probe written relative to the constant
      // slides with it and stays green however the radius is retuned.
      champion.position.set(201, 0);
      expect(atOwnFountain(champion, host)).toBe(false);
    });

    it('is false standing in the enemy’s fountain', () => {
      host.fountains = [{ teamId: 'red', position: { x: 0, y: 0 }, radius: 200 }];
      expect(atOwnFountain(champion, host)).toBe(false);
    });

    it('is false on a map with no fountains at all', () => {
      host.fountains = [];
      expect(atOwnFountain(champion, host)).toBe(false);
    });
  });

  describe('refusing a purchase', () => {
    it('allows one it should', () => {
      expect(refusalFor(champion, def(), host)).toBeNull();
    });

    it('refuses away from the fountain, and says so', () => {
      champion.position.set(2_000, 0);
      expect(refusalFor(champion, def(), host)).toBe('NOT_AT_FOUNTAIN');
    });

    it('refuses a price the wallet cannot meet', () => {
      expect(refusalFor(champion, def({ cost: 999_999 }), host)).toBe('TOO_EXPENSIVE');
    });

    it('refuses when every slot is full', () => {
      for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
        champion.equipItem(new HeldItem(def({ id: `ref:i${slot}` }), null, null), slot);
      }
      expect(refusalFor(champion, def(), host)).toBe('NO_SLOT');
    });

    it('refuses a corpse', () => {
      champion.takeDamage(99_999, undefined, 'TRUE');
      expect(refusalFor(champion, def(), host)).toBe('DEAD');
    });

    it('refuses an item whose spell has not been fetched yet, rather than half-building it', () => {
      // An item is bought once and held for the rest of the match. Selling the
      // player an inert copy of the thing they wanted, because a chunk had not
      // landed, is the one failure here with no way back.
      expect(refusalFor(champion, def({ active: 'ref:Boots_A' }), host)).toBe('NOT_LOADED');
    });

    it('allows it once that spell is here', () => {
      registerSpellForTests('ref:Boots_A', ItemSpell);
      expect(refusalFor(champion, def({ active: 'ref:Boots_A' }), host)).toBeNull();
    });
  });

  describe('buying', () => {
    it('takes the gold and fills the first free slot', () => {
      const before = champion.wallet!.balance;
      expect(buyItem(champion, def(), host)).toBe(true);
      expect(champion.wallet!.balance).toBe(before - 300);
      expect(champion.items[0]?.def.id).toBe('ref:boots');
    });

    it('grants the item’s stats immediately', () => {
      const before = champion.stats.armor.value;
      buyItem(champion, def({ stats: { armor: 40 } }), host);
      expect(champion.stats.armor.value).toBe(before + 40);
    });

    it('builds the item’s two spells on the buyer', () => {
      registerSpellForTests('ref:Boots_P', ItemSpell);
      registerSpellForTests('ref:Boots_A', ItemSpell);
      buyItem(champion, def({ passive: 'ref:Boots_P', active: 'ref:Boots_A' }), host);

      const held = champion.items[0]!;
      expect(held.passive).toBeInstanceOf(ItemSpell);
      expect(held.active).toBeInstanceOf(ItemSpell);
      expect(held.active!.owner).toBe(champion);
    });

    it('takes nothing at all when it refuses', () => {
      champion.position.set(2_000, 0);
      const before = champion.wallet!.balance;

      expect(buyItem(champion, def(), host)).toBe(false);

      expect(champion.wallet!.balance).toBe(before);
      expect(champion.items.every(slot => slot === null)).toBe(true);
    });

    it('fills the next slot along rather than overwriting the first', () => {
      champion.wallet!.earn(1_000);
      buyItem(champion, def({ id: 'ref:a' }), host);
      buyItem(champion, def({ id: 'ref:b' }), host);
      expect(champion.items.slice(0, 2).map(held => held?.def.id)).toEqual(['ref:a', 'ref:b']);
    });
  });

  describe('selling', () => {
    it('pays back a fraction, not the whole price', () => {
      // A full refund makes an inventory a set of free stat toggles: buy the
      // armour for this fight, sell it for the damage next fight, pay nothing
      // ever. The fraction is what makes a purchase a decision.
      expect(SELL_REFUND_FRACTION).toBeGreaterThan(0);
      expect(SELL_REFUND_FRACTION).toBeLessThan(1);
      expect(sellValueOf(def({ cost: 300 }))).toBe(Math.floor(300 * SELL_REFUND_FRACTION));
    });

    it('empties the slot and pays the wallet', () => {
      buyItem(champion, def({ cost: 300 }), host);
      const afterBuying = champion.wallet!.balance;

      expect(sellItem(champion, 0, host)).toBe(sellValueOf(def({ cost: 300 })));

      expect(champion.items[0]).toBeNull();
      expect(champion.wallet!.balance).toBe(afterBuying + sellValueOf(def({ cost: 300 })));
    });

    it('takes the item’s stats back off', () => {
      const before = champion.stats.armor.value;
      buyItem(champion, def({ stats: { armor: 40 } }), host);
      sellItem(champion, 0, host);
      expect(champion.stats.armor.value).toBe(before);
    });

    it('refuses to sell away from the fountain', () => {
      buyItem(champion, def(), host);
      champion.position.set(2_000, 0);

      expect(sellItem(champion, 0, host)).toBe(0);
      expect(champion.items[0], 'an item was sold from the middle of the map').not.toBeNull();
    });

    it('pays nothing for an empty slot', () => {
      const before = champion.wallet!.balance;
      expect(sellItem(champion, 3, host)).toBe(0);
      expect(champion.wallet!.balance).toBe(before);
    });
  });
});
