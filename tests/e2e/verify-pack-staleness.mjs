/**
 * The reported bug, in a real browser, and the three ways it is now caught.
 *
 * What happened: a player installed the riot pack, the pack was republished
 * under new content hashes, and the game asked for a chunk the previous
 * build's graph named and the current one does not. 404. That champion's Q
 * silently became a basic attack — no warning, no banner, nothing on screen.
 * The only evidence was a red line in a console a player has no reason to
 * open, and even then only a developer could read what it meant.
 *
 * Vitest can prove every piece of the fix in isolation. What it cannot see is
 * the piece that failed: a real page, a real cross-origin pack host, a real
 * cache, and a notice a person can actually read. So this drives all four.
 *
 *   node tests/e2e/verify-pack-staleness.mjs
 */
import { startHarness } from './harness.mjs';
import { requirePackDist, startPackServer, PACK_DIST } from './packServer.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

requirePackDist();

const PACK_PORT = 4401;
const packServer = await startPackServer(PACK_PORT);
const PACK_URL = `http://localhost:${PACK_PORT}/manifest.json`;
const STORE_KEY = 'moba2d:packs:v1';

const manifest = JSON.parse(readFileSync(join(PACK_DIST, 'manifest.json'), 'utf8'));

const { url, page, report, check, errors, guard } = await startHarness();

/**
 * Seeds an installed record and lands on the menu.
 *
 * Seed-then-reload rather than `page.addInitScript`, and that is not a style
 * choice: init scripts **accumulate**. Every one registered runs on every
 * later navigation, so the `fresh` clear below — added once for Part 2 — went
 * on emptying the cache before Parts 3 to 6, silently turning every "boot from
 * the pin" case into "boot from the network" and making the republish
 * invisible. The first run of this script found that by way of an entry
 * request for a build the pin should have overridden.
 *
 * `fresh` also empties `CacheStorage`, i.e. the pinned manifest. Which of the
 * two states a part wants is the part's whole subject: with a pin, boot does
 * not touch the network and the record is rebuilt *from the pin* — so a
 * hand-seeded `buildId` is overwritten, and the only honest way to simulate a
 * stale install is to make the host serve a different build, which is what
 * actually happens. Without a pin, boot fetches and the two always agree.
 */
const bootWith = async (record, { fresh = false } = {}) => {
  await page.evaluate(
    async ([key, value, clearCaches]) => {
      window.localStorage.clear();
      window.localStorage.setItem(key, value);
      // Set so the boot below does not also try to seed the *real* default
      // pack over the internet, which would make this script's result depend
      // on a host it is not testing.
      window.localStorage.setItem('moba2d:packs:seeded:v1', '1');
      if (clearCaches && window.caches) {
        const names = await caches.keys();
        await Promise.all(names.map(name => caches.delete(name)));
      }
    },
    [STORE_KEY, JSON.stringify([record]), fresh]
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#play-btn', { timeout: 45_000 });
};

/**
 * Makes the host serve a different build — a republish, which is the event
 * this whole change exists to survive. Only the update check sees it: boot
 * reads the pinned copy and never asks.
 */
const republishAs = buildId =>
  page.route('**/manifest.json', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ...manifest, buildId }),
    })
  );

const bannerText = () =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.pack-banner')];
    const box = boxes.find(el => el.querySelector('#pack-update'));
    if (!box) return null;
    return {
      text: box.querySelector('span')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      broken: box.classList.contains('pack-banner-broken'),
    };
  });

