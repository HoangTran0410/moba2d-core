import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { SELL_REFUND_FRACTION, buyItem, sellItem } from '@/game/economy/ItemShop';
import {
  SHOP_HISTORY_LIMIT,
  canRedoShop,
  canUndoShop,
  clearShopHistory,
  redoShop,
  undoShop,
} from '@/game/economy/ShopHistory';
import type { QualifiedItem } from '@/content/PackRegistry';

/**
 * Taking a purchase back at the price it was made.
 *
 * Selling is the thing that already existed and is not the answer: it refunds
 * `SELL_REFUND_FRACTION`, which is the price of *changing your mind*, and a
 * player who clicked the tile beside the one they wanted has not changed their
 * mind. Every case here is about the difference between those two.
 *
 * Driven through the real `buyItem`/`sellItem`, never by pushing steps by
 * hand: the history is recorded inside those two on purpose (there are two
 * callers — the panel and the LAN host — and a record written at either would
 * miss the other), so a test that recorded its own steps would be testing a
 * stack nothing fills.
 */

const def = (over: Partial<QualifiedItem> = {}): QualifiedItem => ({
  id: 'ref:boots',
  packId: 'ref',
  name: 'Giày',
  icon: 'item_boots',
  cost: 300,
  ...over,
});

describe('undoing a purchase', () => {
  let game: TestGame;
  let champion: Champion;
  let host: {
    fountains: { teamId?: string; position: { x: number; y: number }; radius: number }[];
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };
    clearShopHistory(champion);
  });
  afterEach(() => vi.unstubAllGlobals());

  const gold = () => champion.wallet?.balance ?? 0;

  it('gives back every coin, which is what selling does not', () => {
    const boots = def({ cost: 300 });
    const before = gold();

    expect(buyItem(champion, boots, host)).toBe(true);
    expect(gold()).toBe(before - 300);

    expect(undoShop(champion, host)).toBe(true);
    expect(gold()).toBe(before);
    expect(champion.items?.[0]).toBeFalsy();

    // The comparison the whole feature exists for.
    buyItem(champion, boots, host);
    sellItem(champion, 0, host);
    expect(gold()).toBe(before - 300 + Math.floor(300 * SELL_REFUND_FRACTION));
  });

  it('puts a combine’s parts back in the slots they came out of', () => {
    // Small numbers on purpose: a champion starts on 500 gold, and a recipe
    // priced past that fails at `TOO_EXPENSIVE` rather than testing anything.
    const sword = def({ id: 'ref:sword', name: 'Kiếm', cost: 100 });
    const cloak = def({ id: 'ref:cloak', name: 'Áo', cost: 100 });
    const blade = def({
      id: 'ref:blade',
      name: 'Đao',
      cost: 300,
      buildsFrom: ['ref:sword', 'ref:cloak'],
    });
    const before = gold();

    buyItem(champion, sword, host);
    buyItem(champion, cloak, host);
    buyItem(champion, blade, host);

    expect(champion.items?.[0]?.def?.id).toBe('ref:blade');
    expect(champion.items?.[1]).toBeFalsy();
    expect(gold()).toBe(before - 300);

    expect(undoShop(champion, host)).toBe(true);

    // Both parts, in their own slots — not merged, not shuffled left.
    expect(champion.items?.[0]?.def?.id).toBe('ref:sword');
    expect(champion.items?.[1]?.def?.id).toBe('ref:cloak');
    expect(gold()).toBe(before - 200);
  });

  it('refuses once the world has moved on underneath it', () => {
    // Buy the sword, combine it away, then try to take the sword back: it is
    // not in its slot any more, and putting one there would be minting it.
    const sword = def({ id: 'ref:sword', name: 'Kiếm', cost: 100 });
    const blade = def({
      id: 'ref:blade',
      name: 'Đao',
      cost: 300,
      buildsFrom: ['ref:sword'],
    });

    buyItem(champion, sword, host);
    buyItem(champion, blade, host);
    // Undo the combine, then the sword — legal, in that order.
    expect(undoShop(champion, host)).toBe(true);
    expect(undoShop(champion, host)).toBe(true);
    expect(champion.items?.[0]).toBeFalsy();

    // And nothing left to take back.
    expect(undoShop(champion, host)).toBe(false);
  });

  it('obeys the same fountain rule buying does', () => {
    // Otherwise undo *is* a 100% sell: buy the armour for the fight, walk out,
    // undo it on the way.
    buyItem(champion, def(), host);
    champion.position.set(5_000, 0);

    expect(undoShop(champion, host)).toBe(false);
    expect(champion.items?.[0]?.def?.id).toBe('ref:boots');
  });

  it('and the death exemption, because a corpse is allowed to shop', () => {
    buyItem(champion, def(), host);
    champion.position.set(5_000, 0);
    champion.takeDamage(99_999, new Champion({ game, teamId: 'red' }));
    expect(champion.isDead).toBe(true);

    expect(undoShop(champion, host)).toBe(true);
  });
});

