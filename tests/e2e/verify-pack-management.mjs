/**
 * The claim Task 7 exists to make: a player can paste a manifest URL, is
 * shown the origin before a byte of the pack's own code runs, and only after
 * pressing through does the install actually happen — spec §3's boundary
 * between step 2 (fetch + confirm) and step 3 (`import()`).
 *
 * The pack is served from a second origin by the same plain static server
 * `verify-runtime-pack.mjs` uses, for the same reason: the property under
 * test is a cross-origin install, and same-origin would prove nothing.
 * `dist/` of the sibling pack repository is what is served — the real built
 * artifact, not a fixture.
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
import { createServer as createStaticServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { CFG_KEY, startHarness } from './harness.mjs';

/**
 * The pack repository's built output — same sibling-checkout convention as
 * `verify-runtime-pack.mjs`. `LOL2D_PACK_DIST` overrides.
 */
const PACK_DIST =
  process.env.LOL2D_PACK_DIST ?? join(process.cwd(), '..', 'moba2d-content-riot', 'dist');

/**
 * Fail fast, before any server or browser starts, rather than as a 404 the
 * static server shrugs off — see `verify-runtime-pack.mjs`'s own header for
 * the incident that made this a required pattern: a missing checkout makes
 * every request to the pack fail, and every check below fails exactly the
 * way a real regression would, with nothing pointing at the real cause.
 */
if (!existsSync(join(PACK_DIST, 'manifest.json'))) {
  console.error(
    `no pack build found at ${PACK_DIST} (looked for manifest.json inside it) — build the ` +
      `moba2d-content-riot repository first, or set LOL2D_PACK_DIST to its dist/ directory.`
  );
  process.exit(1);
}

const PACK_PORT = 4399;
const TYPES = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

const packServer = createStaticServer(async (req, res) => {
  try {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const body = await readFile(join(PACK_DIST, path));
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(resolve => packServer.listen(PACK_PORT, resolve));
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
  await page.click('#config-btn');
  await page.waitForSelector('#pregame-scene', { state: 'visible', timeout: 30_000 });
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
    await page.addInitScript(() => window.localStorage.setItem('lol2d:packs:seeded:v1', '1'));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#play-btn', { timeout: 45_000 });

    // -------------------------------------------------------------- Part 1
    // The screen opens, empty, from the menu.
    await openPacksScreen();
    check('the packs screen opens from the menu', await page.locator('.packs-panel').isVisible());

    const initialRows = await page.locator('.packs-row').count();
    check('it starts empty when nothing is installed', initialRows === 0, `rows=${initialRows}`);

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
    check(
      'and the pack name and version',
      confirmText.includes('Riot champions') && confirmText.includes('1.0.0'),
      confirmText.slice(0, 200)
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
    const listedOrigin = (await page.locator('.packs-origin').first().textContent())?.trim();
    check(
      'and the screen now lists it with its origin',
      listedOrigin === PACK_ORIGIN,
      `origin = ${listedOrigin}`
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

    const rowsAfterCancel = await page.locator('.packs-row').count();
    const inputAfterCancel = await page.inputValue('#pack-url-input');
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
    const rowsAfterRemove = await page.locator('.packs-row').count();
    check('removing it empties the list', rowsAfterRemove === 0, `rows=${rowsAfterRemove}`);

    await closePacksScreen();
    const rosterAfterRemove = await readRosterFromMenu();
    check('and the roster is back to core alone', rosterAfterRemove === 1, `${rosterAfterRemove}`);

    report.rosterBefore = rosterBefore;
    report.rosterAfter = rosterAfter;
    report.rosterAfterRemove = rosterAfterRemove;

    check('nothing went wrong on the page', errors.length === 0, errors.join(' | '));
  },
  { cleanup: () => packServer.close() }
);
