/**
 * The claim Plan 1 exists to make: a pack served from a URL installs, and
 * the roster grows from one champion to a full one — with no rebuild of
 * core.
 *
 * The pack is served from a second origin by a plain static server
 * (`packServer.mjs`, shared with `verify-pwa-offline.mjs` and
 * `verify-pack-management.mjs` — see its own header), because the property
 * under test is cross-origin `import()` and same-origin would prove nothing.
 * `dist/` of the pack repository is what is served: the real built artifact,
 * not a fixture, so this also catches a build that emits something a browser
 * will not load. This is also the one place in the whole suite that exercises
 * `loadPackFromManifest`'s *default* `importModule` — a real dynamic
 * `import()` of a cross-origin URL — since every Vitest test for that
 * function injects the seam instead.
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
import { CFG_KEY, startHarness } from './harness.mjs';
import { requirePackDist, startPackServer } from './packServer.mjs';

requirePackDist();

const PACK_PORT = 4399;
const packServer = await startPackServer(PACK_PORT);
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
    // A dead pack host, twice, because pinning split this case in two.
    //
    // **2a: a pack that is already installed no longer cares.** Boot reads the
    // pinned manifest out of `CacheStorage` and never asks the network, so an
    // unreachable host costs nothing at all — not the menu, and not the
    // roster. This check asserted the opposite until pinning landed, and the
    // opposite was the old behaviour: every launch re-fetched the manifest and
    // a dead host meant a pack-less game.
    await page.route('**/manifest.json', route => route.abort());
    await page.goto(url, { waitUntil: 'load' });
    const survivedDeadHost = await page
      .waitForSelector('#play-btn', { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    check('a pinned pack survives a dead host', survivedDeadHost);
    const pinnedOutcomes = await page.evaluate(() => window.__lol2dPackInstall ?? null);
    report.pinnedOutcomes = pinnedOutcomes;
    check(
      'and installs from the pin, with no network at all',
      Array.isArray(pinnedOutcomes) && pinnedOutcomes[0]?.ok === true,
      JSON.stringify(pinnedOutcomes)
    );
    check(
      'so there is nothing to apologise for',
      !(await page.locator('.pack-banner').isVisible())
    );

    // **2b: with no pin, the old claim stands unchanged** — a dead host costs
    // the roster, never the menu, and the player is told. This is the first
    // install against an unreachable host, which is the case the banner was
    // always for.
    await page.evaluate(async () => {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    });
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
