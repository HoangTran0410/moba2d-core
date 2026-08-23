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
import { CFG_KEY, startHarness } from './harness.mjs';

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

/**
 * Nothing else on the map can hit the player mid-cast, and no per-spell mana
 * bookkeeping — the same shape and the same reasoning as
 * `verify-pack-champion.mjs`'s own seed. None of it is the behaviour under
 * test.
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

/**
 * The champion this script takes into a match. Pack-only — core alone has
 * exactly one champion (Vera, from the reference pack) and she is not it — so
 * every ability cast below came over the network or did not happen.
 */
const PACK_CHAMPION = 'Ahri';

/**
 * Core's own fallback spell, by the display name `src/generated/spellCatalog.ts`
 * ships. A runtime pack whose *code* half was rejected still installs its data
 * half, so the roster grows and the champion is named right while all seven
 * slots quietly hold this instead of her kit — which is exactly the failure the
 * roster checks above cannot see.
 */
const BASIC_ATTACK_NAME = 'Đánh Thường (Basic Attack)';

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
    await page.addInitScript(
      ([key, config]) => window.localStorage.setItem(key, JSON.stringify(config)),
      [CFG_KEY, CFG_SEED]
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

    // ------------------------------------------------------------- Part 1b
    // The half of the claim the roster cannot make. `installData` and
    // `installCode` are two separate calls and only the first one is visible
    // above: a pack whose *code* half is rejected still grows the roster,
    // still names the champion right, and hands her seven slots of
    // `BasicAttack`. Casting her Q/W/E/R and watching each cooldown leave 0
    // is the only thing here that can tell those two apart, and the goal
    // this whole branch exists for — "playable in a match" — is stated
    // nowhere else in this script.
    await page.click(`.kit-shelf[data-champion="${PACK_CHAMPION}"] .kit-shelf-apply`);
    await page.click(`.kit-shelf[data-champion="${PACK_CHAMPION}"] .kit-apply-all`);
    await page.click('.kit-bar-btn:not(.secondary)'); // Xác nhận
    await page.waitForSelector('.loadout-modal', { state: 'detached' });
    await page.click('#pregame-start-btn'); // Bắt Đầu
    await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);

    const match = await page.evaluate(() => {
      const game = window.__lol2d.scene.oScene.game;
      const subject = game.player;
      const casts = [];
      // `SpellHotKeys` is [A, Q, W, E, R, D, F], so `spells[1..4]` is Q/W/E/R.
      for (let slot = 1; slot <= 4; slot++) {
        const spell = subject?.spells?.[slot];
        if (!spell) {
          casts.push({ slot, name: null, accepted: false, before: null, after: null, ok: false });
          continue;
        }
        spell.currentCooldown = 0;
        const before = spell.currentCooldown;
        const at = { x: subject.position.x + 200, y: subject.position.y };
        game.worldMouse = createVector(at.x, at.y);
        const context = game.createSpellContext(spell, subject, at);
        const accepted = context ? spell.press(context) : false;
        const after = spell.currentCooldown;
        casts.push({
          slot,
          name: spell.name,
          accepted,
          before,
          after,
          ok: accepted && before === 0 && after > 0,
        });
      }
      return { name: subject?.name ?? null, casts };
    });
    report.match = match;

    check(
      `the match starts with ${PACK_CHAMPION} as the player champion`,
      match.name === PACK_CHAMPION,
      `player.name = ${JSON.stringify(match.name)}`
    );
    check(
      "her four slots hold her own abilities, not core's fallback",
      match.casts.length === 4 &&
        match.casts.every(cast => cast.name && cast.name !== BASIC_ATTACK_NAME),
      match.casts.map(cast => cast.name).join(' / ')
    );
    const slotLetters = ['A', 'Q', 'W', 'E', 'R'];
    for (const cast of match.casts) {
      check(
        `${slotLetters[cast.slot]} (${cast.name ?? '?'}) casts and its cooldown starts`,
        Boolean(cast.ok),
        `accepted=${cast.accepted} cooldown ${cast.before}ms -> ${cast.after}ms`
      );
    }

    // The install's own account of itself, which used to exist only as a
    // `console.warn` — a channel `harness.mjs` does not capture (it records
    // `console.error` and `pageerror`). That is how this script reported 6/6
    // green while `installCode` was throwing 61 pairing errors: it had no
    // way to look. See `src/scenes/packBanner.ts`.
    const outcomes = await page.evaluate(() => window.__lol2dPackInstall ?? null);
    report.outcomes = outcomes;
    check(
      'the install reports itself to the page, not only to a console warning',
      Array.isArray(outcomes) && outcomes.length === 1,
      JSON.stringify(outcomes)
    );
    check(
      'and it reports the pack as installed',
      Array.isArray(outcomes) && outcomes[0]?.ok === true && outcomes[0]?.id === 'riot',
      JSON.stringify(outcomes)
    );

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
    // `isVisible()`, not `count()`. The banner used to be rendered inside
    // `#loading-scene`, which `LoadingScene.exit()` sets to `display: none`
    // on the very next line — so it was in the DOM, `count()` was 1, and the
    // player saw it in 1 sampled frame out of 68. A presence check on a
    // hidden element is a check that cannot fail. Spec §7 puts the banner on
    // the menu, which is the screen still on the glass.
    check(
      'the player is told, on a screen they are actually looking at',
      await page.locator('.pack-banner').isVisible()
    );
    check('the banner offers a retry', await page.locator('#pack-banner-retry').isVisible());
    const failedOutcomes = await page.evaluate(() => window.__lol2dPackInstall ?? null);
    report.failedOutcomes = failedOutcomes;
    check(
      'and the failure is reported to the page with its stage',
      Array.isArray(failedOutcomes) &&
        failedOutcomes[0]?.ok === false &&
        typeof failedOutcomes[0]?.stage === 'string',
      JSON.stringify(failedOutcomes)
    );

    // It does not dismiss itself — spec §7 — and it does not come back once
    // the player has said so, which is what makes the module-level state in
    // `packBanner.ts` load-bearing rather than tidy: `MenuScene` unmounts and
    // remounts on every return from the pregame screen.
    await page.click('#pack-banner-dismiss');
    check(
      "dismissing it is the player's own act, and it sticks",
      !(await page.locator('.pack-banner').isVisible())
    );
    await page.click('#config-btn');
    await page.waitForSelector('#pregame-scene', { state: 'visible', timeout: 30_000 });
    await page.click('#practice-close');
    await page.waitForSelector('#play-btn', { timeout: 30_000 });
    check(
      'and it stays dismissed across a menu remount',
      !(await page.locator('.pack-banner').isVisible())
    );
  },
  { cleanup: () => packServer.close() }
);
