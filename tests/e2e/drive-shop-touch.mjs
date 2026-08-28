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
import { startHarness, PHONE_VIEWPORT, startMatch } from './harness.mjs';
import { PROBE_ITEMS, seedShopProbePack } from './shopProbePack.mjs';

const OUT = process.argv[2] ?? '/tmp/shoptouch';
const h = await startHarness({
  out: OUT,
  viewport: PHONE_VIEWPORT,
  hasTouch: true,
  touch: true,
  deviceScaleFactor: 3,
});
const { page, check, report, guard, tap, touchStart, touchMove, touchEnd } = h;

await guard(async () => {
  await page.goto(h.url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
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
    () => window.__moba2d.scene.oScene.game.player.items.filter(Boolean).length
  );
  await tap(buyBox.x + buyBox.width / 2, buyBox.y + buyBox.height / 2, 80);
  await page.waitForTimeout(400);
  const bought = await page.evaluate(() => {
    const player = window.__moba2d.scene.oScene.game.player;
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

  // ------------------------------------------ dragging one slot onto another
  //
  // The reason this panel has a drag at all. The bar answers "which item sits
  // under which key" too, but only with a pointer: on a phone the item buttons
  // are drawn on the *canvas* by `TouchControls.drawItemButtons`, where a drag
  // already means "aim this item's spell" — the gesture is taken. So this
  // strip is the only place a phone player can rearrange a bag, which makes a
  // mouse-only proof of it worth nothing.
  //
  // Three things only a real browser under a real finger has, and all three
  // are what this section is for: pointer capture, which silently stops
  // `pointerenter` firing on anything the drag crosses; `touch-action`,
  // without which the browser claims the gesture as a scroll before the
  // second `pointermove`; and `elementFromPoint`, which is how the drop target
  // is found at all.

  // Back to the grid first, so a stray `'open'` out of the drag is visible as
  // the pane appearing rather than hidden by a pane that was already there.
  const backAgain = await page.locator('.shop-detail-back').boundingBox();
  await tap(backAgain.x + backAgain.width / 2, backAgain.y + backAgain.height / 2, 80);
  await page.waitForTimeout(300);

  // A second item, carrying a real active, in a slot that is not next to its
  // destination: a swap between neighbours would look right even if the drop
  // target were computed as "the slot the press started on, plus one".
  await page.evaluate(async () => {
    const { HeldItem } = await import('/src/game/items/Item.ts');
    const { packAsset } = await import('/src/game/config/packAsset.ts');
    const game = window.__moba2d.scene.oScene.game;
    // The champion's own W, worn as an item active: a real `Spell` with a real
    // icon, so the button has something to draw and something to press.
    const kitSpell = game.player.spells[2];
    const def = { id: 'probe:active', name: 'Gươm Thử', icon: 'spell_basic_attack', cost: 0 };
    const active = new kitSpell.constructor(game.player);
    game.player.equipItem(new HeldItem(def, null, active, packAsset(def.icon)), 1);
  });
  await page.waitForTimeout(300);

  const centreOf = async slot => {
    const box = await page.locator(`[data-shop-slot="${slot}"]`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
  };
  const source = await centreOf(1);
  const target = await centreOf(4);
  report.slotBox = { w: Math.round(source.w), h: Math.round(source.h) };
  check(
    'a bag slot is a real target for a thumb',
    source.w >= 34 && source.h >= 34,
    JSON.stringify(report.slotBox)
  );

  await touchStart([{ x: source.x, y: source.y }]);
  // Stepped, not teleported. One jump leaves the browser with a single
  // `pointermove`, and what happens to the stream *in between* is this
  // feature's whole failure mode.
  for (let step = 1; step <= 8; step++) {
    await touchMove([
      {
        x: source.x + ((target.x - source.x) * step) / 8,
        y: source.y + ((target.y - source.y) * step) / 8,
      },
    ]);
    await page.waitForTimeout(20);
  }

  const dropTargets = await page.locator('.shop-bag-slot.shop-drop-target').count();
  const liftedSlots = await page.locator('.shop-bag-slot.shop-lifted').count();
  const targetLit = await page.locator('[data-shop-slot="4"].shop-drop-target').count();
  report.midDrag = { dropTargets, liftedSlots, targetLit };
  check('the slot under the finger highlights mid-drag', targetLit === 1, `${dropTargets} lit`);
  check('and the one it came from shows as lifted', liftedSlots === 1, `${liftedSlots} lifted`);

  await touchEnd();
  await page.waitForTimeout(300);

  const afterDrag = await page.evaluate(() =>
    window.__moba2d.scene.oScene.game.player.items.map(held => held?.def.id ?? null)
  );
  report.afterDrag = afterDrag;
  check(
    'the item lands in the slot it was dropped on',
    afterDrag[4] === 'probe:active' && afterDrag[1] === null,
    afterDrag.join(',')
  );
  // A swap with an empty slot must leave everything else where it was.
  check('and nothing else moves', afterDrag[0] !== null, afterDrag.join(','));

  const paneAfterDrag = await page.locator('.shop-detail').isVisible();
  const cleared = await page.locator('.shop-drop-target, .shop-lifted').count();
  check('a drag is not a tap, so no pane opened', paneAfterDrag === false, `pane=${paneAfterDrag}`);
  check('and the highlight clears on release', cleared === 0, `${cleared} still marked`);

  // The other half of the same threshold: a press that never travels still
  // means "show me this one", which is how a phone reaches an item's detail —
  // and its Bán button, the only way to sell at all — from the bag.
  //
  // Slot 0 and not the slot just dragged into: slot 0 holds something the
  // player *bought*, and the pane is a view of a shelf row. `probe:active` was
  // equipped straight onto the champion by the block above, so it is in the
  // bag and on no shelf, and there is no row for a pane to show. Nothing a
  // content pack can do reaches that state — an item enters a bag only through
  // `buyItem`, and an installed registry only ever grows — but a driver that
  // fabricates one has to tap the realistic slot.
  const bought0 = await centreOf(0);
  await tap(bought0.x, bought0.y, 80);
  await page.waitForTimeout(350);
  const tappedName = (await page.locator('.shop-detail-head h4').textContent())?.trim();
  const sellShown = await page.locator('.shop-sell').count();
  report.tapAfterDrag = { tappedName, sellShown };
  check(
    'a tap on a slot still opens its detail',
    tappedName === PROBE_ITEMS.cloak.name,
    `"${tappedName}"`
  );
  check('with the button that sells it', sellShown === 1, `${sellShown} sell buttons`);

  // ------------------------------------------------ the item actives' grid
  //
  // The whole point of an active item is that it is an extra spell, and on a
  // phone it was bound to the digits 1-6 — keys a thumb does not have. So the
  // grid has to draw, and a tap on it has to reach the *inventory's* input
  // controller and not the kit's.
  //
  // And this is where the drag above has to pay: the item was dragged into
  // slot 4, so slot 4's button is the one that must fire it. Moving an item is
  // only worth anything if its key moves with it — "gán slot cho user dễ bấm
  // kích hoạt item" is the ask, and this is the sentence that answers it.
  await page.evaluate(() => window.__moba2d.scene.oScene.game.inGameHUD.vueInstance.hud.closeShop());
  await page.waitForTimeout(300);

  const drawn = await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    const controls = game.touchControls;
    const layout = controls.currentLayout;
    const at = slot => ({
      x: Math.round(layout.items[slot].x),
      y: Math.round(layout.items[slot].y),
    });
    return {
      positions: layout.items.length,
      moved: at(4),
      vacated: at(1),
      viewForMoved: !!controls.host?.spellView?.(4, 'item'),
      viewForVacated: !!controls.host?.spellView?.(1, 'item'),
    };
  });
  report.itemPositions = drawn.positions;
  report.itemButtons = { moved: drawn.moved, vacated: drawn.vacated };
  check('six item positions exist', drawn.positions === 6, `${drawn.positions}`);
  check('the button the item moved to draws it', drawn.viewForMoved, 'no view for slot 4');
  check('and the one it left is empty', !drawn.viewForVacated, 'slot 1 still draws something');

  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}-items.png` });

  // A real touch on slot 4 must reach the item controller. The kit spell in
  // slot 2 is the *same class*, so pressing the wrong row would look identical
  // in a screenshot — this checks the instance the item is holding.
  const before = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.player.items[4].active.state
  );
  await tap(drawn.moved.x, drawn.moved.y, 80);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    item: window.__moba2d.scene.oScene.game.player.items[4].active.state,
    kit: window.__moba2d.scene.oScene.game.player.spells[2].state,
  }));
  report.itemPress = { before, after };
  check(
    'the active answers its new slot’s button',
    after.item !== before,
    `${before} -> ${after.item}`
  );
  check(
    'and leaves the kit slot of the same index alone',
    after.kit === 'READY',
    `kit slot 2 is ${after.kit}`
  );

  check('no runtime errors', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
});
