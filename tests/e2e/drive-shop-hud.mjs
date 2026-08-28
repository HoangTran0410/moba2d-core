/**
 * The four HUD additions, in a real browser: the inventory row, the gold pill,
 * the passive badge, the toggle badge — and then the shop panel itself, over a
 * running match, at a desktop viewport.
 *
 * None of this is reachable from Vitest. A Vue template that names a field the
 * state does not carry renders nothing and throws nothing; a p5 global
 * shadowed by a local fails only on a frame that may not be the one you are
 * looking at. Both have shipped here. And the shop's redesign turns on two
 * questions no unit test can even ask: whether several tiles end up on the
 * same row (a grid, rather than the column of full-width cards this replaces)
 * and whether a tile carries prose (it must not — that is the whole trade the
 * detail pane exists to make).
 *
 * Core sells nothing on its own, so the shelf is seeded through the same
 * `PackRegistry.installData` door a runtime pack install uses — see
 * `shopProbePack.mjs`, which explains why each of its five items is there.
 *
 *   node drive-shop-hud.mjs /tmp/shop
 */
import { startHarness, startMatch } from './harness.mjs';
import { PROBE_COSTS, PROBE_ITEMS, seedShopProbePack } from './shopProbePack.mjs';

const OUT = process.argv[2] ?? '/tmp/shop';

const h = await startHarness({ out: OUT });
const { page, check, report, guard } = h;

