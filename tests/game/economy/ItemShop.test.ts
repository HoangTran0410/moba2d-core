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
  sellRefusalFor,
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
 * The rule the owner chose: **at your own fountain — or dead.** It is the
 * same rule both games this engine's players have played use: the fountain
 * half gives going home a price and a reward — without it, recall is a
 * movement ability and nothing more — and the death timer is shopping time,
 * so a corpse buys from wherever it fell.
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

    it('lets a corpse buy — the death timer is shopping time', () => {
      champion.takeDamage(99_999, undefined, 'TRUE');
      expect(refusalFor(champion, def(), host)).toBeNull();
    });

    it('lets a corpse buy from wherever it fell, not only at the fountain', () => {
      champion.position.set(2_000, 0);
      champion.takeDamage(99_999, undefined, 'TRUE');
      expect(refusalFor(champion, def(), host)).toBeNull();
      expect(buyItem(champion, def(), host)).toBe(true);
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

/**
 * Selling has rules too, and until now nothing could ask what they were.
 *
 * `refusalFor` exists because a bare `false` leaves a panel greying a button
 * out for reasons the player has to guess — and selling had **no** equivalent,
 * so the shop panel gated its Bán button on `canShop` alone, which is one of
 * the two rules `sellItem` actually applies. A dead champion's sell button
 * looked enabled and did nothing: the exact "button says yes, purchase says
 * no" failure the buy side was designed against, reproduced on the other half
 * of the same panel.
 *
 * `sellItem` is now this function plus the mutation, the same way `buyItem` is
 * `refusalFor` plus the mutation, so the two cannot come apart.
 */
describe('what refuses a sale', () => {
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
    champion.equipItem(new HeldItem(def({ cost: 300 }), null, null), 0);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses nothing when the item is there and the champion is home', () => {
    expect(sellRefusalFor(champion, 0, host)).toBeNull();
  });

  it('says the slot is empty rather than pretending it is sellable', () => {
    expect(sellRefusalFor(champion, 3, host)).toBe('EMPTY');
  });

  it('refuses a slot that is not one', () => {
    expect(sellRefusalFor(champion, -1, host)).toBe('EMPTY');
    expect(sellRefusalFor(champion, INVENTORY_SIZE, host)).toBe('EMPTY');
  });

  it('refuses away from the fountain, the same rule buying uses', () => {
    champion.position.set(2_000, 0);
    expect(sellRefusalFor(champion, 0, host)).toBe('NOT_AT_FOUNTAIN');
  });

  it('lets a corpse sell — the death timer is shopping time', () => {
    champion.takeDamage(99_999, undefined, 'TRUE');
    expect(champion.isDead).toBe(true);
    expect(sellRefusalFor(champion, 0, host)).toBeNull();
  });

  it('lets a corpse sell from wherever it fell — death satisfies the location rule', () => {
    champion.position.set(2_000, 0);
    champion.takeDamage(99_999, undefined, 'TRUE');
    expect(sellRefusalFor(champion, 0, host)).toBeNull();
  });

  it('is the whole of what `sellItem` checks, so the two can never disagree', () => {
    // Driven rather than asserted structurally: for every state the refusal
    // has an opinion about, the mutation has to agree with it.
    const cases: [string, () => void][] = [
      ['at home, holding it', () => {}],
      ['away', () => champion.position.set(2_000, 0)],
      ['dead', () => champion.takeDamage(99_999, undefined, 'TRUE')],
    ];
    for (const [label, arrange] of cases) {
      const fresh = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
      indexObjects(game, [fresh]);
      fresh.equipItem(new HeldItem(def({ cost: 300 }), null, null), 0);
      champion = fresh;
      arrange();

      const refused = sellRefusalFor(fresh, 0, host) !== null;
      const paid = sellItem(fresh, 0, host);
      expect(refused, `${label}: refusal said ${refused}, sale paid ${paid}`).toBe(paid === 0);
    }
  });
});

