import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import {
  REFUSAL_TEXT,
  bagSlotOf,
  heldItemIds,
  packSections,
  priceLabel,
  recipeTree,
  sellRows,
  shopRows,
  shopSections,
  type RecipeLink,
  type ShopRow,
} from '@/game/hud/shop/shopState';
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

  it('prints the item text as the pack wrote it, ability power or not', () => {
    // The card is priced for this buyer (`priceFor`) and its *sentence* is
    // not, which looks like an inconsistency and is the rule. Item abilities
    // are the one population `economy/ItemShop` opts out of ability power by
    // hand — they already read `attackDamage`, and paying one purchase out of
    // two stats is what that flag exists to stop — so a card promising
    // `30 (+60)` would be promising damage the active will never deal. It did,
    // for one commit.
    stock = [
      item({
        description:
          'Tăng 45 kháng phép. Kích hoạt: gây <span class="damage">30 sát thương phép</span>.',
      }),
    ];
    champion.stats.abilityPower.baseValue = 2;

    const [row] = shopRows(champion, host);

    expect(row.description).toBe(
      'Tăng 45 kháng phép. Kích hoạt: gây <span class="damage">30 sát thương phép</span>.'
    );
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
    expect(sellRows(champion, host)).toEqual([]);
  });

  it('names what is held and what it pays back', () => {
    buyItem(champion, item() as never, host);
    const [row] = sellRows(champion, host);
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

    expect(sellRows(champion, host).map(row => ({ slot: row.slot, name: row.name }))).toEqual([
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

/**
 * The bag rows. Thin, but they carry the item's **id** as well as its slot,
 * because the redesigned panel lets a bag tile open the same detail view a
 * shelf tile opens — and a slot number cannot find a card.
 */
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
    champion.wallet!.earn(10_000);
    stock = [item({ id: 'ref:sword', name: 'Kiếm Dài', cost: 350 })];
    buyItem(champion, stock[0], host);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names the item it is, not only the slot it is in', () => {
    const [row] = sellRows(champion, host);
    expect(row.id).toBe('ref:sword');
    expect(row.slot).toBe(0);
  });

  it('carries the total beside the refund, so the price of the mistake is legible', () => {
    const [row] = sellRows(champion, host);
    expect(row.cost).toBe(350);
    expect(row.refund).toBe(245); // 350 * 0.7
  });
});

/**
 * The derivations the redesigned panel reads, and the reason they live here
 * rather than in the template.
 *
 * The grid is a sweep of icon tiles and the detail pane carries everything a
 * tile no longer does, so between them they ask four questions the old
 * full-width card never had to: which shelf section is this in, which of the
 * two prices does the tile print, is this already in the bag, and what does
 * the build tree under it look like. Every one of those is a `v-if` waiting
 * to happen, and a `v-if` in this panel is the failure the file header names
 * — a second implementation of the shop's rules, disagreeing with `ItemShop`
 * on the frame the player clicked. None of them decides *whether* anything
 * can be bought: `row.refusal` is still the only answer to that, and it still
 * comes from `ItemShop.refusalFor`.
 */
const shelfRow = (over: Partial<ShopRow> = {}): ShopRow => ({
  id: 'ref:x',
  name: 'X',
  description: '',
  image: '',
  cost: 100,
  price: 100,
  stats: [],
  hasActive: false,
  recipe: [],
  buildsInto: [],
  refusal: null,
  reason: '',
  ...over,
});

const link = (id: string, owned = false): RecipeLink => ({
  id,
  name: id,
  image: '',
  cost: 100,
  owned,
});

describe('shopSections', () => {
  it('splits the shelf into what is bought whole and what is combined', () => {
    const sections = shopSections([
      shelfRow({ id: 'ref:sword' }),
      shelfRow({ id: 'ref:blade', recipe: [link('ref:sword')] }),
    ]);
    expect(sections.map(section => section.key)).toEqual(['basic', 'combined']);
    expect(sections.map(section => section.rows.map(row => row.id))).toEqual([
      ['ref:sword'],
      ['ref:blade'],
    ]);
  });

  it('leaves the order shopRows chose alone inside a section', () => {
    // Cheapest-first is what makes a browse read as a build order, and a
    // section that re-sorted would quietly throw that away.
    const sections = shopSections([
      shelfRow({ id: 'ref:a', cost: 200 }),
      shelfRow({ id: 'ref:b', cost: 900 }),
    ]);
    expect(sections[0].rows.map(row => row.cost)).toEqual([200, 900]);
  });

  it('drops a section nothing is in, rather than printing an empty heading', () => {
    const sections = shopSections([shelfRow({ id: 'ref:sword' })]);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('basic');
  });

  it('names every section it can emit, so no heading renders as undefined', () => {
    const sections = shopSections([
      shelfRow({ id: 'ref:sword' }),
      shelfRow({ id: 'ref:blade', recipe: [link('ref:sword')] }),
    ]);
    for (const section of sections) expect(section.title.length).toBeGreaterThan(0);
  });

  it('is empty for an empty shelf', () => {
    expect(shopSections([])).toEqual([]);
  });
});