await guard(async () => {
  await page.goto(h.url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // ---------------------------------------------------------------- gold
  const gold = await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
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
    const game = window.__moba2d.scene.oScene.game;
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
    () => window.__moba2d.scene.oScene.game.player.stats.armor.value
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
    const spell = window.__moba2d.scene.oScene.game.player.spells[1];
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
    const spell = window.__moba2d.scene.oScene.game.player.spells[1];
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
  //
  // The panel is a grid of icon tiles with a detail pane beside it, and none
  // of that is reachable from Vitest: a Vue template naming a field the state
  // does not carry renders nothing and throws nothing, and whether two tiles
  // end up on the same row is a question only a real layout engine answers.
  //
  // The probe HeldItem above goes back out first. It was equipped straight
  // onto the champion rather than bought, so it is in the bag and *not* on the
  // shelf — which is a state the panel handles (the pane says nothing is
  // picked) but a poor thing to run every later check through.
  await page.evaluate(() => window.__moba2d.scene.oScene.game.player.unequipItem(0));
  await seedShopProbePack(page);
  await page.evaluate(() => window.__moba2d.scene.oScene.game.inGameHUD.vueInstance.hud.openShop());
  await page.waitForTimeout(400);

  const panel = await page.locator('.shop-panel').count();
  report.shopPanels = panel;
  check('the shop opens', panel === 1, `${panel} panels`);

  const paused = await page.evaluate(() => window.__moba2d.scene.oScene.game.paused === true);
  check('and does not pause the match', paused === false, `paused=${paused}`);

  // ----------------------------------------------------------- the grid
  //
  // "At least" and not a total: the probe shelf is *added to* whatever pack
  // this browser has installed, which on a machine that has fetched the
  // default pack is fourteen more items. See `shopProbePack.mjs`.
  const tiles = await page.locator('.shop-tile').count();
  report.tiles = tiles;
  check('every item on the shelf is a tile', tiles >= PROBE_COSTS.length, `${tiles} tiles`);

  const headings = await page.locator('.shop-section h4').allTextContents();
  report.sections = headings;
  check(
    'components and combines are two named shelves',
    headings.length === 2,
    headings.join(' / ')
  );

  // The claim the whole redesign rests on. A column of full-width cards passes
  // every other check on this page and fails this one.
  const boxes = await page.locator('.shop-tile').evaluateAll(nodes =>
    nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) };
    })
  );
  const perRow = boxes.filter(box => box.y === boxes[0].y).length;
  report.tilesInTopRow = perRow;
  report.tileWidth = boxes[0]?.w;
  check('the shelf is a grid, not a column', perRow >= 3, `${perRow} tiles share the top row`);
  check('and a tile is icon-sized', boxes[0].w <= 110, `${boxes[0].w}px wide`);

  // Cheapest first, so a browse reads as a build order. Asked *within* a
  // section: the two shelves are ordered independently, so a combine costing
  // 900 sitting after a component costing 1400 is correct and a check over the
  // whole grid would call it a regression.
  const numbersIn = async selector => {
    const texts = await page.locator(selector).allTextContents();
    return texts.map(text => Number(text.replace(/[^0-9]/g, '')));
  };
  const basicPrices = await numbersIn('.shop-section:first-child .shop-tile-price');
  const combinePrices = await numbersIn('.shop-section:last-child .shop-tile-price');
  report.shelfPrices = { basicPrices, combinePrices };
  const ascending = list => list.every((cost, i) => i === 0 || cost >= list[i - 1]);
  check(
    'each shelf is listed cheapest first',
    ascending(basicPrices) && ascending(combinePrices),
    `${basicPrices.join(',')} | ${combinePrices.join(',')}`
  );

  // A tile carries a price and nothing else — no name, no stat list, no
  // description, no refusal sentence. That is what makes a shelf of them
  // scannable, and it is the exact text the old card stacked vertically.
  const tileText = (
    await page.locator(`.shop-tile[title="${PROBE_ITEMS.sword.name}"]`).innerText()
  ).replace(/\s/g, '');
  report.probeTileText = tileText;
  check(
    'a tile prints its price and no prose',
    tileText === String(PROBE_ITEMS.sword.cost),
    `tile read "${tileText}"`
  );

  // ------------------------------------------------- picking is not buying
  await page.locator(`.shop-tile[title="${PROBE_ITEMS.wand.name}"]`).click();
  await page.waitForTimeout(250);

  const pickedName = (await page.locator('.shop-detail-head h4').textContent())?.trim();
  const pickedTiles = await page.locator('.shop-tile.picked').count();
  // Gold accrues by the second, so a balance comparison here would be timing
  // the boot rather than watching for a purchase. The bag is the honest
  // question: browsing must put nothing in it.
  const heldAfterPick = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.player.items.filter(Boolean).length
  );
  report.picked = { pickedName, pickedTiles, heldAfterPick };
  check(
    'a tile opens the detail pane',
    pickedName === PROBE_ITEMS.wand.name,
    `pane says "${pickedName}"`
  );
  check('and marks itself as the one being read', pickedTiles === 1, `${pickedTiles} marked`);
  // The old panel bought on a click anywhere on a card. Browsing must be free.
  check('and buys nothing', heldAfterPick === 0, `${heldAfterPick} items held`);

  // Everything the tile stopped carrying has to be *somewhere*.
  const paneText = await page.locator('.shop-detail-scroll').innerText();
  const statLines = await page.locator('.shop-detail-stats li').count();
  report.paneStats = statLines;
  check('the pane carries the description', paneText.includes('cầm cự'), paneText.slice(0, 60));
  check('and the stats', statLines === 1, `${statLines} stat lines`);

  // A component is worth reading precisely because of what it becomes.
  const intoChips = await page.locator('.shop-into-chip').allTextContents();
  report.buildsInto = intoChips.map(text => text.trim());
  check(
    'a component says what it builds into',
    intoChips.length === 1 && intoChips[0].includes(PROBE_ITEMS.crown.name),
    intoChips.join(' / ')
  );

  // ------------------------------------------------------- the build tree
  await page.locator(`.shop-tile[title="${PROBE_ITEMS.crown.name}"]`).click();
  await page.waitForTimeout(250);

  const treeNodes = await page.locator('.shop-tree-node').count();
  const nested = await page.locator('.shop-tree .shop-tree').count();
  const treeNames = await page.locator('.shop-tree-name').allTextContents();
  report.tree = { treeNodes, nested, treeNames };
  // Crown is blade + wand, and blade is sword + cloak. A one-level pane would
  // draw two nodes and no nesting, which is the state this replaces.
  check('the tree reaches past the first level', treeNodes === 4, `${treeNodes} nodes`);
  check('and draws the second level nested', nested === 1, `${nested} nested lists`);
  check(
    'naming each part',
    treeNames.join(',') ===
      [
        PROBE_ITEMS.blade.name,
        PROBE_ITEMS.sword.name,
        PROBE_ITEMS.cloak.name,
        PROBE_ITEMS.wand.name,
      ].join(','),
    treeNames.join(' / ')
  );

  // ---------------------------------------------------- buying is a button
  await page.locator(`.shop-tile[title="${PROBE_ITEMS.sword.name}"]`).click();
  await page.waitForTimeout(200);
  const goldBeforeBuy = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.player.wallet.balance
  );
  await page.locator('.shop-buy').click();
  await page.waitForTimeout(300);

  const afterBuy = await page.evaluate(() => {
    const player = window.__moba2d.scene.oScene.game.player;
    return { gold: player.wallet.balance, held: player.items.filter(Boolean).length };
  });
  // A window rather than an equality, for the same reason the gold pill above
  // is checked against a range: income accrues by the second, so the balance
  // after a purchase is the price taken out *and* whatever the click cost in
  // wall time put back. It must never be more than the price, and it must be
  // recognisably the price rather than nothing.
  const spent = goldBeforeBuy - afterBuy.gold;
  report.purchase = { goldBeforeBuy, spent, ...afterBuy };
  check(
    'the buy button takes the price and fills a slot',
    spent <= PROBE_ITEMS.sword.cost && spent > PROBE_ITEMS.sword.cost - 20 && afterBuy.held === 1,
    JSON.stringify(report.purchase)
  );

  // ------------------------------------------------------- price vs cost
  await page.locator(`.shop-tile[title="${PROBE_ITEMS.cloak.name}"]`).click();
  await page.waitForTimeout(200);
  await page.locator('.shop-buy').click();
  await page.waitForTimeout(300);

  await page.locator(`.shop-tile[title="${PROBE_ITEMS.blade.name}"]`).click();
  await page.waitForTimeout(250);

  const combinePrice = Number(
    (await page.locator('.shop-buy-price').textContent())?.replace(/[^0-9]/g, '')
  );
  const combineTotal = (await page.locator('.shop-buy-total').textContent())?.trim();
  const discountedTiles = await page.locator('.shop-tile-price.discounted').count();
  const heldParts = await page.locator('.shop-tree-node.held').count();
  const owed = PROBE_ITEMS.blade.cost - PROBE_ITEMS.sword.cost - PROBE_ITEMS.cloak.cost;
  report.combine = { combinePrice, combineTotal, discountedTiles, heldParts };
  check(
    'a combine bills only what is missing',
    combinePrice === owed,
    `asks ${combinePrice}, owes ${owed}`
  );
  // Without this line a player watching the number drop cannot tell why.
  check(
    'and says where the rest of the price went',
    (combineTotal ?? '').includes(String(PROBE_ITEMS.blade.cost)),
    `"${combineTotal}"`
  );
  check('the tile says so too', discountedTiles >= 1, `${discountedTiles} discounted tiles`);
  check('and the tree ticks the parts already held', heldParts === 2, `${heldParts} ticked`);

  // ------------------------------------------------------------- the bag
  const bagSlots = await page.locator('.shop-bag-slot').count();
  const bagFilled = await page.locator('.shop-bag-slot.filled').count();
  report.bag = { bagSlots, bagFilled };
  // Empty slots are drawn on purpose: `NO_SLOT` is a refusal worth seeing coming.
  check('the bag is the six slots it really is', bagSlots === 6, `${bagSlots} slots`);
  check('two of them full', bagFilled === 2, `${bagFilled} filled`);

  await page.locator('.shop-bag-slot.filled').first().click();
  await page.waitForTimeout(250);
  const bagPickName = (await page.locator('.shop-detail-head h4').textContent())?.trim();
  const sellButtons = await page.locator('.shop-sell').count();
  check(
    'a bag slot opens the same pane a tile does',
    bagPickName === PROBE_ITEMS.sword.name,
    `pane says "${bagPickName}"`
  );
  check('and that pane grows a sell button', sellButtons === 1, `${sellButtons} sell buttons`);

  const goldBeforeSell = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.player.wallet.balance
  );
  await page.locator('.shop-sell').click();
  await page.waitForTimeout(300);
  const afterSell = await page.evaluate(() => {
    const player = window.__moba2d.scene.oScene.game.player;
    return { gold: player.wallet.balance, held: player.items.filter(Boolean).length };
  });
  report.sale = { goldBeforeSell, ...afterSell };
  check(
    'selling pays back and empties the slot',
    afterSell.gold > goldBeforeSell && afterSell.held === 1,
    JSON.stringify(report.sale)
  );

  await page.screenshot({
    path: `${OUT}-panel.png`,
    clip: { x: 640, y: 110, width: 640, height: 680 },
  });

  // Standing on the platform, so there is nothing to warn about yet.
  const warnedAtFountain = await page.locator('.shop-warning').count();
  check('no warning at the fountain', warnedAtFountain === 0, `${warnedAtFountain} warnings`);
  const blockedHere = await page.locator('.shop-tile.blocked').count();
  check('and nothing on the shelf refuses', blockedHere === 0, `${blockedHere} blocked`);

  // Walk off it, and the panel has to say *why* everything just greyed out —
  // an all-grey shelf with no sentence reads as "everything is too expensive".
  await page.locator(`.shop-tile[title^="${PROBE_ITEMS.cloak.name}"]`).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    game.player.position.set(game.player.position.x + 4000, game.player.position.y);
  });
  await page.waitForTimeout(300);

  const warnedAway = await page.locator('.shop-warning').count();
  const blockedAway = await page.locator('.shop-tile.blocked').count();
  const totalTiles = await page.locator('.shop-tile').count();
  const blockedBuy = await page.locator('.shop-buy.blocked').count();
  const blockedSell = await page.locator('.shop-sell.blocked').count();
  const why = (await page.locator('.shop-buy-why').first().textContent())?.trim();
  report.awayFromFountain = { warnedAway, blockedAway, totalTiles, blockedBuy, blockedSell, why };
  check('away from it, the panel says why', warnedAway === 1, `${warnedAway} warnings`);
  check(
    'and nothing on the shelf can be bought',
    blockedAway === totalTiles,
    `${blockedAway} of ${totalTiles}`
  );
  check('the buy button refuses with it', blockedBuy === 1, `${blockedBuy} blocked`);
  check('so does the sell button', blockedSell === 1, `${blockedSell} blocked`);
  check('and the reason is the shop’s own sentence', why === 'Phải đứng ở bệ đá', `"${why}"`);

  // ------------------------------------------- a corpse shops on its timer
  //
  // The source game's rule: death satisfies the location check, so the
  // respawn counter is shopping time. `sellRefusalFor` is still the one seam
  // the Bán button reads — the assertion here is that death does not close
  // the shop the way it once did.
  await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    game.player.position.set(game.player.position.x - 4_000, game.player.position.y);
  });
  await page.waitForTimeout(300);
  const homeAgain = await page.locator('.shop-warning').count();
  const sellableAgain = await page.locator('.shop-sell.blocked').count();
  check('back on the platform the warning clears', homeAgain === 0, `${homeAgain} warnings`);
  check('and the sell button comes back', sellableAgain === 0, `${sellableAgain} blocked`);

  await page.evaluate(() => window.__moba2d.scene.oScene.game.player.takeDamage(99_999));
  await page.waitForTimeout(300);
  const deadAtFountain = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.player.isDead === true
  );
  const deadBlockedSell = await page.locator('.shop-sell.blocked').count();
  report.dead = { deadAtFountain, deadBlockedSell };
  check('the champion is really dead', deadAtFountain, `isDead=${deadAtFountain}`);
  check(
    'a corpse still sells — the death timer is shopping time',
    deadBlockedSell === 0,
    `${deadBlockedSell} blocked`
  );

  // Escape closes the shop and leaves the config panel shut.
  await page.evaluate(() => window.__moba2d.scene.oScene.game.escape());
  await page.waitForTimeout(300);
  const stillOpen = await page.locator('.shop-panel').count();
  const configOpen = await page.locator('.practice-panel').count();
  check('escape closes the shop', stillOpen === 0, `${stillOpen} panels`);
  check('and does not open the panel under it', configOpen === 0, `${configOpen} panels`);

  // ------------------------------------------- the roster's shop, and back
  // The one journey no unit test can see: the config panel is *unmounted*
  // while the shop is up, so whether a player comes back to where they were
  // depends on which state survived that unmount — which is a fact about
  // module scope, not about any function's return value.
  const drawers = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.practice-stat-toggle')].map(b =>
        b.getAttribute('aria-expanded')
      )
    );

  await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    for (const entry of game.director.roster()) if (!entry.isPlayer) entry.unit.wallet?.earn(5_000);
  });
  await page.evaluate(() => window.__moba2d.scene.oScene.game.escape());
  await page.waitForTimeout(500);
  await page.locator('.practice-stat-toggle').nth(1).click();
  await page.waitForTimeout(300);

  const drawersBefore = await drawers();
  report.drawersBefore = drawersBefore;
  check('a roster drawer is open', drawersBefore.includes('true'), drawersBefore.join(','));

  const rosterShop = page.locator('[id^="practice-cheat-shop-"]').first();
  check('the row offers a shop button', (await rosterShop.count()) > 0, 'button');
  await rosterShop.click();
  await page.waitForTimeout(600);

  const subject = (
    await page
      .locator('.shop-subject')
      .textContent()
      .catch(() => null)
  )?.trim();
  const subjectGold = Number((await page.locator('.shop-gold span').first().textContent())?.trim());
  // Read off the match rather than compared against a magnitude: an earlier
  // case in this driver hands the *player* gold too, so "the bigger number is
  // the bot's" is a coincidence of ordering, not the claim. The claim is whose
  // wallet the panel is reading.
  const wallets = await page.evaluate(name => {
    const game = window.__moba2d.scene.oScene.game;
    const roster = game.director.roster();
    return {
      subject: roster.find(entry => entry.unit.name === name)?.unit.wallet?.balance ?? null,
      player: game.player.wallet?.balance ?? null,
    };
  }, subject);
  report.rosterShop = { subject, subjectGold, wallets };
  check('the header names whose shop it is', !!subject, `"${subject}"`);
  check(
    'and it is not the player',
    wallets.subject !== null && wallets.subject !== wallets.player,
    JSON.stringify(wallets)
  );
  // Within a few coins: income accrues by the second, so the panel's figure and
  // a later read of the same wallet are never identical.
  check(
    'it shows the subject’s own gold',
    wallets.subject !== null && Math.abs(subjectGold - wallets.subject) < 30,
    `panel ${subjectGold}, wallet ${wallets.subject}, player ${wallets.player}`
  );
  check(
    'the config panel is out of the way, not stacked under it',
    (await page.locator('.practice-panel').count()) === 0,
    'panels'
  );
  check(
    'and the match runs while shopping, as it does for the player',
    await page.evaluate(() => !window.__moba2d.scene.oScene.game.paused),
    'paused'
  );

  await page.locator('.shop-close').click();
  await page.waitForTimeout(600);

  const cameBack = await page.locator('.practice-panel').count();
  check('closing it puts the panel back', cameBack === 1, `${cameBack} panels`);
  const drawersAfter = cameBack === 1 ? await drawers() : [];
  report.drawersAfter = drawersAfter;
  check(
    'with the same drawer still open',
    drawersAfter.join(',') === drawersBefore.join(','),
    `${drawersBefore.join(',')} -> ${drawersAfter.join(',')}`
  );

  check('no runtime errors', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
});
