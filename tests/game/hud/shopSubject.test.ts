import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { createHudInteractions } from '@/game/hud/hudInteractions';
import { contentCatalog } from '@/content/catalog';
import { resetContentRegistryForTests } from '@/content/registry';

/**
 * **The shop has a subject, and the player is only its default.**
 *
 * The practice panel's roster can open the shop aimed at any champion in the
 * match, so an owner can build a bot a kit without playing it. The generalising
 * move is the whole feature: before it, `shopStock`, `shopBag`, `buy` and
 * `sell` each read `game.player` for themselves, so "the shop" and "the
 * player's shop" were the same sentence in four places.
 *
 * What that has to buy, and what these cases pin:
 *
 *   - the panel shows **that champion's** gold, not the player's;
 *   - a purchase spends **that champion's** wallet into **that champion's**
 *     bag;
 *   - and the subject is a **live lookup by id**, never a captured reference —
 *     a bot removed from the roster mid-shop would otherwise leave the panel
 *     spending into an object nothing else can see.
 */
const item = (id: string, cost: number) => ({ id, name: id, icon: 'no_such_key', cost });

describe('the shop’s subject', () => {
  let game: TestGame;
  let player: Champion;
  let bot: Champion;
  let hud: ReturnType<typeof createHudInteractions>;
  let packId: string;

  beforeEach(() => {
    stubGameGlobals();
    resetContentRegistryForTests();
    game = createGame();
    player = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    bot = new Champion({ game, position: createVector(9_000, 9_000), teamId: 'red' });
    bot.name = 'Blitzcrank';
    game.setPlayer(player);
    indexObjects(game, [player, bot]);
    player.wallet!.earn(1_000);
    bot.wallet!.earn(5_000);

    packId = `probe${Math.random().toString(36).slice(2, 8)}`;
    contentCatalog().installData({
      manifest: { id: packId, version: '1.0.0', coreRange: '*' },
      items: { boots: item('boots', 300) },
    } as never);

    (game as never as { fountains: unknown[] }).fountains = [];
    (game as never as { director: unknown }).director = {
      roster: () => [
        { unit: player, isPlayer: true },
        { unit: bot, isPlayer: false },
      ],
    };
    hud = createHudInteractions(game as never);
  });

  afterEach(() => {
    resetContentRegistryForTests();
    vi.unstubAllGlobals();
  });

  it('is the player when the shop is opened from the HUD', () => {
    hud.openShop();
    expect(hud.shopGold()).toBe(player.wallet!.balance);
  });

  it('becomes the named unit when the roster opens it', () => {
    hud.openShopFor(bot.id);
    expect(hud.showShop).toBe(true);
    expect(hud.shopGold()).toBe(bot.wallet!.balance);
  });

  it('names whose shop it is, so nobody spends the wrong wallet by accident', () => {
    hud.openShopFor(bot.id);
    expect(hud.shopSubjectName()).toBe('Blitzcrank');

    hud.openShop();
    expect(hud.shopSubjectName(), 'the player’s own shop should not be labelled').toBe('');
  });

  it('labels a nameless champion rather than leaving a cheat shop unmarked', () => {
    bot.name = '';
    hud.openShopFor(bot.id);
    expect(hud.shopSubjectName()).toBe('Không tên');
  });

  it('spends the subject’s gold into the subject’s bag', () => {
    const playerGold = player.wallet!.balance;
    const botGold = bot.wallet!.balance;

    hud.openShopFor(bot.id);
    hud.buy(`${packId}:boots`);

    expect(bot.wallet!.balance, 'the bot did not pay').toBe(botGold - 300);
    expect(player.wallet!.balance, 'the player paid for the bot’s item').toBe(playerGold);
    expect(bot.items.filter(Boolean)).toHaveLength(1);
    expect(player.items.filter(Boolean)).toHaveLength(0);
  });

  it('buys out in the lane, which the player’s own shop would refuse', () => {
    // The bot is 9000px from any fountain — and there are none at all in this
    // fixture. The player's shop is unusable there by design; the roster's is
    // the whole point.
    hud.openShopFor(bot.id);
    expect(hud.shopStock().every(row => row.refusal === null)).toBe(true);

    hud.openShop();
    expect(hud.shopStock().every(row => row.refusal === 'NOT_AT_FOUNTAIN')).toBe(true);
  });

  it('shows the subject’s bag, not the player’s', () => {
    hud.openShopFor(bot.id);
    hud.buy(`${packId}:boots`);
    expect(hud.shopBag().map(row => row.slot)).toEqual([0]);

    hud.openShop();
    expect(hud.shopBag()).toEqual([]);
  });

  it('sells out of the subject’s bag and pays the subject', () => {
    hud.openShopFor(bot.id);
    hud.buy(`${packId}:boots`);
    const after = bot.wallet!.balance;

    hud.sell(0);

    expect(bot.wallet!.balance).toBeGreaterThan(after);
    expect(bot.items.filter(Boolean)).toHaveLength(0);
  });

  it('goes back to the player when the shop closes', () => {
    // Otherwise the next press of the corner button silently opens a bot's
    // shop, and the only sign is a gold figure the player has to notice.
    hud.openShopFor(bot.id);
    hud.closeShop();
    hud.openShop();
    expect(hud.shopGold()).toBe(player.wallet!.balance);
  });

  it('closes rather than guessing when the subject leaves the roster', () => {
    hud.openShopFor(bot.id);
    (game as never as { director: { roster: () => unknown[] } }).director.roster = () => [
      { unit: player, isPlayer: true },
    ];

    // Read the way the panel reads it, on its next repaint.
    expect(hud.shopStock()).toEqual([]);
    expect(hud.showShop, 'a shop left open over a unit that is gone').toBe(false);
  });

  it('refuses to open for an id nobody has', () => {
    hud.openShopFor('nobody');
    expect(hud.showShop).toBe(false);
  });
});