/**
 * **Who the shop is answering to**, and therefore which rules apply.
 *
 * The shop grew a second caller: the practice panel's roster can open it
 * *aimed at another champion* — a bot — so an owner can build that bot a kit
 * without playing it. Everything about that is the same shop; one rule cannot
 * survive the trip.
 *
 * "At your own fountain, and nowhere else" is a rule about where the buyer's
 * feet are, and the buyer here is a bot standing wherever the match has put
 * it. Enforced, the feature is dead on arrival — the panel would refuse every
 * purchase for the whole match except the few seconds after a respawn. So
 * `'CHEAT'` waives exactly that one check.
 *
 * It waives **nothing else**, and that is the half worth testing. The gold is
 * real and comes out of that bot's own wallet; the bag is real and can be
 * full. The mode is not "ignore the rules", it is
 * "this buyer is not standing in a shop" — which is why it is named for who is
 * asking rather than for what it turns off.
 */
describe('shopping on someone else’s behalf', () => {
  let game: TestGame;
  let bot: Champion;
  let host: {
    fountains: { teamId?: string; position: { x: number; y: number }; radius: number }[];
  };

  beforeEach(() => {
    stubGameGlobals();
    resetSpellRegistryForTests();
    game = createGame();
    bot = new Champion({ game, position: createVector(9_000, 9_000), teamId: 'blue' });
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };
    bot.wallet!.earn(10_000);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a purchase out in the lane, as the player’s own shop must', () => {
    expect(refusalFor(bot, def({ cost: 300 }), host)).toBe('NOT_AT_FOUNTAIN');
  });

  it('allows it for a cheat, because the buyer is not the one standing anywhere', () => {
    expect(refusalFor(bot, def({ cost: 300 }), host, 'CHEAT')).toBeNull();
  });

  it('still charges that champion’s own gold', () => {
    const before = bot.wallet!.balance;
    expect(buyItem(bot, def({ cost: 300 }), host, 'CHEAT')).toBe(true);
    expect(bot.wallet!.balance).toBe(before - 300);
  });

  it('still refuses when that champion cannot afford it', () => {
    bot.wallet!.spend(bot.wallet!.balance - 100);
    expect(refusalFor(bot, def({ cost: 300 }), host, 'CHEAT')).toBe('TOO_EXPENSIVE');
    expect(buyItem(bot, def({ cost: 300 }), host, 'CHEAT')).toBe(false);
  });

  it('still refuses when that champion’s bag is full', () => {
    for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
      bot.equipItem(new HeldItem(def({ id: `ref:filler${slot}` }), null, null), slot);
    }
    expect(refusalFor(bot, def({ cost: 300 }), host, 'CHEAT')).toBe('NO_SLOT');
  });

  it('outfits a corpse too — death opens the shop rather than closing it', () => {
    bot.takeDamage(99_999, undefined, 'TRUE');
    expect(refusalFor(bot, def({ cost: 300 }), host, 'CHEAT')).toBeNull();
  });

  it('sells out in the lane too, and pays that champion', () => {
    bot.equipItem(new HeldItem(def({ cost: 300 }), null, null), 0);
    expect(sellRefusalFor(bot, 0, host)).toBe('NOT_AT_FOUNTAIN');
    expect(sellRefusalFor(bot, 0, host, 'CHEAT')).toBeNull();

    const before = bot.wallet!.balance;
    expect(sellItem(bot, 0, host, 'CHEAT')).toBe(sellValueOf(def({ cost: 300 })));
    expect(bot.wallet!.balance).toBe(before + sellValueOf(def({ cost: 300 })));
  });

  it('defaults to the player’s rules when nobody says otherwise', () => {
    // The default is the strict one on purpose: a call site that forgot to
    // pass a mode gets the rule the game is played by, never the cheat.
    expect(refusalFor(bot, def({ cost: 300 }), host)).toBe('NOT_AT_FOUNTAIN');
    expect(sellItem(bot, 0, host)).toBe(0);
  });
});
