/**
 * What a pack that half-arrives does to the player.
 *
 * Reported from a phone: press Chơi, and the screen stays on "Đang vào trận…"
 * for ever. No error, no way back, nothing to read — and on a phone there is
 * no console to open. On a desktop the same build reached the match and only
 * left a red CORS line behind.
 *
 * Three defects share that one symptom, and none of them is visible to Vitest,
 * because each needs a real browser doing real cross-origin loads:
 *
 *   1. `GameScene.enter` calls `void this.startGame()`. Anything that throws
 *      in there — and a pack chunk that will not load throws — becomes an
 *      unhandled rejection. The scene keeps painting `drawKitLoading()`,
 *      because `this.game` is still null and `_exited` is still false. That is
 *      the frozen screen, exactly.
 *   2. `PackRegistry.loadMapGeometry` deletes its in-flight entry on the
 *      success path only, so the *rejected* promise stays in the map and every
 *      later attempt is handed the same rejection. One dropped request brings
 *      the page down for as long as it is open; even a full retry cannot clear
 *      it.
 *   3. Pack art is requested in two different CORS modes. p5's `loadImage`
 *      opens with `fetch(path, { mode: 'cors' })` to sniff the content type
 *      (`p5.min.js`, `prototype.loadImage`), while the same picture is already
 *      on screen as a plain DOM `<img>` with no `crossorigin` — a `no-cors`
 *      request. Chrome keeps one HTTP cache entry per URL, so whichever lands
 *      first decides whether the other one is allowed to read it. That is the
 *      reported `No 'Access-Control-Allow-Origin' header is present` against a
 *      host which demonstrably sends `access-control-allow-origin: *`.
 *
 * Part 3 asserts the request modes rather than the cache outcome on purpose:
 * whether Chrome reuses the poisoned entry depends on its cache state, but the
 * app asking for one URL two ways is the defect underneath, and it is
 * deterministic. A cross-origin `cors` request carries an `Origin` header and
 * a `no-cors` one does not, so the two are told apart at the wire — through
 * `request.allHeaders()`, never `request.headers()`. The latter reports only
 * what the *page* set, so every `fetch()` in the run came back without an
 * `Origin` and this part scored 358 correct `cors` requests as `no-cors`,
 * blaming the fix for the bug it had just removed.
 *
 *   node tests/e2e/verify-pack-failure-paths.mjs
 */
import { startHarness, startMatch } from './harness.mjs';
import { requirePackDist, startPackServer } from './packServer.mjs';

requirePackDist();

const PACK_PORT = 4403;
const packServer = await startPackServer(PACK_PORT);
const PACK_ORIGIN = `http://localhost:${PACK_PORT}`;
const PACK_URL = `${PACK_ORIGIN}/manifest.json`;
const STORE_KEY = 'moba2d:packs:v1';
const CFG_KEY = 'moba2d:pregameConfig:v1';

/**
 * The pack's own map, named explicitly.
 *
 * A default config resolves to `maps[0]`, which is core's `reference:
 * proving-grounds` — geometry core holds as a plain object, so nothing is
 * fetched and nothing can fail. The map a player actually picks is the pack's,
 * and *that* one arrives as a dynamic import. Aiming this probe at the default
 * is how its first run scored a broken build as healthy.
 */
const PACK_MAP_ID = 'lol:summoners-rift';

/** The one pack chunk a match cannot start without. */
const GEOMETRY_CHUNK = '**/summonersRiftGeometry-*.js';

const { url, page, report, check, guard } = await startHarness();

const settle = ms => page.waitForTimeout(ms);

/** Seeds the installed record and lands on the menu. Seed-then-reload, never
 *  `addInitScript`, which accumulates across navigations. */
const boot = async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(
    async ([key, value, cfgKey, cfg]) => {
      window.localStorage.clear();
      window.localStorage.setItem(key, value);
      window.localStorage.setItem(cfgKey, cfg);
      window.localStorage.setItem('moba2d:packs:seeded:v1', '1');
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    },
    [
      STORE_KEY,
      JSON.stringify([{ manifestUrl: PACK_URL, id: 'lol', version: '1.0.0' }]),
      CFG_KEY,
      JSON.stringify({ mapId: PACK_MAP_ID, ai: { count: 0, bots: [] } }),
    ]
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#play-btn', { timeout: 45_000 });
};

