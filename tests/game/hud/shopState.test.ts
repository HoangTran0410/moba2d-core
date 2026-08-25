import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { REFUSAL_TEXT, sellRows, shopRows } from '@/game/hud/shop/shopState';
import { buyItem } from '@/game/economy/ItemShop';
import { PackRegistry } from '@/content/PackRegistry';
import { resetContentRegistryForTests } from '@/content/registry';
import type { ContentPack } from '@/content/ContentPack';

vi.mock('@/game/economy/itemCatalog', async () => {
  const actual = await vi.importActual<typeof import('@/game/economy/itemCatalog')>(
    '@/game/economy/itemCatalog'
  );
  return { ...actual, shopItems: () => stock };
});

let stock: any[] = [];

const item = (over: Record<string, unknown> = {}) => ({
  id: 'ref:boots',
  packId: 'ref',
  name: 'Giày',
  icon: 'item_boots',
  cost: 300,
  ...over,
});

/**
 * What a shop card says, and the rule the panel is not allowed to re-derive.
 *
 * `ItemShop.refusalFor` decides whether something can be bought. This layer
 * only turns that answer into a sentence — because a greyed-out button whose
 * greying was computed in a template is a second implementation of the shop's
 * rules, and the day the two disagree the player is looking at a button that
 * says yes and a purchase that says no.
 */
describe('shopRows', () => {
  let game: TestGame;
  let champion: Champion;
  const host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    stock = [item()];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('carries no refusal for something that can be bought right now', () => {
    const [row] = shopRows(champion, host);
    expect(row.refusal).toBeNull();
    expect(row.reason).toBe('');
  });

  it('carries the refusal *and* its sentence, so the card never has to guess', () => {
    champion.position.set(2_000, 0);
    const [row] = shopRows(champion, host);
    expect(row.refusal).toBe('NOT_AT_FOUNTAIN');
    expect(row.reason).toBe(REFUSAL_TEXT.NOT_AT_FOUNTAIN);
  });

  it('has a sentence for every refusal there is', () => {
    // A missing entry renders as `undefined` under a greyed card — the exact
    // "it says no and will not say why" this table exists to prevent.
    for (const reason of Object.values(REFUSAL_TEXT)) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('lists cheapest first, so a browse reads as a build order', () => {
    stock = [item({ id: 'ref:c', cost: 900 }), item({ id: 'ref:a', cost: 200 })];
    expect(shopRows(champion, host).map(row => row.cost)).toEqual([200, 900]);
  });

  it('lists an item’s stats in one fixed order, not the order the pack wrote them', () => {
    // Two items granting the same pair must list them the same way round, or
    // the cards cannot be compared against each other at a glance.
    stock = [
      item({ id: 'ref:a', stats: { attackDamage: 10, armor: 20 } }),
      item({ id: 'ref:b', stats: { armor: 5, attackDamage: 30 } }),
    ];
    const [a, b] = shopRows(champion, host);
    expect(a.stats.map(line => line.label)).toEqual(b.stats.map(line => line.label));
  });

  it('reads a fraction as a percentage and a point as a point', () => {
    stock = [item({ stats: { omnivamp: 0.08, armor: 40 } })];
    const [row] = shopRows(champion, host);
    expect(row.stats.map(line => line.amount)).toContain('+8%');
    expect(row.stats.map(line => line.amount)).toContain('+40');
  });

  it('leaves a stat of zero off the card rather than printing "+0"', () => {
    stock = [item({ stats: { armor: 0 } })];
    expect(shopRows(champion, host)[0].stats).toEqual([]);
  });

  it('says nothing about art it cannot resolve, instead of throwing', () => {
    // The panel repaints constantly and `AssetManager.get` throws on an
    // unknown key. One bad icon in one pack must not take the shop down.
    stock = [item({ icon: 'nothing_registered_at_all' })];
    expect(() => shopRows(champion, host)).not.toThrow();
    expect(shopRows(champion, host)[0].image).toBe('');
  });
});

describe('sellRows', () => {
  let game: TestGame;
  let champion: Champion;
  const host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    stock = [item()];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is empty for an empty bag', () => {
    expect(sellRows(champion)).toEqual([]);
  });

  it('names what is held and what it pays back', () => {
    buyItem(champion, item() as never, host);
    const [row] = sellRows(champion);
    expect(row).toMatchObject({ slot: 0, name: 'Giày' });
    expect(row.refund).toBeGreaterThan(0);
    expect(row.refund, 'selling paid the full price back').toBeLessThan(300);
  });

  it('remembers which slot each one is in, and skips the gaps', () => {
    // The slot number is what `sellItem` is called with, so a row that lost
    // track of it sells the wrong item — silently, and irreversibly.
    champion.wallet!.earn(1_000);
    buyItem(champion, item({ id: 'ref:a', name: 'A' }) as never, host);
    buyItem(champion, item({ id: 'ref:b', name: 'B' }) as never, host);
    champion.unequipItem(0);

    expect(sellRows(champion).map(row => ({ slot: row.slot, name: row.name }))).toEqual([
      { slot: 1, name: 'B' },
    ]);
  });
});

