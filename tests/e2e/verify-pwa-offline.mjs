/**
 * Does the installed app actually open with no network?
 *
 * The only question that matters about the PWA work, and the only one Vitest
 * structurally cannot answer: it needs a real service worker, a real cache
 * storage, and a real offline toggle. Everything else about the feature — the
 * manifest, the precache list, the version stamp — can be wrong in ways a
 * build log looks fine about, and the failure only shows up on a phone in a
 * lift.
 *
 * Specifically, this is what would have caught p5 still being on its CDN: the
 * page would serve from cache and then white-screen, because nothing draws
 * without p5. (stats.js was vendored beside it for the same reason and has
 * since been deleted outright — a dev-only FPS HUD is not worth a blocking
 * script and a precache entry on every player's boot.)
 *
 * Plan 2 adds a second claim this script has to prove, and the two fail
 * separately: core precaches itself and would pass every check above with the
 * pack cache entirely empty. See "the pack, offline" below for a URL-fetched
 * champion taken into a match with the network cut — spec §10's row "Offline
 * lần hai vẫn chơi được tướng đã tải".
 *
 *   npm run build && node tests/e2e/verify-pwa-offline.mjs
 *
 * Requires a system Chrome install.
 */
import { preview } from 'vite';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requirePackDist, startPackServer } from './packServer.mjs';

const distDir = join(process.cwd(), 'dist');

/**
 * How many distinct URLs `dist/sw.js`'s own precache manifest declares —
 * the honest floor for "precache is populated", derived from this build's
 * actual output rather than pinned to one configuration's file count.
 *
 * `CacheStorage` is keyed by URL, so a duplicate collapses to one entry at
 * runtime. The generated manifest has one, deterministically: workbox's
 * `generateSW` plugin lists `manifest.webmanifest` and all seven
 * `favicon/*` icons twice — once from the asset glob, once from the PWA
 * icon list it reads separately for the manifest it generates — in both a
 * pack-present and a pack-free build, since neither pack touches the
 * favicon set. Counting raw entries instead of unique URLs would overcount
 * by exactly that duplication no matter how many files a build ships, so
 * `cached` would never equal it and the check would need a fudge factor to
 * pass at all. Deduping here is what makes an *exact* match honest instead
 * of a guess.
 *
 * This is a real external check, not a self-fulfilling one: `cached` comes
 * from the running service worker's actual `CacheStorage` at runtime, while
 * this reads the manifest `sw.js` itself declares. A service worker that
 * fails to cache everything it promised — a quota error, a dropped fetch, a
 * install that partially completes — moves one without moving the other.
 */
