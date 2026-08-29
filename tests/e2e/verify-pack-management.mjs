/**
 * The claim Task 7 exists to make: a player can paste a manifest URL, is
 * shown the origin before a byte of the pack's own code runs, and only after
 * pressing through does the install actually happen — spec §3's boundary
 * between step 2 (fetch + confirm) and step 3 (`import()`).
 *
 * The pack is served from a second origin by the same plain static server
 * `verify-runtime-pack.mjs` uses (`packServer.mjs` — see its own header),
 * for the same reason: the property under test is a cross-origin install,
 * and same-origin would prove nothing. `dist/` of the sibling pack
 * repository is what is served — the real built artifact, not a fixture.
 *
 * **The whole script lives inside one `guard()` call.** `startHarness()`'s
 * `guard` ends in `finish()`, which calls `process.exit()` — so a second,
 * later `await guard(...)` would never run.
 *
 * **Roster counts come from the pregame screen's kit shelves**
 * (`.kit-shelf[data-champion]`), the same way `verify-runtime-pack.mjs`
 * reads them — not from a direct registry peek, which would prove the
 * registry mutated without proving the screen a player actually looks at
 * reflects it. Reading the roster means leaving the packs screen and back;
 * that is deliberate and harmless, because nothing here ever calls
 * `installPackNow` except the "Cài đặt" press itself — closing the packs
 * screen while a confirmation is only *pending* discards that pending state
 * without installing anything, the same as if the player had pressed "Huỷ".
 *
 *   node tests/e2e/verify-pack-management.mjs
 */
import { CFG_KEY, openSetup, startHarness } from './harness.mjs';
import { requirePackDist, startPackServer } from './packServer.mjs';

requirePackDist();

const PACK_PORT = 4399;
const packServer = await startPackServer(PACK_PORT);
const PACK_ORIGIN = `http://localhost:${PACK_PORT}`;
const PACK_URL = `${PACK_ORIGIN}/manifest.json`;

/**
 * Nothing else on the map can hit the player mid-cast — none of it is the
 * behaviour under test, and nothing here ever starts a real match anyway.
 * Seeded so the pregame screen's own boot never trips over an empty config.
 */
const CFG_SEED = {
  player: {
    mode: 'champion',
    championName: 'random',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
  world: { jungle: false, minions: false },
};

const { url, page, report, check, errors, guard } = await startHarness();

/**
 * Opens the pregame roster editor and counts `.kit-shelf[data-champion]` —
 * the same measurement `verify-runtime-pack.mjs` takes — then closes back to
 * the menu. Called from the menu; returns to the menu.
 */
const readRosterFromMenu = async () => {
  await openSetup(page);
  await page.click('.practice-roster-main:has(#practice-row-toggle-0) .practice-roster-open');
  await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 30_000 });
  const champions = await page.evaluate(() =>
    [...document.querySelectorAll('.kit-shelf')].map(shelf => shelf.getAttribute('data-champion'))
  );
  await page.click('.loadout-modal .pregame-icon-btn');
  await page.waitForSelector('.loadout-modal', { state: 'detached', timeout: 30_000 });
  await page.click('#practice-close');
  await page.waitForSelector('#play-btn', { timeout: 30_000 });
  return champions.length;
};

const openPacksScreen = async () => {
  await page.click('#packs-btn');
  await page.waitForSelector('#packs-scene', { state: 'visible', timeout: 15_000 });
};

const closePacksScreen = async () => {
  await page.click('#packs-close');
  await page.waitForSelector('#play-btn', { timeout: 30_000 });
};

/**
 * The screen is two tabs — Đã cài and Tìm pack — and each half's controls
 * only exist while its own tab is showing (`v-if`, not `display: none`), so
 * every part below says which half it is acting on rather than assuming the
 * one the screen happened to open on. Which tab that is *is* under test:
 * `packsOpensOn` below reads it.
 */
const showTab = async name => {
  await page.click(`#packs-tab-${name}`);
  await page.waitForSelector(`#packs-tab-${name}.selected`, { timeout: 10_000 });
};