/** Whether a match is actually running. */
const matchRunning = () => page.evaluate(() => Boolean(window.__moba2d?.scene?.oScene?.game));

/** Every bit of text the player can see, canvas excluded. */
const visibleText = () =>
  page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 400));

await guard(async () => {
  /* ------------------------------------------------------- part 1: the hang */

  await boot();

  // The pack host loses exactly one file. Everything else still serves.
  await page.route(GEOMETRY_CHUNK, route => route.abort('failed'));

  await startMatch(page);
  await settle(9000);

  report.afterGeometryFailure = {
    running: await matchRunning(),
    activeMapId: await page.evaluate(
      () => window.__moba2d?.scene?.oScene?.game?.activeMapId ?? null
    ),
    domText: await visibleText(),
  };

  check(
    'a pack chunk that will not load does not start a match',
    report.afterGeometryFailure.running === false,
    'the probe failed to break anything — nothing below means what it says'
  );

  // The defect. The player is looking at a bar that will never move.
  const told = await page.evaluate(() => {
    const text = document.body.innerText;
    return /không|lỗi|thử lại|quay lại|failed|error/i.test(text);
  });
  check(
    'the player is told the match cannot start',
    told,
    'nothing on screen says anything went wrong — this is the reported freeze'
  );

  // And there has to be a way out that is not "kill the app".
  const wayOut = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      b => b.offsetParent !== null && /quay lại|thử lại|menu|retry/i.test(b.textContent ?? '')
    )
  );
  check('there is a way off the stuck screen', wayOut, 'no visible button to leave or retry');

  /* -------------------------------------- part 2: the retry stays poisoned */

  // The host is healthy again — a dropped request, not a dead build.
  await page.unroute(GEOMETRY_CHUNK);
  await boot();
  await startMatch(page);
  await settle(9000);

  report.retryAfterRecovery = { running: await matchRunning() };
  check(
    'a match starts once the host is healthy again',
    report.retryAfterRecovery.running === true,
    'the rejected in-flight promise is still cached, so the page can never recover'
  );

  /* ---------------------------------------- part 3: one URL, two CORS modes */

  const modes = new Map();
  const measured = [];
  page.on('request', request => {
    const href = request.url();
    if (!href.startsWith(PACK_ORIGIN)) return;
    if (!/\.(webp|png|jpe?g)$/.test(href.split('?')[0])) return;
    measured.push(
      request
        .allHeaders()
        .then(headers => {
          const entry = modes.get(href) ?? { cors: 0, noCors: 0 };
          // A cross-origin `cors` request carries `Origin`; a `no-cors` one
          // does not. `allHeaders` because the browser adds `Origin` itself.
          if (headers['origin']) entry.cors += 1;
          else entry.noCors += 1;
          modes.set(href, entry);
        })
        // A request the page tore down before its headers could be read tells
        // us nothing either way; it must not be counted as a violation.
        .catch(() => {})
    );
  });

  await boot();
  // The roster paints pack portraits and icons as DOM `<img>`, then the match
  // loads the same files through p5. Both halves have to happen.
  await startMatch(page);
  await settle(12_000);
  await Promise.all(measured);

  const split = [...modes.entries()].filter(([, m]) => m.cors > 0 && m.noCors > 0);
  report.corsModes = {
    packImageUrls: modes.size,
    requestedBothWays: split.length,
    sample: split.slice(0, 3).map(([href, m]) => `${href.split('/').pop()} cors=${m.cors} no-cors=${m.noCors}`),
  };
  check(
    'no pack image is requested in two different CORS modes',
    split.length === 0,
    `${split.length} of ${modes.size} pack images fetched both ways — ${report.corsModes.sample.join(' | ')}`
  );
});

packServer.close();
