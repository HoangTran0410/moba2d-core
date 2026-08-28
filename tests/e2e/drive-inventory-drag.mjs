/**
 * Rearranging the bag by dragging one slot onto another, in a real browser.
 *
 * Vitest covers `InventoryDrag` (the threshold, the cancel, the tap) and
 * `Champion.moveItem` (the swap, the stats, the passives). Neither can see the
 * part that is the whole feature: that a **real pointer** travelling across a
 * **real HUD** resolves to the right one of two gestures, and that the item's
 * hotkey follows it. Three things only a browser has: pointer capture, which
 * silently stops `pointerenter` firing on anything the drag passes over;
 * `touch-action`, without which the browser claims the gesture before the
 * second `pointermove`; and `elementFromPoint`, which is how the drop target is
 * found at all.
 *
 * The last check is the one the owner actually asked for — "gán slot cho user
 * dễ bấm kích hoạt item". Moving an item is only worth anything if the key
 * moves with it.
 *
 *   node drive-inventory-drag.mjs /tmp/invdrag
 */
import { startHarness, startMatch } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/invdrag';

const h = await startHarness({ out: OUT });
const { page, check, report, guard } = h;

/** The centre of one bag slot, in page coordinates. */
const slotCentre = async index => {
  const box = await page.locator(`[data-item-slot="${index}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Which item id is in each slot, straight off the champion. */
const bag = () =>
  page.evaluate(() =>
    window.__moba2d.scene.oScene.game.player.items.map(held => held?.def.id ?? null)
  );

await guard(async () => {
  await page.goto(h.url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  // Two distinct items, deliberately not in adjacent slots: a swap between
  // neighbours would look right even if the drop target were computed as
  // "the slot the press started on, plus one".
  await page.evaluate(async () => {
    const { HeldItem } = await import('/src/game/items/Item.ts');
    const { packAsset } = await import('/src/game/config/packAsset.ts');
    const game = window.__moba2d.scene.oScene.game;
    const make = (id, stats) =>
      new HeldItem(
        { id, name: id, icon: 'spell_basic_attack', cost: 300, stats },
        null,
        null,
        packAsset('spell_basic_attack')
      );
    game.player.equipItem(make('probe:alpha', { armor: 25 }), 0);
    game.player.equipItem(make('probe:beta', { attackDamage: 15 }), 2);
  });
  await page.waitForTimeout(300);

  const before = await bag();
  report.before = before;
  check(
    'two items are in the bag to start',
    before[0] === 'probe:alpha' && before[2] === 'probe:beta',
    before.join(',')
  );

  const armourBefore = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.player.stats.armor.value
  );

  // ------------------------------------------------------------- the drag
  const from = await slotCentre(0);
  const to = await slotCentre(2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Stepped, not teleported: one jump would leave the browser with a single
  // pointermove and this feature's whole failure mode is what happens to the
  // stream in between.
  await page.mouse.move(from.x + 12, from.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });

  const highlighted = await page.locator('[data-item-slot="2"].drop-target').count();
  const liftedCount = await page.locator('[data-item-slot="0"].lifted').count();
  report.highlightMidDrag = { dropTarget: highlighted, lifted: liftedCount };
  check('the target slot highlights mid-drag', highlighted === 1, `${highlighted} highlighted`);
  check('and the source shows as lifted', liftedCount === 1, `${liftedCount} lifted`);

  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await bag();
  report.afterDrag = after;
  check(
    'the two items swapped',
    after[0] === 'probe:beta' && after[2] === 'probe:alpha',
    after.join(',')
  );

  const shopOpened = await page.locator('.shop-panel').count();
  check('a drag did not also open the shop', shopOpened === 0, `${shopOpened} panels`);

  const noHighlight = await page.locator('.item-slot.drop-target, .item-slot.lifted').count();
  check('the highlight clears on release', noHighlight === 0, `${noHighlight} still marked`);

  // Stats are the half a slot count cannot see: a move routed through
  // unequip/equip would drift them, and nothing on screen would say so.
  const armourAfter = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.player.stats.armor.value
  );
  report.armour = { before: armourBefore, after: armourAfter };
  check('no stat moved with it', armourAfter === armourBefore, `${armourBefore} -> ${armourAfter}`);

  // ------------------------------------------------- a drop on nothing is nothing
  const parked = await slotCentre(0);
  await page.mouse.move(parked.x, parked.y);
  await page.mouse.down();
  await page.mouse.move(parked.x, parked.y - 260, { steps: 10 }); // out over the map
  await page.mouse.up();
  await page.waitForTimeout(200);

  const afterVoidDrop = await bag();
  report.afterVoidDrop = afterVoidDrop;
  check(
    'a drag released off the bar changes nothing',
    afterVoidDrop.join(',') === after.join(','),
    afterVoidDrop.join(',')
  );

  // ------------------------------------------------------- a tap is still a tap
  const tapAt = await slotCentre(1);
  await page.mouse.move(tapAt.x, tapAt.y);
  await page.mouse.down();
  // Two pixels: what a hand does on the way to a click, and under the slop.
  await page.mouse.move(tapAt.x + 2, tapAt.y + 1);
  await page.mouse.up();
  await page.waitForTimeout(300);

  const openedByTap = await page.locator('.shop-panel').count();
  report.shopOpenedByTap = openedByTap;
  check('a tap on a slot still opens the shop', openedByTap === 1, `${openedByTap} panels`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ------------------------------------------- the hotkey follows the item
  // The point of the whole feature. An active dropped into slot 4 must answer
  // to `5`, not to the key of the slot it was bought into.
  await page.evaluate(async () => {
    const { HeldItem } = await import('/src/game/items/Item.ts');
    const { packAsset } = await import('/src/game/config/packAsset.ts');
    const game = window.__moba2d.scene.oScene.game;
    // The champion's own W, worn as an item — a spell that is definitely
    // registered and definitely castable, so the check is about the binding
    // and not about whether some probe spell works.
    const active = game.player.spells[2];
    game.player.equipItem(
      new HeldItem(
        { id: 'probe:active', name: 'Active', icon: 'spell_basic_attack', cost: 0 },
        null,
        active,
        packAsset('spell_basic_attack')
      ),
      5
    );
  });
  await page.waitForTimeout(200);

  const src = await slotCentre(5);
  const dst = await slotCentre(4);
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  await page.mouse.move(dst.x, dst.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const movedTo = await page.evaluate(() =>
    window.__moba2d.scene.oScene.game.player.items.findIndex(i => i?.def.id === 'probe:active')
  );
  report.activeNowInSlot = movedTo;
  check('the active moved to slot 4', movedTo === 4, `slot ${movedTo}`);

  // Counted at `Spell.press`, which is what `SpellInputController` calls, and
  // deliberately not "did the spell change state". A cast can decline for a
  // dozen ordinary reasons — mana, cooldown, no target under the cursor — and
  // every one of them would make this look like a broken binding. What is
  // being tested is which slot the key reached, so that is what is counted.
  await page.evaluate(() => {
    const spell = window.__moba2d.scene.oScene.game.player.items[4].active;
    window.__pressed = 0;
    const original = spell.press.bind(spell);
    spell.press = context => {
      window.__pressed++;
      return original(context);
    };
  });

  // Wait for the world to be somewhere a keypress means anything before
  // measuring one. Without this the check raced the match: a paused frame or a
  // champion still spawning swallows the press, and the run failed about one
  // time in three for a reason that had nothing to do with the binding.
  await page.waitForFunction(
    () => {
      const game = window.__moba2d.scene.oScene.game;
      return !game.paused && !game.player.isDead && game.player.items[4]?.active != null;
    },
    null,
    { timeout: 10_000 }
  );

  await page.mouse.move(640, 500); // somewhere in the world to aim at
  await page.keyboard.press('Digit6');
  await page.waitForTimeout(400);
  const wrongKey = await page.evaluate(() => window.__pressed);

  await page.keyboard.press('Digit5');
  // Polled rather than slept: the press is synchronous inside `keyDown`, so
  // this returns immediately when it worked and only costs the full second
  // when it did not.
  await page.waitForFunction(() => window.__pressed > 0, null, { timeout: 2_000 }).catch(() => {});
  const rightKey = await page.evaluate(() => window.__pressed);

  report.pressesByKey = { after6: wrongKey, after5: rightKey };
  check('slot 5’s key no longer reaches it', wrongKey === 0, `${wrongKey} presses`);
  check('slot 4’s key does', rightKey === 1, `${rightKey} presses`);

  check('no runtime errors', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
});