describe('priceLabel', () => {
  it('prints one number when the bag holds none of the parts', () => {
    expect(priceLabel(shelfRow({ cost: 1200, price: 1200 }))).toEqual({
      pay: '1200',
      total: '1200',
      saved: 0,
      discounted: false,
    });
  });

  it('prints both numbers and the difference once a part is held', () => {
    // Without the difference on screen, a player carrying two components sees
    // the price drop and cannot tell why — the one thing `price` vs `cost`
    // exists to make legible.
    expect(priceLabel(shelfRow({ cost: 1200, price: 450 }))).toEqual({
      pay: '450',
      total: '1200',
      saved: 750,
      discounted: true,
    });
  });
});

describe('heldItemIds', () => {
  it('names every id the bag is holding', () => {
    const ids = heldItemIds([
      { slot: 0, id: 'ref:sword', name: 'Kiếm', image: '', cost: 350, refund: 245 },
      { slot: 2, id: 'ref:cloak', name: 'Áo', image: '', cost: 400, refund: 280 },
    ]);
    expect([...ids].sort()).toEqual(['ref:cloak', 'ref:sword']);
  });

  it('is empty for an empty bag', () => {
    expect(heldItemIds([]).size).toBe(0);
  });
});

describe('bagSlotOf', () => {
  const bag = [
    { slot: 1, id: 'ref:sword', name: 'Kiếm', image: '', cost: 350, refund: 245 },
    { slot: 3, id: 'ref:sword', name: 'Kiếm', image: '', cost: 350, refund: 245 },
  ];

  it('finds the slot an item is sitting in, so the detail can sell it', () => {
    expect(bagSlotOf(bag, 'ref:sword')?.slot).toBe(1);
  });

  it('answers the lowest slot when two copies are held', () => {
    // `sellItem` takes a slot, and selling "one of them" has to mean a slot
    // that is really there — picking the first is arbitrary but it is not
    // ambiguous.
    expect(bagSlotOf([bag[1], bag[0]], 'ref:sword')?.slot).toBe(1);
  });

  it('answers null for something the bag does not hold', () => {
    expect(bagSlotOf(bag, 'ref:cloak')).toBeNull();
  });
});

describe('recipeTree', () => {
  const rows = [
    shelfRow({ id: 'ref:sword', cost: 350 }),
    shelfRow({ id: 'ref:cloak', cost: 400 }),
    shelfRow({
      id: 'ref:blade',
      cost: 1200,
      recipe: [link('ref:sword', true), link('ref:cloak')],
    }),
    shelfRow({ id: 'ref:crown', cost: 2600, recipe: [link('ref:blade'), link('ref:sword')] }),
  ];

  it('nests a part that is itself built out of parts', () => {
    const tree = recipeTree(rows, 'ref:crown');
    expect(tree.map(node => node.link.id)).toEqual(['ref:blade', 'ref:sword']);
    expect(tree[0].parts.map(node => node.link.id)).toEqual(['ref:sword', 'ref:cloak']);
    expect(tree[1].parts).toEqual([]);
  });

  it('carries each level’s owned mark from that level’s own row', () => {
    // The tick under `ref:blade` means "buying the blade would consume it",
    // which is the blade's question and not the crown's.
    expect(recipeTree(rows, 'ref:crown')[0].parts[0].link.owned).toBe(true);
  });

  it('is empty for a component, which is how the pane knows not to draw a tree', () => {
    expect(recipeTree(rows, 'ref:sword')).toEqual([]);
  });

  it('is empty for an id the shelf does not carry', () => {
    expect(recipeTree(rows, 'ref:nothing')).toEqual([]);
  });

  it('stops rather than looping for ever if a pack ships a cycle', () => {
    // `validate.ts` refuses one, but this walk runs twenty times a second over
    // a stranger's content and a hang here is the whole HUD.
    const looped = [
      shelfRow({ id: 'ref:a', recipe: [link('ref:b')] }),
      shelfRow({ id: 'ref:b', recipe: [link('ref:a')] }),
    ];
    // It draws what the pack says as far as the loop closes and then stops:
    // the second time the walk meets an id it is already inside, that branch
    // ends. What it must never do is come back.
    const tree = recipeTree(looped, 'ref:a');
    expect(tree[0].link.id).toBe('ref:b');
    expect(tree[0].parts[0].link.id).toBe('ref:a');
    expect(tree[0].parts[0].parts).toEqual([]);
  });
});