describe('undoing a sale, and doing either again', () => {
  let game: TestGame;
  let champion: Champion;
  let host: {
    fountains: { teamId?: string; position: { x: number; y: number }; radius: number }[];
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };
    clearShopHistory(champion);
  });
  afterEach(() => vi.unstubAllGlobals());

  const gold = () => champion.wallet?.balance ?? 0;

  it('takes the refund back out and puts the item back in', () => {
    buyItem(champion, def(), host);
    const held = gold();
    sellItem(champion, 0, host);
    expect(gold()).toBeGreaterThan(held);

    expect(undoShop(champion, host)).toBe(true);
    expect(gold()).toBe(held);
    expect(champion.items?.[0]?.def?.id).toBe('ref:boots');
  });

  it('refuses when the refund has already been spent', () => {
    // Conjuring the item anyway would be a free copy of it.
    buyItem(champion, def({ cost: 300 }), host);
    sellItem(champion, 0, host);
    champion.wallet?.spend(gold());

    expect(undoShop(champion, host)).toBe(false);
    expect(champion.items?.[0]).toBeFalsy();
  });

  it('redoes through the ordinary rules rather than by reversing the reversal', () => {
    // Which means a redo can be refused — here by the gold being gone, the
    // same way a first purchase would be.
    const boots = def({ cost: 300 });
    const before = gold();
    buyItem(champion, boots, host);
    undoShop(champion, host);
    expect(gold()).toBe(before);

    expect(redoShop(champion, host)).toBe(true);
    expect(gold()).toBe(before - 300);
    expect(champion.items?.[0]?.def?.id).toBe('ref:boots');
  });

  it('and a redo is refused when the purchase would be', () => {
    const boots = def({ cost: 300 });
    buyItem(champion, boots, host);
    undoShop(champion, host);
    champion.wallet?.spend(gold());

    expect(redoShop(champion, host)).toBe(false);
    expect(canRedoShop(champion)).toBe(true);
  });

  it('keeps the two stacks honest about what is available', () => {
    expect(canUndoShop(champion)).toBe(false);
    expect(canRedoShop(champion)).toBe(false);

    buyItem(champion, def(), host);
    expect(canUndoShop(champion)).toBe(true);
    expect(canRedoShop(champion)).toBe(false);

    undoShop(champion, host);
    expect(canUndoShop(champion)).toBe(false);
    expect(canRedoShop(champion)).toBe(true);

    // A new action abandons the branch that was undone — the rule every undo
    // stack in every editor uses.
    buyItem(champion, def({ id: 'ref:other', name: 'Khác' }), host);
    expect(canRedoShop(champion)).toBe(false);
  });

  it('does not grow a step for the reversal itself', () => {
    // The `applying` latch. Without it a redo pushes a fresh step and the
    // stack grows by one on every button press.
    buyItem(champion, def(), host);
    for (let i = 0; i < 5; i++) {
      undoShop(champion, host);
      redoShop(champion, host);
    }

    expect(undoShop(champion, host)).toBe(true);
    expect(canUndoShop(champion)).toBe(false);
  });

  it('remembers a bounded number of steps, not the whole match', () => {
    for (let i = 0; i < SHOP_HISTORY_LIMIT + 5; i++) {
      buyItem(champion, def({ id: `ref:x${i}`, name: 'X', cost: 0 }), host);
      sellItem(champion, 0, host);
    }

    let steps = 0;
    while (undoShop(champion, host)) steps++;
    expect(steps).toBeLessThanOrEqual(SHOP_HISTORY_LIMIT);
  });
});