const declaredPrecacheCount = () => {
  const source = readFileSync(join(distDir, 'sw.js'), 'utf8');
  /**
   * Two manifest shapes have shipped from this file, and the regex has to
   * read both. `generateSW`'s output put an unquoted `url` key first in the
   * object literal (`{url:"index.html",revision:...}`); `injectManifest`
   * bundles the whole worker and then splices in `JSON.stringify`'d objects
   * — quoted keys, and `revision` first (`{"revision":"...","url":"..."}`) —
   * so a regex anchored to `{url` (quoted or not) matches zero entries on
   * the real output, measured directly rather than assumed. Matching `"url"`
   * unanchored, wherever it falls in the object, is what makes both shapes
   * readable with one pattern.
   */
  const urls = [...source.matchAll(/(?:\{url:|"url":)\s*"([^"]+)"/g)].map(match => match[1]);
  if (urls.length === 0) {
    throw new Error('no precache entries found in dist/sw.js — the manifest shape changed');
  }
  return new Set(urls).size;
};

/* -------------------------------------------------------- the pack, offline
 *
 * A second, genuinely cross-origin static server in front of the pack
 * repository's own built `dist/` — `packServer.mjs`, shared with
 * `verify-runtime-pack.mjs` and `verify-pack-management.mjs` (see its own
 * header for the query-strip-then-`extname` content-type fix and the
 * `access-control-allow-origin: *` a cross-origin `fetch()` needs). Serving
 * it from a different port than `vite preview` picks is what makes this
 * cross-origin rather than same-origin, which is the property the whole
 * feature (and this section) exists to exercise.
 *
 * `requirePackDist()` fails here, before `preview()` or the browser even
 * starts, not as a 180-second timeout inside one — and specifically here,
 * that timeout would have been unusually misleading: left unchecked, every
 * pack request 404s against the static server, the manifest fetch fails
 * inside `installRuntimePacks()`, `window.__lol2dPackPrefetch` never
 * publishes (the `if (toPrefetch.length > 0)` guard around its only writer
 * never runs), and the five pack checks below fail — bit-for-bit the same
 * shape this task's own Step 5 falsification produces by disabling the
 * prefetch on purpose. It also lands before the `pageerror` listener below
 * is even registered, so nothing else would have surfaced it either.
 */
requirePackDist();

const PACK_PORT = 4398;
const packServer = await startPackServer(PACK_PORT);
const PACK_URL = `http://localhost:${PACK_PORT}/manifest.json`;

/**
 * `mode: 'champion'` + a named `championName` is the whole configuration —
 * `PregameConfig.ts:88` — so the match opens on Ahri's own avatar and Q/W/E/R
 * with no pregame-screen interaction at all. `verify-runtime-pack.mjs` drives
 * the kit modal instead because it is also testing that screen; here the
 * modal is not the subject and every click is one more thing to go wrong with
 * the network off.
 */
const CFG_SEED = {
  player: {
    mode: 'champion',
    championName: 'Ahri',
    summonerD: 'Flash',
    summonerF: 'Heal',
    customSlots: Array(7).fill('random'),
  },
  ai: { count: 0, autoMove: false, autoAttack: false, autoCast: false, bots: [] },
  rules: { cooldownReductionPercent: 0, manaFree: true },
  world: { jungle: false, minions: false },
};

/**
 * Core's own fallback spell, by the display name `src/generated/spellCatalog.ts`
 * ships. A runtime pack whose *code* half was rejected still installs its data
 * half, so the roster grows and the champion is named right while all four
 * ability slots quietly hold this instead of her kit — the exact failure the
 * checks below exist to catch.
 */
const BASIC_ATTACK_NAME = 'Đánh Thường (Basic Attack)';

const server = await preview({ preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// Seeded before the first navigation: `installRuntimePacks()` reads the pack
// list during the loading screen, which is before anything is on the glass,
// and `PregameConfig` reads the match config the same way `verify-runtime-
// pack.mjs`'s own seed does.
await page.addInitScript(
  ([packKey, packUrl, cfgKey, cfg]) => {
    window.localStorage.setItem(
      packKey,
      JSON.stringify([{ manifestUrl: packUrl, id: 'riot', version: '1.0.0' }])
    );
    window.localStorage.setItem(cfgKey, JSON.stringify(cfg));
  },
  ['lol2d:packs:v1', PACK_URL, 'lol2d:pregameConfig:v1', CFG_SEED]
);

const failures = [];
let summary = 'did not finish';
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

/** Whether the menu has actually rendered — the app booted, not just responded. */
const menuIsUp = () =>
  page.waitForSelector('#play-btn', { timeout: 30_000 }).then(
    () => true,
    () => false
  );

let cached = 0;
let offlineChampions = 0;
let offlineMatch = { name: null, casts: [] };

try {
  // ---------------------------------------------------------------- online
  await page.goto(url, { waitUntil: 'load' });
  check('menu renders online', await menuIsUp());

  const version = await page.textContent('#menu-version').catch(() => null);
  check('version stamp is on the menu', Boolean(version?.trim().startsWith('v')), version?.trim());

  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  check('service worker is active', registered);

  // Still online, and deliberately before the reload below: `installRuntimePacks()`
  // runs again on every fresh boot, and by the second load most of the pack is
  // already cached — its own report would read mostly `skipped`, not `added`,
  // which would make "it pulled the pack in whole" below pass for the wrong
  // reason on a warm cache. Waiting on `window.__lol2dPackPrefetch` (Task 4)
  // rather than sleeping is what makes this a real signal instead of a guess
  // at how long 590 files over a local static server takes.
  // `.then(fulfilled, rejected)`, not a bare `.then()`: a timeout here (the
  // prefetch never publishing, which is exactly what Step 5 of this task's
  // brief proves) must not throw and abort every check below it — it is
  // itself the finding the two pack checks just below exist to report, and a
  // script that dies here would report only "run completed: false" instead
  // of naming which two.
  const prefetch = await page
    .waitForFunction(() => window.__lol2dPackPrefetch ?? null, null, { timeout: 180_000 })
    .then(
      handle => handle.jsonValue(),
      () => null
    );

  // Workbox precaches in the background; the count is the whole point, so wait
  // for it to settle rather than sampling whatever it has got to so far.
  cached = await page.evaluate(async () => {
    const deadline = Date.now() + 60_000;
    let count = 0;
    let stable = 0;
    while (Date.now() < deadline && stable < 3) {
      const names = await caches.keys();
      let total = 0;
      for (const name of names) {
        // `lol2d-packs-v1` (`packCache.ts`'s `PACK_CACHE_NAME`) is Plan 2's
        // own cache, filled by the pack prefetch this script now waits on
        // just above — concurrently with the precache, during the same boot.
        // Counting it here would make this check's target move with however
        // big the installed pack happens to be, rather than staying what
        // workbox actually declared it would precache. Measured directly:
        // without this exclusion the total read 648 (57 precache + 590
        // prefetched pack files + 1 for the worker's own stored base list)
        // against a declared count of 57.
        if (name === 'lol2d-packs-v1') continue;
        total += (await (await caches.open(name)).keys()).length;
      }
      stable = total === count && total > 0 ? stable + 1 : 0;
      count = total;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return count;
  });
  const expectedPrecache = declaredPrecacheCount();
  check(
    'precache is populated',
    cached === expectedPrecache,
    `${cached} of ${expectedPrecache} declared entries cached`
  );

  // A reload is what puts the worker in control of the page; without it the
  // first load is still coming straight off the network.
  await page.reload({ waitUntil: 'load' });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check('worker controls the page after a reload', controlled);

  // --------------------------------------------------------------- offline
  //
  // Clearing the HTTP cache first, and this is load-bearing: `setOffline` only
  // cuts the network, so Chromium will happily keep answering from its own
  // disk cache and a file that never reached the *service worker* cache still
  // appears to work. Without this the check passes with p5 back on its CDN —
  // measured, by putting it back. A real install, opened days later with that
  // cache long evicted, gets no such help.
  await (await context.newCDPSession(page)).send('Network.clearBrowserCache');
  await context.setOffline(true);
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error)));

  await page.reload({ waitUntil: 'load' });
  check('menu renders offline', await menuIsUp());

  const globals = await page.evaluate(() => ({
    p5: typeof window.createVector === 'function',
    // stats.js is deliberately gone, not merely unused: nothing may put a
    // second blocking vendor script back on the boot path for a dev-only HUD.
    stats: typeof window.Stats,
  }));
  check('p5 globals present offline', globals.p5);
  check('stats.js is not shipped at all', globals.stats === 'undefined', globals.stats);
  check('no page errors offline', consoleErrors.length === 0, consoleErrors[0] ?? '');

  // The real thing: start a match with the network off.
  const inGame = await page
    .click('#play-btn', { timeout: 30_000 })
    .then(() =>
      page.waitForFunction(() => document.querySelector('canvas') !== null, { timeout: 60_000 })
    )
    .then(
      () => true,
      () => false
    );
  check('a match starts offline', inGame);

  // ------------------------------------------------- a pack, with no network
  //
  // The checks above prove the *app* opens. This proves the part Plan 2
  // exists for: a champion whose code arrived over the network, in a match,
  // with the network cut. The distinction matters because the two fail
  // separately — core precaches itself and would keep passing every check
  // above with the pack cache entirely empty.
  check(
    'the prefetch reported itself',
    Array.isArray(prefetch) && prefetch.length === 1,
    JSON.stringify(prefetch)
  );
  check(
    'and it pulled the pack in whole',
    prefetch?.[0]?.failed === 0 && prefetch?.[0]?.added > 500,
    `added=${prefetch?.[0]?.added} failed=${prefetch?.[0]?.failed}`
  );

  // `window.__lol2d` — the dev-only handle `verify-runtime-pack.mjs` reads the
  // live game through — is stripped from a production build (`main.ts`, gated
  // on `import.meta.env.DEV`), and this script tests exactly that build. So
  // both readings below come off the same screen a player would use, not off
  // game internals: the in-match config panel's own Đội tab (the corner
  // button here is `Esc`'s own handler, `hud.openSpellPicker()`), which
  // already renders the champion standing on the map as plain text
  // (`row.title` — `MatchDirectorSource.roster()` — is `entry.unit.name`) and
  // each of her four ability slots as its own button (`row.abilities`,
  // `ABILITY_LETTERS = ['Q','W','E','R']`) that opens `SpellPreviewModal` with
  // that slot's own live `Spell.name` — fallback and all, the same field
  // `verify-runtime-pack.mjs` reads off `spell.name` through the game object
  // directly. Wrapped in its own try so a selector that never appears — the
  // finding itself, in a first run — reports through the checks below rather
  // than losing every one of them to a single thrown error. No fixed sleep
  // ahead of it: the `waitForSelector` right below is the real gate, on the
  // same reasoning as the prefetch wait above — a guess at timing is not a
  // signal.
  try {
    await page.waitForSelector('.corner-btn.spell-picker-btn', {
      state: 'visible',
      timeout: 30_000,
    });
    await page.click('.corner-btn.spell-picker-btn');
    await page.waitForSelector('.practice-roster-row.is-player', {
      state: 'visible',
      timeout: 30_000,
    });

    const name = await page.textContent('.practice-roster-row.is-player .practice-roster-name');

    const abilityButtons = page.locator('.practice-roster-row.is-player .practice-roster-spell');
    const abilityCount = await abilityButtons.count();
    const casts = [];
    for (let i = 0; i < abilityCount; i++) {
      await abilityButtons.nth(i).click();
      await page.waitForSelector('.spell-preview-modal', { state: 'visible', timeout: 15_000 });
      casts.push({ name: (await page.textContent('.spell-preview-modal h3'))?.trim() ?? null });
      await page.click('.spell-preview-modal .pregame-icon-btn[title="Đóng"]');
      await page.waitForSelector('.spell-preview-modal', { state: 'detached', timeout: 15_000 });
    }
    offlineMatch = { name: name?.trim() ?? null, casts };

    // The roster's own count of installable champions — `.kit-shelf`, the
    // same marker `verify-runtime-pack.mjs` counts, opened here from the live
    // match's own loadout editor rather than the pregame screen's.
    await page.click('.practice-roster-row.is-player .practice-roster-open');
    await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 30_000 });
    offlineChampions = await page.locator('.kit-shelf').count();
    await page.click('.loadout-modal .pregame-icon-btn[title="Đóng"]');
    await page.waitForSelector('.loadout-modal', { state: 'detached', timeout: 15_000 });

    await page.click('#practice-close');
  } catch (error) {
    console.log(`(offline pack readings incomplete — ${String(error).split('\n')[0]})`);
  }

  check('the pack roster is there offline', offlineChampions > 50, `${offlineChampions}`);
  check(
    'a pack champion takes the field offline',
    offlineMatch.name === 'Ahri',
    JSON.stringify(offlineMatch.name)
  );
  check(
    "and her four slots hold her own abilities, not core's fallback",
    offlineMatch.casts.length === 4 &&
      offlineMatch.casts.every(cast => cast.name && cast.name !== BASIC_ATTACK_NAME),
    offlineMatch.casts.map(cast => cast.name).join(' / ')
  );

  summary = `offline=${cached} cached entries, pack=${offlineChampions} champions, prefetch added=${prefetch?.[0]?.added ?? 0}`;
} catch (error) {
  // Recorded rather than thrown: a run that dies halfway still has to end in
  // the one line that says what happened, or the failure is a stack trace
  // nobody reads to the bottom of.
  check('run completed', false, String(error).split('\n')[0]);
} finally {
  await browser.close();
  await server.httpServer.close();
  packServer.close();
  console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}  ${summary}`);
}

process.exit(failures.length === 0 ? 0 : 1);
