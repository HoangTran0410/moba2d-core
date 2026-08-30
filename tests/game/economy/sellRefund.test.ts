import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ECONOMY, resolveEconomy } from '@/game/config/mapTuning';
import {
  SELL_REFUND_FRACTION,
  refundFractionOf,
  sellItem,
  sellValueOf,
  type ShopHost,
} from '@/game/economy/ItemShop';
import { sellRows } from '@/game/hud/shop/shopState';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';
import { PackRegistry } from '@/content/PackRegistry';
import { resetContentRegistryForTests } from '@/content/registry';
import { buyItem } from '@/game/economy/ItemShop';

/**
 * What a sale pays back, and why it is the map's to set.
 *
 * This was left out of `EconomyTuning` for a while on the argument that the
 * shop *panel* prints the refund as well as the shop paying it, and the panel
 * is HUD code with no map in scope. The argument was wrong, and the shape of
 * being wrong is worth a test: **both readers already take a `ShopHost`** —
 * `sellItem`, which pays, and `sellRows`, which prints — and a host is the
 * object that already crosses from the match into both. The fraction rides it.
 *
 * So the two cases that matter are that the sale and the panel agree, and that
 * they agree *on the map's number*. A half-done version, where the panel
 * quotes a refund the shop does not pay, is the failure the original caution
 * was actually about.
 */

vi.mock('@/game/economy/itemCatalog', async () => {
  const actual = await vi.importActual<typeof import('@/game/economy/itemCatalog')>(
    '@/game/economy/itemCatalog'
  );
  return { ...actual, shopItems: () => stock };
});

let stock: unknown[] = [];

/** What a pack declares: a bare local id, keyed by the same string. */
const DEF = {
  id: 'blade',
  name: 'Kiếm',
  icon: 'spell_basic_attack',
  cost: 1_000,
  stats: { attackDamage: 10 },
};

/** What the registry hands back — the same item, qualified. */
const ITEM = { ...DEF, id: 'ref:blade', packId: 'ref' };

describe('resolving the fraction', () => {
  it('is core’s 0.7 when a map says nothing', () => {
    expect(DEFAULT_ECONOMY.sellRefund).toBe(SELL_REFUND_FRACTION);
    expect(resolveEconomy(undefined).sellRefund).toBe(0.7);
  });

  it('takes the map’s number', () => {
    expect(resolveEconomy({ economy: { sellRefund: 1 } }).sellRefund).toBe(1);
    expect(resolveEconomy({ economy: { sellRefund: 0 } }).sellRefund).toBe(0);
  });

  it('refuses a refund above the price, which would be a money printer', () => {
    // Buy, sell, repeat: a match decided by whoever clicks fastest. The one
    // economy number with a ceiling as well as a floor.
    expect(resolveEconomy({ economy: { sellRefund: 3 } }).sellRefund).toBe(1);
    expect(resolveEconomy({ economy: { sellRefund: -1 } }).sellRefund).toBe(0);
  });
});

describe('reading it off a host', () => {
  it('falls back to core’s fraction for a host built without one', () => {
    // A test double, the LAN client and `AIChampion`'s shopping context all
    // build this shape by hand.
    const host = { fountains: [] } as ShopHost;
    expect(refundFractionOf(host)).toBe(SELL_REFUND_FRACTION);
  });

  it('uses the host’s number when it has one, zero included', () => {
    expect(refundFractionOf({ fountains: [], sellRefund: 0.5 })).toBe(0.5);
    // `0` is a real setting — "a purchase is final" — and must not read as
    // absent.
    expect(refundFractionOf({ fountains: [], sellRefund: 0 })).toBe(0);
  });
});

describe('the sale and the panel, on a map that changed it', () => {
  let game: TestGame;
  let champion: Champion;

  beforeEach(async () => {
    stubGameGlobals();
    resetContentRegistryForTests();
    const registry = new PackRegistry();
    registry.installData({
      manifest: { id: 'ref', version: '1.0.0', coreRange: '*' },
      items: { blade: DEF },
    } as never);
    stock = [ITEM];

    game = createGame();
    champion = new Champion({ game, teamId: 'blue' });
    game.setPlayer(champion);
    champion.wallet?.earn(10_000);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** In the fountain, so the shop will actually trade. */
  const host = (sellRefund?: number): ShopHost => ({
    fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 500 }],
    sellRefund,
  });

  it('pays core’s fraction when the map says nothing', () => {
    expect(buyItem(champion, ITEM as never, host(), 'PLAYER')).toBe(true);
    const before = champion.wallet!.balance;

    expect(sellItem(champion, 0, host(), 'PLAYER')).toBe(700);
    expect(champion.wallet!.balance).toBe(before + 700);
  });

  it('pays the map’s fraction, and the panel quotes the same number', () => {
    // The two halves the original caution was about. They are computed from
    // the same host, through the same function, so they cannot disagree.
    expect(buyItem(champion, ITEM as never, host(1), 'PLAYER')).toBe(true);

    const [row] = sellRows(champion, host(1), 'PLAYER');
    expect(row.refund).toBe(1_000);
    expect(sellItem(champion, 0, host(1), 'PLAYER')).toBe(1_000);
  });

  it('pays nothing on a map where a purchase is final', () => {
    expect(buyItem(champion, ITEM as never, host(0), 'PLAYER')).toBe(true);
    const before = champion.wallet!.balance;

    const [row] = sellRows(champion, host(0), 'PLAYER');
    expect(row.refund).toBe(0);
    expect(sellItem(champion, 0, host(0), 'PLAYER')).toBe(0);
    expect(champion.wallet!.balance).toBe(before);
    expect(champion.items?.[0], 'the item was still handed over').toBeFalsy();
  });
});

describe('the arithmetic that was already there', () => {
  it('still snaps the float, at every fraction', () => {
    // `350 * 0.7` is `244.99999999999997`, so a bare `Math.floor` pays 244 for
    // a refund that is exactly 245. The snap has to survive the fraction
    // becoming a variable.
    expect(sellValueOf({ cost: 350 } as never)).toBe(245);
    expect(sellValueOf({ cost: 350 } as never, 0.7)).toBe(245);
  });
});
