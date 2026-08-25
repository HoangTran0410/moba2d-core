/**
 * The four HUD additions, in a real browser: the inventory row, the gold pill,
 * the passive badge, the toggle badge — plus the shop panel opening over a
 * running match.
 *
 * None of this is reachable from Vitest. A Vue template that names a field the
 * state does not carry renders nothing and throws nothing; a p5 global
 * shadowed by a local fails only on a frame that may not be the one you are
 * looking at. Both have shipped here.
 *
 *   node drive-shop-hud.mjs /tmp/shop
 */
import { startHarness } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/shop';

const h = await startHarness({ out: OUT });
const { page, check, report, guard } = h;

await guard(async () => {
  await page.goto(h.url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // ---------------------------------------------------------------- gold
  const gold = await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    return { balance: game.player.wallet?.balance ?? null };
  });
  report.startingGold = gold.balance;
  check('the player has a wallet', gold.balance !== null, `balance ${gold.balance}`);
  // 500 plus whatever accrued while the match booted — not 500 on the nose, and
  // an assertion that said so would be asserting the boot took no time.
  check('it starts near 500', gold.balance >= 500 && gold.balance < 520, `got ${gold.balance}`);

  const pill = await page.locator('.gold-pill span').first().textContent();
  report.goldPill = pill;
  check('the pill prints the balance', pill?.trim() === String(gold.balance), `pill "${pill}"`);

  // Income accrues by the second, so the pill has to move on its own.
  await page.waitForTimeout(2_500);
  const later = Number((await page.locator('.gold-pill span').first().textContent())?.trim());
  report.goldAfter2500ms = later;
  check('income accrues', later > gold.balance, `${gold.balance} -> ${later}`);

  // ------------------------------------------------------------ inventory
  const slots = await page.locator('.item-slot').count();
  report.itemSlots = slots;
  check('six slots, always', slots === 6, `found ${slots}`);

  const filledBefore = await page.locator('.item-slot.filled').count();
  check('all empty to begin with', filledBefore === 0, `${filledBefore} filled`);

  // A real `HeldItem`, built the way the shop builds one, so the row is
  // rendering what a purchase would actually produce.
  await page.evaluate(async () => {
    const { HeldItem } = await import('/src/game/items/Item.ts');
    const { packAsset } = await import('/src/game/config/packAsset.ts');
    const game = window.__lol2d.scene.oScene.game;
    const def = {
      id: 'probe:boots',
      name: 'Giày Thử',
      icon: 'spell_basic_attack',
      cost: 300,
      description: 'đi nhanh hơn',
      stats: { speed: 0.4, armor: 25 },
    };
    game.player.equipItem(new HeldItem(def, null, null, packAsset(def.icon)), 0);
  });
  await page.waitForTimeout(300);

  const filledAfter = await page.locator('.item-slot.filled').count();
  report.filledAfterEquip = filledAfter;
  check('the slot fills', filledAfter === 1, `${filledAfter} filled`);

  const iconShown = await page.locator('.item-slot.filled img').count();
  check('and draws its icon', iconShown === 1, `${iconShown} images`);

  const armour = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.stats.armor.value
  );
  report.armourWithItem = armour;
  check('the item grants its stats', armour === 25, `armour ${armour}`);

  // ------------------------------------------------------------- passive
  const passiveBefore = await page.locator('.passive-badge').count();
  check('no passive badge without a passive', passiveBefore === 0, `${passiveBefore} badges`);

  // ------------------------------------------------------- toggle badge
  //
  // Core ships no TOGGLE spell of its own (Pudge W is the dota pack's), so the
  // one under test here is a real kit spell with its `castSpec.activation`
  // rewritten — which is exactly the field `hudState` reads.
  const toggleWired = await page.evaluate(() => {
    const spell = window.__lol2d.scene.oScene.game.player.spells[1];
    if (!spell) return false;
    const base = spell.castSpec;
    Object.defineProperty(spell, 'castSpec', {
      configurable: true,
      get: () => ({ ...base, activation: 'TOGGLE' }),
    });
    return spell.isToggle === true;
  });
  check('a toggle reports itself', toggleWired, 'isToggle stayed false');
  await page.waitForTimeout(200);

  // A short timeout on purpose: a missing badge is the failure this script is
  // for, and Playwright's 30s default turns "the markup is wrong" into half a
  // minute of nothing.
  const badgeText = async selector =>
    (await page.locator(selector).first().textContent({ timeout: 4_000 }))?.trim();

  const offBadge = await badgeText('.toggle-badge.off');
  report.toggleOff = offBadge;
  check('an off toggle says so', offBadge === 'TẮT', `badge "${offBadge}"`);

  await page.evaluate(() => {
    const spell = window.__lol2d.scene.oScene.game.player.spells[1];
    spell.state = 'ACTIVE';
  });
  await page.waitForTimeout(200);
  const onBadge = await badgeText('.toggle-badge.on');
  const litTile = await page.locator('.spell.sustaining').count();
  report.toggleOn = onBadge;
  report.litTiles = litTile;
  check('an on toggle says so', onBadge === 'BẬT', `badge "${onBadge}"`);
  check('and lights its tile', litTile === 1, `${litTile} lit`);

  await page.screenshot({
    path: `${OUT}-bar.png`,
    clip: { x: 300, y: 760, width: 680, height: 140 },
  });

  // ------------------------------------------------------------ the shop
  await page.evaluate(() => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.openShop());
  await page.waitForTimeout(400);

  const panel = await page.locator('.shop-panel').count();
  report.shopPanels = panel;
  check('the shop opens', panel === 1, `${panel} panels`);

  const paused = await page.evaluate(() => window.__lol2d.scene.oScene.game.paused === true);
  check('and does not pause the match', paused === false, `paused=${paused}`);

  const bagRows = await page.locator('.shop-sell').count();
  report.bagRows = bagRows;
  check('the bag lists what is held', bagRows === 1, `${bagRows} rows`);

  // Whatever the installed packs happen to sell — which is nothing at all if
  // core is running alone, and that state has to read as a sentence rather
  // than a blank panel.
  const cards = await page.locator('.shop-card').count();
  const empty = await page.locator('.shop-stock .shop-empty').count();
  report.shopCards = cards;
  check(
    'the shelf either has stock or says it has none',
    cards > 0 || empty === 1,
    `${cards} cards, ${empty} notices`
  );

  if (cards > 0) {
    // Cheapest first, so a browse reads as a build order.
    const costs = await page.locator('.shop-card-cost').allTextContents();
    const numbers = costs.map(text => Number(text.replace(/[^0-9]/g, '')));
    report.shopCosts = numbers;
    check(
      'stock is listed cheapest first',
      numbers.every((cost, i) => i === 0 || cost >= numbers[i - 1]),
      numbers.join(', ')
    );

    // A real purchase, through the real button. The gold has to come out and
    // the item has to arrive in the bag — a card that looks affordable and a
    // purchase that does nothing is the failure this whole panel is arranged
    // to prevent.
    const affordable = page.locator('.shop-card:not(.blocked)').first();
    const affordableCount = await page.locator('.shop-card:not(.blocked)').count();
    report.affordableCards = affordableCount;
    check('something is affordable at the fountain', affordableCount > 0, `${affordableCount}`);

    const goldBefore = await page.evaluate(
      () => window.__lol2d.scene.oScene.game.player.wallet.balance
    );
    const price = Number(
      (await affordable.locator('.shop-card-cost').textContent())?.replace(/[^0-9]/g, '')
    );
    await affordable.click();
    await page.waitForTimeout(300);

    const bought = await page.evaluate(() => {
      const player = window.__lol2d.scene.oScene.game.player;
      return {
        gold: player.wallet.balance,
        held: player.items.filter(Boolean).length,
      };
    });
    report.purchase = { goldBefore, price, ...bought };
    check(
      'buying takes the price and fills a slot',
      bought.gold <= goldBefore - price && bought.held === 2,
      JSON.stringify(report.purchase)
    );
  }

  await page.screenshot({
    path: `${OUT}-panel.png`,
    clip: { x: 840, y: 100, width: 440, height: 700 },
  });

  // Standing on the platform, so there is nothing to warn about yet.
  const warnedAtFountain = await page.locator('.shop-warning').count();
  check('no warning at the fountain', warnedAtFountain === 0, `${warnedAtFountain} warnings`);
  const sellableHere = await page.locator('.shop-sell.blocked').count();
  check('the bag is sellable here', sellableHere === 0, `${sellableHere} blocked`);

  // Walk off it, and the panel has to say *why* everything just greyed out —
  // an all-grey shelf with no sentence reads as "everything is too expensive".
  await page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    game.player.position.set(game.player.position.x + 4000, game.player.position.y);
  });
  await page.waitForTimeout(300);
  const warnedAway = await page.locator('.shop-warning').count();
  const sellRows = await page.locator('.shop-sell').count();
  const blockedAway = await page.locator('.shop-sell.blocked').count();
  const blockedCards = await page.locator('.shop-card.blocked').count();
  const totalCards = await page.locator('.shop-card').count();
  report.warningAwayFromFountain = warnedAway;
  report.awayFromFountain = { sellRows, blockedAway, blockedCards, totalCards };
  check('away from it, the panel says why', warnedAway === 1, `${warnedAway} warnings`);
  check(
    'and every row in the bag refuses',
    sellRows > 0 && blockedAway === sellRows,
    `${blockedAway} of ${sellRows} blocked`
  );
  check(
    'and nothing on the shelf can be bought',
    blockedCards === totalCards,
    `${blockedCards} of ${totalCards} blocked`
  );

  // Escape closes the shop and leaves the config panel shut.
  await page.evaluate(() => window.__lol2d.scene.oScene.game.escape());
  await page.waitForTimeout(300);
  const stillOpen = await page.locator('.shop-panel').count();
  const configOpen = await page.locator('.practice-panel').count();
  check('escape closes the shop', stillOpen === 0, `${stillOpen} panels`);
  check('and does not open the panel under it', configOpen === 0, `${configOpen} panels`);

  check('no runtime errors', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
});
