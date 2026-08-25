/**
 * The shop, reached the only way a phone can reach it.
 *
 * Every other door is desktop-only: the gold pill and the six inventory tiles
 * live in `DesktopHudView`, which a phone does not render, and `P` is not a key
 * a thumb can press. So the corner button in `InGameHUD.vue` is not a
 * convenience — without it the shop is unreachable on the device this game is
 * most played on, and nothing in a unit test can see that.
 *
 * The gesture is a real CDP touch, not a click: `GameScene` calls
 * `preventDefault()` on every touch on the page, so the browser synthesises no
 * trailing `click` and a `@click`-only control is dead under a thumb while
 * being perfect under a mouse. That failure has shipped here three times.
 *
 * It is also the only place the panel's **compact layout** exists. A phone is
 * landscape and short (844x390), so the grid and the detail pane cannot both
 * hold their full size — they take turns instead, switched by a media query on
 * viewport height that a desktop run never crosses. Which half is on screen,
 * and whether there is a way back from the other, is therefore invisible to
 * every other test in this repository.
 *
 *   node tests/e2e/drive-shop-touch.mjs /tmp/shoptouch
 */
import { startHarness, PHONE_VIEWPORT } from './harness.mjs';
import { PROBE_ITEMS, seedShopProbePack } from './shopProbePack.mjs';

const OUT = process.argv[2] ?? '/tmp/shoptouch';
const h = await startHarness({
  out: OUT,
  viewport: PHONE_VIEWPORT,
  hasTouch: true,
  touch: true,
  deviceScaleFactor: 3,
});
const { page, check, report, guard, tap } = h;