/** Which tab the screen chose for itself, as its id suffix. */
const packsOpensOn = () =>
  page.evaluate(() => document.querySelector('.packs-tab.selected')?.id ?? null);

await guard(
  async () => {
    await page.addInitScript(
      ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
      [CFG_KEY, CFG_SEED]
    );
    // Marks the browser as already having been offered the default pack
    // (`installedPackStore.ts`'s `PACK_SEEDED_KEY`), so `installRuntimePacks()`
    // never tries to seed `DEFAULT_PACK_URL` on boot — a real, live host, and
    // this script's own "starts empty" and roster-count checks would
    // otherwise depend on whether that fetch happens to succeed.
    await page.addInitScript(() => window.localStorage.setItem('moba2d:packs:seeded:v1', '1'));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#play-btn', { timeout: 45_000 });

    // -------------------------------------------------------------- Part 1
    // The screen opens, empty, from the menu.
    await openPacksScreen();
    check('the packs screen opens from the menu', await page.locator('.packs-panel').isVisible());

    // With nothing installed, opening on an empty "Đã cài" would be a screen
    // that says nothing to exactly the player who needs it most.
    const openedOn = await packsOpensOn();
    check(
      'with nothing installed it opens on Tìm pack',
      openedOn === 'packs-tab-browse',
      `${openedOn}`
    );

    await showTab('installed');
    const initialRows = await page.locator('.packs-row').count();
    check('it starts empty when nothing is installed', initialRows === 0, `rows=${initialRows}`);
    await showTab('browse');

    // -------------------------------------------------------------- Part 2
    // Paste the URL and press Kiểm tra. `waitForSelector` here is soft
    // (caught, not awaited bare): Step 7 of this task deliberately breaks
    // this exact boundary by having the button install directly, and when
    // it does, the confirmation never appears — a bare `await` would throw
    // and abort the whole script before the roster check below ever ran,
    // hiding the one failure this task exists to prove can happen.
    await page.fill('#pack-url-input', PACK_URL);
    await page.click('#pack-url-check');
    const confirmVisible = await page
      .waitForSelector('#pack-install-confirm', { state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    check('pasting a URL shows a confirmation before anything runs', confirmVisible);

    const confirmOrigin = confirmVisible
      ? (await page.locator('#pack-confirm-origin').textContent())?.trim()
      : null;
    check(
      'the confirmation states the origin, in full',
      confirmOrigin === PACK_ORIGIN,
      `origin = ${confirmOrigin}`
    );

    const confirmText = confirmVisible
      ? ((await page.locator('#pack-install-confirm').textContent()) ?? '')
      : '';
    // Read the name off the wire rather than pinning the string: what is
    // served here is the pack repository's real build, and its manifest is
    // free to rename itself (it has — "Riot champions" became "Liên Minh
    // Huyền Thoại"). The claim is that the dialog shows *what the manifest
    // says*, and the two sources are independent: this one is the JSON, the
    // other is the DOM the component built from it.
    const served = await page.evaluate(
      url => fetch(url).then(response => response.json()),
      PACK_URL
    );
    check(
      'and the pack name and version',
      confirmText.includes(served.name) && confirmText.includes(served.version),
      `manifest says "${served.name}" v${served.version} | ${confirmText.slice(0, 160)}`
    );
    check(
      'and the core compatibility result',
      /Tương thích với core/.test(confirmText),
      confirmText.slice(0, 200)
    );
    check(
      'and says plainly that the pack runs with full authority',
      /toàn quyền/.test(confirmText)
    );

    // The dialog takes focus, and takes it to Huỷ — the answer a key pressed
    // by reflex has to give. Without this a keyboard player could Tab
    // straight past the disclosure onto the URL field still behind it.
    const focusedOnOpen = await page.evaluate(() => document.activeElement?.id ?? null);
    check(
      'it moves focus onto Huỷ, not onto Cài đặt',
      focusedOnOpen === 'pack-confirm-cancel',
      `activeElement = ${focusedOnOpen}`
    );

    // Escape is Huỷ. Two things separate it from a broken dialog that merely
    // vanished: nothing installed, and the URL field still holds what was
    // typed — `cancelInstall` never touches it, `confirmInstall` always
    // clears it, which is the same discriminator Part 5 rests on.
    await page.keyboard.press('Escape');
    const escapeClosed = await page
      .waitForSelector('#pack-install-confirm', { state: 'detached', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const rowsAfterEscape = await page.locator('.packs-row').count();
    const inputAfterEscape = await page.inputValue('#pack-url-input');
    check(
      'Escape cancels it, installing nothing',
      escapeClosed && rowsAfterEscape === 0 && inputAfterEscape === PACK_URL,
      `closed=${escapeClosed} rows=${rowsAfterEscape} input=${JSON.stringify(inputAfterEscape)}`
    );

    const focusedAfterEscape = await page.evaluate(() => document.activeElement?.id ?? null);
    check(
      'and hands focus back where it came from',
      focusedAfterEscape === 'pack-url-check',
      `activeElement = ${focusedAfterEscape}`
    );

    // -------------------------------------------------------------- Part 3
    // The boundary: nothing has run yet. Leaving the packs screen with the
    // confirmation only pending (never confirmed) discards it without
    // installing anything — see this file's own header.
    await closePacksScreen();
    const rosterBefore = await readRosterFromMenu();
    check(
      'no pack code has run at the point of asking',
      rosterBefore === 1,
      `roster = ${rosterBefore}`
    );

    // -------------------------------------------------------------- Part 4
    // Press through, for real this time.
    await openPacksScreen();
    await page.fill('#pack-url-input', PACK_URL);
    await page.click('#pack-url-check');
    await page.waitForSelector('#pack-install-confirm', { state: 'visible', timeout: 20_000 });
    await page.click('#pack-confirm-install');
    await page.waitForSelector('#pack-install-confirm', { state: 'detached', timeout: 20_000 });

    // The answer to "did that work" is the pack sitting in the list, not a
    // badge changing on a card behind the dialog that just closed.
    const afterInstall = await packsOpensOn();
    check(
      'a finished install moves to Đã cài by itself',
      afterInstall === 'packs-tab-installed',
      `${afterInstall}`
    );

    const installedRows = await page.locator('.packs-row').count();
    check('confirming installs it', installedRows === 1, `rows=${installedRows}`);

    await closePacksScreen();
    const rosterAfter = await readRosterFromMenu();
    check(
      'the roster grows without a reload',
      rosterAfter > 50,
      `${rosterBefore} -> ${rosterAfter}`
    );

    await openPacksScreen();
    const reopenedOn = await packsOpensOn();
    check(
      'and a later visit opens on Đã cài, now that there is something in it',
      reopenedOn === 'packs-tab-installed',
      `${reopenedOn}`
    );

    const listedOrigin = (await page.locator('.packs-origin').first().textContent())?.trim();
    check(
      'and the screen now lists it with its origin',
      listedOrigin === PACK_ORIGIN,
      `origin = ${listedOrigin}`
    );

    // The shelf's own entry is the *live* riot pack — a different URL from the
    // one just installed off `localhost`, same id. `isInstalled` matches on
    // either, because `installPackNow` refuses a duplicate id whatever URL it
    // came from: matching on URL alone would leave a Cài button that can only
    // ever answer "đã được cài rồi".
    await showTab('browse');
    const shelfInstalledLabel = (
      await page.locator('.packs-card-install').first().textContent()
    )?.trim();
    check(
      'and the shelf marks that pack installed, by id rather than by URL',
      shelfInstalledLabel === 'Đã cài',
      `label = ${JSON.stringify(shelfInstalledLabel)}`
    );

    // -------------------------------------------------------------- Part 5
    // Cancel path, on a second attempt — reusing the URL Part 4 already
    // installed. That is deliberate: `installPackNow` answers a repeat of an
    // installed id with `skipped: true` without writing anything, so a row
    // count alone cannot tell "Huỷ did nothing" apart from "the wiring is
    // broken and quietly hit the harmless skip branch instead" — both leave
    // the count at 1. `PacksScene.vue`'s `cancelInstall` and `confirmInstall`
    // differ on exactly one other observable: `confirmInstall` always clears
    // `url` on the way out (success or skip), `cancelInstall` never touches
    // it — so the input still holding the pasted URL is what a broken Huỷ
    // cannot fake.
    await page.fill('#pack-url-input', PACK_URL);
    await page.click('#pack-url-check');
    await page.waitForSelector('#pack-install-confirm', { state: 'visible', timeout: 20_000 });
    await page.click('#pack-confirm-cancel');
    await page.waitForSelector('#pack-install-confirm', { state: 'detached', timeout: 20_000 });

    const inputAfterCancel = await page.inputValue('#pack-url-input');
    await showTab('installed');
    const rowsAfterCancel = await page.locator('.packs-row').count();
    check(
      'cancelling installs nothing',
      rowsAfterCancel === 1 && inputAfterCancel === PACK_URL,
      `rows=${rowsAfterCancel} input=${JSON.stringify(inputAfterCancel)}`
    );

    // -------------------------------------------------------------- Part 6
    // Remove — two presses, "Gỡ" then "Chắc chưa?" (Task 6's own control).
    await page.click('.packs-remove');
    await page.click('.packs-remove.confirming');
    await page.waitForSelector('#play-btn', { timeout: 30_000 }); // removal reloads

    await openPacksScreen();
    await showTab('installed');
    const rowsAfterRemove = await page.locator('.packs-row').count();
    check('removing it empties the list', rowsAfterRemove === 0, `rows=${rowsAfterRemove}`);

    await closePacksScreen();
    const rosterAfterRemove = await readRosterFromMenu();
    check('and the roster is back to core alone', rosterAfterRemove === 1, `${rosterAfterRemove}`);

    // -------------------------------------------------------------- Part 7
    // The shelf (`scenes/packs/suggestedPacks.ts`). Last on purpose: pressing
    // Cài starts a fetch of the *live* default pack, which this script
    // otherwise never touches — everything above is served from the local
    // second origin. Whatever that fetch does afterwards, it cannot disturb a
    // check that has already run.
    await openPacksScreen();
    await showTab('browse');
    const shelfCards = await page.locator('.packs-card').count();
    check(
      'the screen offers a pack shelf, not a line of dead text',
      shelfCards > 0,
      `${shelfCards}`
    );

    const shelfUrl = (await page.locator('.packs-card-url').first().textContent())?.trim();
    report.shelfUrl = shelfUrl;
    check(
      'each card names the manifest URL in full',
      /^https:\/\/\S+\/manifest\.json$/.test(shelfUrl ?? ''),
      `${shelfUrl}`
    );
    check(
      'and links to where the pack can be read',
      (await page.locator('.packs-card a[href^="https://"]').count()) > 0
    );

    // The security property, at the level a browser can see it: Cài fills the
    // same field a pasted URL goes into and runs the same check. It does not
    // install — the row count is still 0 the instant after the press, and the
    // only thing that can add one is the confirmation.
    await page.click('.packs-card-install');
    const filled = await page.inputValue('#pack-url-input');
    const rowsAfterShelfPress = await page.locator('.packs-row').count();
    check(
      'pressing Cài routes through the URL field, installing nothing by itself',
      filled === shelfUrl && rowsAfterShelfPress === 0,
      `input=${JSON.stringify(filled)} rows=${rowsAfterShelfPress}`
    );

    report.rosterBefore = rosterBefore;
    report.rosterAfter = rosterAfter;
    report.rosterAfterRemove = rosterAfterRemove;

    check('nothing went wrong on the page', errors.length === 0, errors.join(' | '));
  },
  { cleanup: () => packServer.close() }
);
