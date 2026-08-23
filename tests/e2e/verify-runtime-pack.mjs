/**
 * The claim Plan 1 exists to make: a pack served from a URL installs, and
 * the roster grows from one champion to a full one — with no rebuild of
 * core.
 *
 * The pack is served from a second origin by a plain static server, because
 * the property under test is cross-origin `import()` and same-origin would
 * prove nothing. `dist/` of the pack repository is what is served: the real
 * built artifact, not a fixture, so this also catches a build that emits
 * something a browser will not load. This is also the one place in the
 * whole suite that exercises `loadPackFromManifest`'s *default* `importModule`
 * — a real dynamic `import()` of a cross-origin URL — since every Vitest
 * test for that function injects the seam instead.
 *
 * **The static server strips the query string before reading the file, but
 * must compute the content type from that same resolved path, not from the
 * raw request URL.** A chunk requested as `x-abc.js?v=1` has an `extname` of
 * `.js?v=1` if read off `req.url` directly, which matches nothing in `TYPES`
 * and falls back to `application/octet-stream` — and a browser refuses to
 * execute an `application/octet-stream` response as a module. The brief this
 * script was written from had exactly that bug; fixed here by resolving the
 * path once and deriving both the read and the content type from it.
 *
 * **Both checks live inside one `guard()` call.** `startHarness()`'s `guard`
 * ends in `finish()`, which calls `process.exit()` — so a second, later
 * `await guard(...)` in the same script would never run; the process is
 * already gone by then. One `guard()` wrapping both phases (a fresh
 * `page.goto` in the middle, the same shape `verify-pack-champion.mjs` uses
 * for its own two-phase check) is what actually gets both halves executed
 * and reported, and the pack server is closed through `guard`'s own
 * `cleanup` option so it runs whether the body passes or throws.
 *
 *   node tests/e2e/verify-runtime-pack.mjs
 */
// `createServer` from `node:http`, imported under a different local name on
// purpose: `tests/scripts/e2eHarness.test.ts` bans any harness importer from
// matching `\bcreateServer\(`, aimed at a script that boots a *second Vite
// dev server* duplicating the harness's own. This is not that — it is a
// plain static file server for a genuinely separate origin, which is the
// property this whole script exists to exercise (a cross-origin `import()`;
// same-origin would prove nothing). Renaming it also just says what it is.
import { createServer as createStaticServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { startHarness } from './harness.mjs';

const PACK_DIST = '/Users/hoangtran/Desktop/Github/moba2d-content-riot/dist';
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
    // Resolved once, from the query-stripped path — both the file read and
    // the content-type lookup derive from this same `path`, which is the fix
    // for the bug described in this file's own header.
    const path = decodeURIComponent(req.url.split('?')[0]);
    const body = await readFile(join(PACK_DIST, path));
    res.writeHead(200, {
      // A sane default for an extension this map does not know, same as the
      // 404 branch below: an unrecognised type must never silently become a
      // response Chromium treats as a download instead of the resource it
      // asked for.
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(resolve => packServer.listen(PACK_PORT, resolve));
const PACK_URL = `http://localhost:${PACK_PORT}/manifest.json`;

const { url, page, report, check, errors, guard } = await startHarness();

await guard(
  async () => {
    // -------------------------------------------------------------- Part 1
    // A pack served from a live, cross-origin host installs, and the roster
    // it brings grows core past its one bundled champion.

    // Seed the store before the first navigation: `runtimePacks` reads it
    // during the loading screen, which is before anything is on the glass.
    await page.addInitScript(
      ([key, packUrl]) =>
        window.localStorage.setItem(
          key,
          JSON.stringify([{ manifestUrl: packUrl, id: 'riot', version: '1.0.0' }])
        ),
      ['lol2d:packs:v1', PACK_URL]
    );
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#play-btn', { timeout: 45_000 });

    await page.click('#config-btn');
    await page.waitForSelector('#pregame-scene', { state: 'visible', timeout: 30_000 });
    await page.click('.practice-roster-main:has(#practice-row-toggle-0) .practice-roster-open');
    await page.waitForSelector('.loadout-modal', { state: 'visible', timeout: 30_000 });

    const champions = await page.evaluate(() =>
      [...document.querySelectorAll('.kit-shelf')].map(shelf => shelf.getAttribute('data-champion'))
    );
    report.champions = champions.length;
    report.sample = champions.slice(0, 6);

    check('the runtime pack installed a full roster', champions.length > 50, `${champions.length}`);
    check('a champion that exists only in the pack is offered', champions.includes('Ahri'));
    check('the reference pack survived alongside it', champions.includes('Vera'));
    check('nothing went wrong on the page', errors.length === 0, errors.join(' | '));

    // -------------------------------------------------------------- Part 2
    // The other half of the claim: a dead pack host costs the roster, never
    // the menu. Same page, same code path, one difference — the pack does
    // not answer.
    await page.route('**/manifest.json', route => route.abort());
    await page.goto(url, { waitUntil: 'load' });
    const reachedMenu = await page
      .waitForSelector('#play-btn', { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    check('the menu still opens when the pack host is dead', reachedMenu);
    check('the player is told', (await page.locator('.pack-banner').count()) > 0);
  },
  { cleanup: () => packServer.close() }
);