await guard(
  async () => {
    // -------------------------------------------------------------- Part 1
    // The manifest declares a build id at all. Without it nothing below can
    // work, and it is the field that did not exist when the bug was reported.
    report.buildId = manifest.buildId ?? null;
    check('the pack publishes a buildId', /^[0-9a-f]{12}$/.test(manifest.buildId ?? ''));

    // -------------------------------------------------------------- Part 2
    // The entry is fetched at a URL that names the build. This is the fix for
    // the 404 itself: `pack.js` is the only mutable name a pack publishes, so
    // two builds sharing one URL is what let a cache hand the game a pointer
    // graph into files the host had deleted.
    // One priming navigation, so `page.evaluate` has an origin to write
    // storage on. Nothing is installed on it: the seeded flag is set below
    // before any boot that matters.
    await page.addInitScript(() => {
      window.localStorage.setItem('moba2d:packs:seeded:v1', '1');
    });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#play-btn', { timeout: 45_000 });

    const entryRequests = [];
    page.on('request', request => {
      const href = request.url();
      if (href.includes('/pack.js')) entryRequests.push(href);
    });

    await bootWith({ manifestUrl: PACK_URL, id: 'riot', version: '1.0.0' }, { fresh: true });

    report.entryRequests = entryRequests;
    check('the entry was requested at all', entryRequests.length > 0);
    check(
      'the entry URL carries the build id',
      entryRequests.some(href => href.includes(`?b=${manifest.buildId}`)),
      entryRequests[0] ?? 'none'
    );

    // A browser whose record predates build ids — every existing player —
    // heals itself on this one boot rather than being nagged. There is no pin,
    // so boot fetches the manifest, pins it, and records the live build id;
    // from here its entry URL names a build and the dead-graph 404 cannot
    // recur. The update check then finds nothing to say, which is the right
    // amount to say.
    report.healedBuildId = await page.evaluate(
      key => JSON.parse(window.localStorage.getItem(key) ?? '[]')[0]?.buildId ?? null,
      STORE_KEY
    );
    check(
      'an install predating build ids records one on its first boot',
      report.healedBuildId === manifest.buildId,
      `${report.healedBuildId}`
    );
    await page.waitForTimeout(2500);
    report.unpinnedNotice = await bannerText();
    check('and is not nagged, having just healed', report.unpinnedNotice === null);

    // -------------------------------------------------------------- Part 3
    // Pinned to the build the host is serving: nothing to say. This is the
    // case that must stay quiet, and it is the one a nagging check would
    // break — a notice on every boot is a notice nobody reads.
    await bootWith({
      manifestUrl: PACK_URL,
      id: 'riot',
      version: '1.0.0',
      buildId: manifest.buildId,
    });
    await page.waitForTimeout(3000);
    report.currentNotice = await bannerText();
    check('a pack pinned to the live build says nothing', report.currentNotice === null);

    // -------------------------------------------------------------- Part 4
    // The republish. The pin from Part 3 stays; the *host* moves on. Boot
    // still does not touch the network — that is the point of the pin — so
    // only the update check sees the new build, and it has to defeat the
    // browser's own HTTP cache to do it (riot's manifest ships
    // `max-age=600`), which is why it fetches `no-store`.
    const NEXT_BUILD = 'bbbbbbbbbbbb';
    await republishAs(NEXT_BUILD);
    await bootWith({
      manifestUrl: PACK_URL,
      id: 'riot',
      version: '1.0.0',
      buildId: manifest.buildId,
    });
    await page.waitForSelector('#pack-update', { timeout: 20_000 });
    report.staleNotice = await bannerText();
    check('a stale pin is offered an update', report.staleNotice !== null);
    check(
      'the notice names the pack rather than a code',
      (report.staleNotice?.text ?? '').includes('Liên Minh'),
      report.staleNotice?.text ?? ''
    );
    check('an update-only notice is not painted as broken', report.staleNotice?.broken === false);

    // -------------------------------------------------------------- Part 5
    // Pressing it. The record has to end up pinned to what the host serves,
    // and the page has to reload — the previous build's modules have already
    // been evaluated, and ES modules evaluate once.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 45_000 }),
      page.click('#pack-update'),
    ]);
    await page.waitForSelector('#play-btn', { timeout: 45_000 });
    report.afterUpdate = await page.evaluate(
      key => JSON.parse(window.localStorage.getItem(key) ?? '[]')[0]?.buildId ?? null,
      STORE_KEY
    );
    check(
      'pressing it pins the build the host is serving',
      report.afterUpdate === NEXT_BUILD,
      `${report.afterUpdate}`
    );
    await page.waitForTimeout(2500);
    report.noticeAfterUpdate = await bannerText();
    check('and the notice is gone', report.noticeAfterUpdate === null);
    await page.unroute('**/manifest.json');

    // -------------------------------------------------------------- Part 6
    // The evidence path. A 404 on a file this pack's own manifest listed
    // proves the pinned build is gone from the host — a deploy keeps exactly
    // one build — so this copy can never be completed. That is a stronger
    // claim than "there may be an update", and it is painted differently.
    const victim = manifest.files.find(name => name.startsWith('chunks/'));
    report.victim = victim;
    await page.route(`**/${victim}`, route => route.fulfill({ status: 404, body: 'gone' }));

    await bootWith(
      {
        manifestUrl: PACK_URL,
        id: 'riot',
        version: '1.0.0',
        buildId: manifest.buildId,
        name: 'Liên Minh Huyền Thoại',
      },
      { fresh: true }
    );
    await page.waitForSelector('#pack-update', { timeout: 60_000 });
    report.brokenNotice = await bannerText();
    check('a 404 on a manifest-listed file is reported', report.brokenNotice !== null);
    check(
      'and is painted as broken, not as an ordinary update',
      report.brokenNotice?.broken === true,
      JSON.stringify(report.brokenNotice)
    );
    await page.unroute(`**/${victim}`);

    // The deliberate 404 above is the only thing that should have gone wrong,
    // and it *must* appear here — a run where the victim chunk quietly
    // returned 200 would pass every check above for the wrong reason, because
    // the broken notice would have to have come from somewhere else.
    const deliberate = errors.filter(entry => entry.includes('404'));
    const others = errors.filter(entry => !entry.includes('404'));
    report.pageErrors = { deliberate: deliberate.length, other: others.length };
    check('the forced 404 actually happened', deliberate.length > 0);
    check('nothing else went wrong', others.length === 0, others.slice(0, 2).join(' | '));
  },
  {
    cleanup: () => {
      packServer.close();
    },
  }
);