await guard(async () => {
  await page.goto(h.url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  const bar = await page.locator('.bottom-HUD').count();
  check('no desktop strip on a phone', bar === 0, `${bar} strips`);

  const btn = page.locator('.shop-btn');
  check('the shop button is there', (await btn.count()) === 1, `${await btn.count()} buttons`);
  const lit = await page.locator('.shop-btn.at-shop').count();
  report.litAtFountain = lit;
  check('and it is lit at the fountain', lit === 1, `${lit} lit`);

  const box = await btn.boundingBox();
  report.buttonBox = box && {
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.width),
    h: Math.round(box.height),
  };
  // A thumb needs a real target. 40px is the CSS size; anything smaller here
  // would mean the rule that sets it is not the rule that won.
  check(
    'big enough for a thumb',
    box && box.width >= 38 && box.height >= 38,
    JSON.stringify(report.buttonBox)
  );

  await tap(box.x + box.width / 2, box.y + box.height / 2, 80);
  await page.waitForTimeout(400);
  const panel = await page.locator('.shop-panel').count();
  check('a tap opens the shop', panel === 1, `${panel} panels`);

  const panelBox = await page.locator('.shop-panel').boundingBox();
  report.panelBox = panelBox && {
    w: Math.round(panelBox.width),
    h: Math.round(panelBox.height),
    right: Math.round(panelBox.x + panelBox.width),
  };
  check(
    'the panel fits the viewport',
    panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= PHONE_VIEWPORT.width + 1,
    JSON.stringify(report.panelBox)
  );
  check(
    'and does not run off the bottom',
    panelBox && panelBox.y >= 0 && panelBox.y + panelBox.height <= PHONE_VIEWPORT.height + 1,
    JSON.stringify(report.panelBox)
  );

  // ------------------------------------------------ the compact layout
  //
  // Core sells nothing on its own, so the shelf is seeded the way a runtime
  // pack install seeds it. See `shopProbePack.mjs`.
  await seedShopProbePack(page);
  await page.waitForTimeout(350);

  const shelfAlone = await page.locator('.shop-shelf').isVisible();
  const paneAtRest = await page.locator('.shop-detail').isVisible();
  report.compactAtRest = { shelfAlone, paneAtRest };
  check(
    'the grid has the whole panel to itself',
    shelfAlone && !paneAtRest,
    `shelf=${shelfAlone} pane=${paneAtRest}`
  );

  const tile = page.locator(`.shop-tile[title="${PROBE_ITEMS.cloak.name}"]`);
  await tile.scrollIntoViewIfNeeded();
  const tileBox = await tile.boundingBox();
  report.tileBox = tileBox && { w: Math.round(tileBox.width), h: Math.round(tileBox.height) };
  check(
    'a tile is a real target for a thumb',
    tileBox && tileBox.width >= 34 && tileBox.height >= 34,
    JSON.stringify(report.tileBox)
  );

  await tap(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, 80);
  await page.waitForTimeout(400);

  const shelfAfter = await page.locator('.shop-shelf').isVisible();
  const paneAfter = await page.locator('.shop-detail').isVisible();
  const paneName = (await page.locator('.shop-detail-head h4').textContent())?.trim();
  report.compactPicked = { shelfAfter, paneAfter, paneName };
  check(
    'a tap swaps the pane in over the grid',
    paneAfter && !shelfAfter,
    `shelf=${shelfAfter} pane=${paneAfter}`
  );
  check(
    'and the pane is the item that was tapped',
    paneName === PROBE_ITEMS.cloak.name,
    `"${paneName}"`
  );

  // The pane is the taller half — a panel that fitted with the grid showing
  // and overflowed with the pane showing is a phone bug nobody would see from
  // a desktop run.
  const openBox = await page.locator('.shop-panel').boundingBox();
  report.panelBoxWithPane = openBox && {
    w: Math.round(openBox.width),
    h: Math.round(openBox.height),
  };
  check(
    'the panel still fits with the pane open',
    openBox && openBox.y >= 0 && openBox.y + openBox.height <= PHONE_VIEWPORT.height + 1,
    JSON.stringify(report.panelBoxWithPane)
  );

  // The only exit from the pane on this layout. Without it the grid is gone
  // for good and the panel is a dead end.
  const backBox = await page.locator('.shop-detail-back').boundingBox();
  report.backBox = backBox && { w: Math.round(backBox.width), h: Math.round(backBox.height) };
  check(
    'the way back is thumb-sized',
    backBox && backBox.height >= 30,
    JSON.stringify(report.backBox)
  );

  await tap(backBox.x + backBox.width / 2, backBox.y + backBox.height / 2, 80);
  await page.waitForTimeout(400);
  const shelfBack = await page.locator('.shop-shelf').isVisible();
  const paneBack = await page.locator('.shop-detail').isVisible();
  check('and it puts the grid back', shelfBack && !paneBack, `shelf=${shelfBack} pane=${paneBack}`);

  // ------------------------------------------------ buying under a thumb
  await tile.scrollIntoViewIfNeeded();
  const tileAgain = await tile.boundingBox();
  await tap(tileAgain.x + tileAgain.width / 2, tileAgain.y + tileAgain.height / 2, 80);
  await page.waitForTimeout(400);

  const buyBox = await page.locator('.shop-buy').boundingBox();
  report.buyBox = buyBox && { w: Math.round(buyBox.width), h: Math.round(buyBox.height) };
  check(
    'the buy button is thumb-sized',
    buyBox && buyBox.height >= 36,
    JSON.stringify(report.buyBox)
  );

  const heldBefore = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.items.filter(Boolean).length
  );
  await tap(buyBox.x + buyBox.width / 2, buyBox.y + buyBox.height / 2, 80);
  await page.waitForTimeout(400);
  const bought = await page.evaluate(() => {
    const player = window.__lol2d.scene.oScene.game.player;
    return {
      held: player.items.filter(Boolean).length,
      name: player.items.find(Boolean)?.def.name,
    };
  });
  report.touchPurchase = { heldBefore, ...bought };
  check(
    'a tap on it really buys',
    bought.held === heldBefore + 1 && bought.name === PROBE_ITEMS.cloak.name,
    JSON.stringify(report.touchPurchase)
  );

  // The bag strip lives outside the half that swaps, so it is on screen
  // whichever of the two has the space.
  const bagSlots = await page.locator('.shop-bag-slot').count();
  const bagFilled = await page.locator('.shop-bag-slot.filled').count();
  report.bag = { bagSlots, bagFilled };
  check('the bag strip stays on screen either way', bagSlots === 6, `${bagSlots} slots`);
  check('and shows what was just bought', bagFilled === 1, `${bagFilled} filled`);

  await page.screenshot({ path: `${OUT}-phone.png` });

  // ------------------------------------------------ the item actives' grid
  //
  // The whole point of an active item is that it is an extra spell, and on a
  // phone it was bound to the digits 1-6 — keys a thumb does not have. So the
  // grid has to draw, and a tap on it has to reach the *inventory's* input
  // controller and not the kit's.
  await page.evaluate(() => window.__lol2d.scene.oScene.game.inGameHUD.vueInstance.hud.closeShop());
  await page.waitForTimeout(300);

  const drawn = await page.evaluate(async () => {
    const { HeldItem } = await import('/src/game/items/Item.ts');
    const { packAsset } = await import('/src/game/config/packAsset.ts');
    const game = window.__lol2d.scene.oScene.game;
    const kitSpell = game.player.spells[2];
    const def = { id: 'probe:blade', name: 'Gươm Thử', icon: 'spell_basic_attack', cost: 0 };
    // The champion's own W, worn as an item active: a real `Spell` with a real
    // icon, so the button has something to draw and something to press.
    const active = new kitSpell.constructor(game.player);
    game.player.equipItem(new HeldItem(def, null, active, packAsset(def.icon)), 0);

    const controls = game.touchControls;
    const layout = controls.currentLayout;
    return {
      positions: layout.items.length,
      slot0: {
        x: Math.round(layout.items[0].x),
        y: Math.round(layout.items[0].y),
        r: Math.round(layout.items[0].radius),
      },
      viewForFilled: !!controls.host?.spellView?.(0, 'item'),
    };
  });
  report.itemPositions = drawn.positions;
  report.itemSlot0 = drawn.slot0;
  check('six item positions exist', drawn.positions === 6, `${drawn.positions}`);

  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}-items.png` });

  // A real touch on slot 0 must reach the item controller. The kit spell in
  // slot 2 is the *same class*, so pressing the wrong row would look identical
  // in a screenshot — this checks the instance the item is holding.
  const before = await page.evaluate(
    () => window.__lol2d.scene.oScene.game.player.items[0].active.state
  );
  await tap(drawn.slot0.x, drawn.slot0.y, 80);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    item: window.__lol2d.scene.oScene.game.player.items[0].active.state,
    kit: window.__lol2d.scene.oScene.game.player.spells[2].state,
  }));
  report.itemPress = { before, after };
  check('a tap fires the item’s own spell', after.item !== before, `${before} -> ${after.item}`);
  check(
    'and leaves the kit slot of the same index alone',
    after.kit === 'READY',
    `kit slot 2 is ${after.kit}`
  );

  check('no runtime errors', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
});