/**
 * The recipe half of a card: what this builds out of, what it builds into, and
 * what it costs *this* champion right now.
 *
 * All three are derived here rather than in the template for the reason the
 * file header gives — but `price` has a sharper version of it. The panel
 * repaints on the HUD's 20Hz tick, and what a combine costs changes the moment
 * a component enters or leaves the bag. A template that subtracted the parts
 * itself would be a second implementation of `ItemShop.priceFor`, and the two
 * would disagree in exactly the frame a player was clicking.
 */
describe('a card with a recipe', () => {
  let game: TestGame;
  let champion: Champion;
  const host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };

  const SWORD = item({ id: 'ref:sword', name: 'Kiếm Dài', cost: 350 });
  const CLOAK = item({ id: 'ref:cloak', name: 'Áo Choàng', cost: 400 });
  const BLADE = item({
    id: 'ref:blade',
    name: 'Đại Kiếm',
    cost: 1200,
    buildsFrom: ['ref:sword', 'ref:cloak'],
  });

  const rowFor = (id: string) => shopRows(champion, host).find(row => row.id === id)!;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    champion.wallet!.earn(10_000);
    stock = [SWORD, CLOAK, BLADE];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists its parts, in the order the pack wrote them', () => {
    expect(rowFor('ref:blade').recipe.map(part => part.id)).toEqual(['ref:sword', 'ref:cloak']);
  });

  it('carries each part’s name, art and price, so the panel resolves nothing', () => {
    const [sword] = rowFor('ref:blade').recipe;
    expect(sword.name).toBe('Kiếm Dài');
    expect(sword.cost).toBe(350);
  });

  it('is empty for a component, which is how the panel knows not to draw a tree', () => {
    expect(rowFor('ref:sword').recipe).toEqual([]);
  });

  it('marks a part the bag already holds', () => {
    expect(rowFor('ref:blade').recipe.every(part => part.owned)).toBe(false);
    buyItem(champion, SWORD as never, host);
    const [sword, cloak] = rowFor('ref:blade').recipe;
    expect(sword.owned).toBe(true);
    expect(cloak.owned).toBe(false);
  });

  it('marks only as many copies as the purchase would really consume', () => {
    // Two swords held, a recipe asking for one: the second is not being
    // consumed and a card that ticked it would be promising a refund.
    const twin = item({ id: 'ref:twin', cost: 900, buildsFrom: ['ref:sword', 'ref:sword'] });
    stock = [SWORD, twin];
    buyItem(champion, SWORD as never, host);
    const [first, second] = rowFor('ref:twin').recipe;
    expect(first.owned).toBe(true);
    expect(second.owned).toBe(false);
  });

  it('prices at the full cost with an empty bag', () => {
    const row = rowFor('ref:blade');
    expect(row.cost).toBe(1200);
    expect(row.price).toBe(1200);
  });

  it('drops the price as the parts arrive, without touching the total', () => {
    buyItem(champion, SWORD as never, host);
    buyItem(champion, CLOAK as never, host);
    const row = rowFor('ref:blade');
    expect(row.cost, 'the total is what the item is worth, not what you owe').toBe(1200);
    expect(row.price).toBe(450);
  });

  it('says what a component builds into, so a cheap card is worth reading', () => {
    expect(rowFor('ref:sword').buildsInto.map(link => link.id)).toEqual(['ref:blade']);
  });

  it('leaves that empty for something nothing is built out of', () => {
    expect(rowFor('ref:blade').buildsInto).toEqual([]);
  });
});