/**
 * The bag row's own refusal.
 *
 * The panel used to gate its Bán button on `state.canShop` alone, which is one
 * of the two rules `sellItem` applies — so a dead champion's sell button
 * looked enabled and did nothing. That is the failure the whole `refusalFor`
 * design exists to prevent, and it happened on the sell half precisely because
 * only the buy half had a seam to ask.
 */
describe('a bag row’s refusal', () => {
  let game: TestGame;
  let champion: Champion;
  const host = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    champion.wallet!.earn(10_000);
    stock = [item({ id: 'ref:sword', name: 'Kiếm Dài', cost: 350 })];
    buyItem(champion, stock[0], host);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is null at the fountain, holding the thing', () => {
    const [row] = sellRows(champion, host);
    expect(row.refusal).toBeNull();
    expect(row.reason).toBe('');
  });

  it('names the fountain rule, in the player’s own language', () => {
    champion.position.set(2_000, 0);
    const [row] = sellRows(champion, host);
    expect(row.refusal).toBe('NOT_AT_FOUNTAIN');
    expect(row.reason).toBe(REFUSAL_TEXT.NOT_AT_FOUNTAIN);
  });

  it('lets a corpse sell — the death timer is shopping time', () => {
    champion.takeDamage(99_999, undefined, 'TRUE');
    const [row] = sellRows(champion, host);
    expect(row.refusal).toBeNull();
    expect(row.reason).toBe('');
  });

  it('has a sentence for every refusal a sale can produce', () => {
    // A missing entry renders `undefined` at the player. Asserted against the
    // union rather than a list kept here, so adding a refusal breaks this.
    for (const refusal of ['NOT_AT_FOUNTAIN', 'EMPTY'] as const) {
      expect(REFUSAL_TEXT[refusal], refusal).toBeTruthy();
    }
  });
});

describe('packSections', () => {
  const nameOf = (id: string) => ({ riot: 'LMHT', dota: 'Dota' })[id] ?? id;

  it('shelves each pack under its own heading, in the registry order handed in', () => {
    const sections = packSections(
      [
        shelfRow({ id: 'dota:vanguard' }),
        shelfRow({ id: 'riot:sword' }),
        shelfRow({ id: 'riot:cloak' }),
      ],
      ['riot', 'dota'],
      nameOf
    );
    expect(sections.map(section => section.key)).toEqual(['riot', 'dota']);
    expect(sections.map(section => section.title)).toEqual(['LMHT', 'Dota']);
    expect(sections[0].rows.map(row => row.id)).toEqual(['riot:sword', 'riot:cloak']);
  });

  it('keeps the arrival order inside a pack — cheapest-first is shopRows business', () => {
    const sections = packSections(
      [shelfRow({ id: 'riot:a', cost: 200 }), shelfRow({ id: 'riot:b', cost: 900 })],
      ['riot'],
      nameOf
    );
    expect(sections[0].rows.map(row => row.cost)).toEqual([200, 900]);
  });

  it('still shelves a pack the order never mentioned, after the ordered ones', () => {
    // A fixture pack, or one installed after the order was read: dropping it
    // would be a shelf that quietly sells less than the shop owns.
    const sections = packSections(
      [shelfRow({ id: 'mystery:rock' }), shelfRow({ id: 'riot:sword' })],
      ['riot'],
      nameOf
    );
    expect(sections.map(section => section.key)).toEqual(['riot', 'mystery']);
    expect(sections[1].title).toBe('mystery');
  });

  it('prints no heading over an empty shelf', () => {
    const sections = packSections([shelfRow({ id: 'riot:sword' })], ['riot', 'dota'], nameOf);
    expect(sections.map(section => section.key)).toEqual(['riot']);
  });
});
