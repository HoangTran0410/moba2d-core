/**
 * The whole map loop in a real browser: menu → editor → open a pack map →
 * merged → back to the game → and gone when deleted.
 *
 * What no unit test here can see:
 *
 *   1. **Two documents.** The game publishes `moba2d-pack-maps-v1` and then
 *      *leaves*; the editor is a different page that reads it on its own boot.
 *      `editorCatalog.test.ts` proves the bytes survive, but it hands them
 *      over by hand — nothing in it navigates, so nothing in it catches a menu
 *      that never published, a URL that 404s, or a boot order that reads too
 *      early.
 *   2. **The way out.** "Về game" is a navigation, and the bug it fixes was
 *      that the only way back used to be the browser's own Back button.
 *   3. **A landscape phone.** The menu once unfolded a map picker here that
 *      crushed to 52px on a 390px-tall screen. The picker is gone; this is
 *      what keeps it gone.
 *
 *   node tests/e2e/drive-map-editor.mjs
 */
import { startHarness, PHONE_VIEWPORT } from './harness.mjs';

const { url, page, report, check, errors, guard } = await startHarness();

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#editor-btn');

  // 1. Tạo map is a plain link again — one press, straight to the editor.
  await page.click('#editor-btn');
  await page.waitForURL(/map-editor/, { timeout: 15_000 });
  // `typeof E`, not `window.E`: `state.js` declares `const E`, and a top-level
  // `const` in a classic script lands in the global *lexical* environment,
  // never as a property of `window`.
  await page.waitForFunction(() => typeof E !== 'undefined' && Boolean(E.mapId), null, {
    timeout: 15_000,
  });
  check('Tạo map lands in the editor with no picker in between', true);

  // 2. One map screen, holding both the drafts and what the game has.
  // Not awaited: `map.menu` resolves only when the modal is closed, so
  // awaiting it inside `evaluate` waits for a click that has not happened yet.
  await page.evaluate(() => {
    void Cmd.run('map.menu');
  });
  await page.waitForSelector('.maps-grid');
  const packCards = await page.$$eval('.map-card.pack .mc-name', nodes =>
    nodes.map(node => node.textContent.trim())
  );
  report.packCards = packCards;
  check('the editor lists the maps the game has', packCards.length > 0, packCards.join(' | '));

  // Escape, not a click on the scrim: the modal closes on `pointerdown`, and
  // `HTMLElement.click()` dispatches no pointer event at all — the dialog
  // stayed open and covered the toolbar for the rest of the run.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.scrim', { state: 'detached', timeout: 5_000 });

  // 3. Opening one makes a copy, and rebuilds the cut pieces on the way in.
  const opened = await page.evaluate(async () => {
    const maps = Store.readPackMaps();
    const cut = maps.find(m => !m.authoring) ?? maps[0];
    const rawWalls = cut.terrain.wall.length;
    Store.openPackMap(cut.id);
    return {
      source: cut.name,
      hadAuthoring: Boolean(cut.authoring),
      rawWalls,
      name: E.mapName,
      walls: E.terrains.filter(t => t.type === 'wall').length,
    };
  });
  report.opened = opened;
  check(
    'it opens as a copy, named apart from the original',
    opened.name.endsWith('(bản sửa)'),
    opened.name
  );
  // Merged when the union can prove it covers the same ground, and left as
  // the cut pieces when it cannot — never a third thing. `Geom.unionCovers`
  // is what decides, and today it refuses this map: the boundary band and the
  // corridor across it *overlap*, which edge cancellation does not handle.
  check(
    'a cut map opens whole — merged if that verified, untouched if not',
    opened.walls > 0 && opened.walls <= opened.rawWalls,
    `${opened.rawWalls} cut pieces → ${opened.walls} shapes`
  );

  const undone = await page.evaluate(() => {
    History.undo();
    return E.terrains.filter(t => t.type === 'wall').length;
  });
  report.wallsAfterUndo = undone;
  check(
    'one Ctrl+Z gets the separate pieces back',
    undone === opened.rawWalls,
    `${undone} vs ${opened.rawWalls}`
  );

  // 4. Chơi thử opens a *new tab*, so the editor document survives and its
  //    undo history with it. `History` is memory-only — navigating away used
  //    to wipe every step, which for a map opened from the game meant the
  //    automatic merge became permanent the moment you went to play it once.
  // One real edit first, so "can undo" means something. The step before this
  // spent the entry the import left behind.
  const beforeTrip = await page.evaluate(() => {
    Cmd.addPolygon(4, 110, 'wall');
    return { walls: E.terrains.filter(t => t.type === 'wall').length, past: History.past.length };
  });

  const [gameTab] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 20_000 }),
    page.evaluate(() => {
      void UI.playtest();
    }),
  ]);
  await gameTab.waitForLoadState('load');
  // Read the URL now: `takePlaytestMapId` strips the param as it consumes it,
  // so asking the tab later reports a bare URL and reads like a failure.
  const tabUrlOnOpen = gameTab.url();
  report.playtest = {
    tabUrl: tabUrlOnOpen.includes('playtest='),
    editorStillOpen: !page.isClosed() && page.url().includes('map-editor'),
    canUndoAfter: await page.evaluate(() => History.canUndo()),
    pastBefore: beforeTrip.past,
    pastAfter: await page.evaluate(() => History.past.length),
  };
  // And the step really rolls back, rather than merely being counted.
  report.playtest.wallsAfterUndo = await page.evaluate(() => {
    Cmd.run('edit.undo');
    return E.terrains.filter(t => t.type === 'wall').length;
  });
  await gameTab.close();

  check('Chơi thử opens the game in its own tab', report.playtest.tabUrl, tabUrlOnOpen);
  check('the editor is still there behind it', report.playtest.editorStillOpen);
  check(
    'and its undo history survived the trip',
    report.playtest.canUndoAfter && report.playtest.pastAfter === report.playtest.pastBefore,
    JSON.stringify(report.playtest)
  );
  check(
    'so the edit made before playing can still be undone',
    report.playtest.wallsAfterUndo === beforeTrip.walls - 1,
    `${report.playtest.wallsAfterUndo} after undo, ${beforeTrip.walls} before`
  );

  // 5. Publishing then deleting must clear the game's list too — the bug was
  //    that a deleted map stayed in the game's picker with no way to remove it.
  const lifecycle = await page.evaluate(() => {
    History.redo();
    Store.publishLocal();
    const published = JSON.parse(localStorage.getItem('moba2d-local-maps-v1') || '[]').length;
    Store.deleteMap(E.mapId);
    return {
      published,
      afterDelete: JSON.parse(localStorage.getItem('moba2d-local-maps-v1') || '[]').length,
    };
  });
  report.lifecycle = lifecycle;
  check('a published map reaches the game', lifecycle.published === 1, JSON.stringify(lifecycle));
  check(
    'and deleting it takes it out again',
    lifecycle.afterDelete === 0,
    JSON.stringify(lifecycle)
  );

  // 6. The way back, as a button rather than the browser's Back.
  const backOnToolbar = await page.$('[data-cmd="file.backToGame"]');
  check('the editor shows a way back to the game', backOnToolbar !== null);
  await page.click('[data-cmd="file.backToGame"]');
  await page.waitForSelector('#editor-btn', { timeout: 15_000 });
  check('and pressing it returns to the menu', true);

  // 7. The landscape phone the old picker did not fit on.
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#editor-btn');
  report.landscape = await page.evaluate(() => {
    const host = document.querySelector('#menu-scene');
    return {
      viewportH: innerHeight,
      scrollH: host.scrollHeight,
      clientH: host.clientHeight,
      linkBottom: Math.round(document.querySelector('#editor-btn').getBoundingClientRect().bottom),
    };
  });
  check(
    'the menu fits a landscape phone, with every link on screen',
    report.landscape.linkBottom <= report.landscape.viewportH,
    JSON.stringify(report.landscape)
  );

  check('nothing went wrong', errors.length === 0, errors.join(' | '));
});
