/**
 * Two browsers, one match: the LAN prototype driven end to end.
 *
 * Boots the relay (`scripts/net-relay.mjs`, the one extra process a LAN
 * match needs), then the harness's own server and browser; opens a hosting
 * page and a joining page in separate contexts, lets the match run, and
 * measures — the way `drive-bot-discipline.mjs` measures a posture rather
 * than screenshotting it:
 *
 *   - cross-page position error, sampled repeatedly over the run: for every
 *     unit id both sessions know, the distance between the host's truth and
 *     the client's interpolated copy. The median must sit under 50 world
 *     units — interpolation renders ~1 snapshot interval (66ms) behind, so
 *     a walking champion (~200 units/s) legitimately trails by ~15;
 *   - the client's orders landing on the host: a right-click march order
 *     must move the host-side remote champion, and a Q press must put a
 *     host-side spell of that champion on cooldown;
 *   - stream liveness: snapshots received, events applied, zero page errors
 *     on either page.
 *
 * The relay is a `spawn`, not a `createServer` — the harness rule
 * (`tests/scripts/e2eHarness.test.ts`) is about not booting a second Vite
 * or browser, and both of those still come from the harness.
 */
import { spawn } from 'node:child_process';
import { startHarness } from './harness.mjs';

const RELAY_PORT = 8790 + Math.floor(Math.random() * 500);

const relay = spawn('node', ['scripts/net-relay.mjs', String(RELAY_PORT)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('relay never came up')), 10_000);
  relay.stdout.on('data', chunk => {
    if (chunk.toString().includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
});
process.on('exit', () => relay.kill());

const { url, page, report, check, guard, openPage } = await startHarness();

const netParams = `net=%MODE%&server=ws://localhost:${RELAY_PORT}&room=e2e`;
const withParams = mode =>
  `${url}${url.includes('?') ? '&' : '?'}${netParams.replace('%MODE%', mode)}`;

await guard(async () => {
  // ------------------------------------------------------------- the host
  await page.goto(withParams('host'), { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__lol2dNet, null, { timeout: 15_000 });

  // ------------------------------------------------------------ the client
  const { page: clientPage } = await openPage({ label: 'client' });
  await clientPage.goto(withParams('join'), { waitUntil: 'load' });
  await clientPage.click('#play-btn');
  await clientPage.waitForFunction(() => window.__lol2dNet, null, { timeout: 30_000 });
  await clientPage.waitForTimeout(2_000);

  // ------------------------------------------------- position error probe
  const errors = [];
  const unitCounts = [];
  for (let sample = 0; sample < 24; sample++) {
    const [hostPositions, clientPositions] = await Promise.all([
      page.evaluate(() => window.__lol2dNet.debugPositions()),
      clientPage.evaluate(() => window.__lol2dNet.debugPositions()),
    ]);
    const shared = Object.keys(hostPositions).filter(id => clientPositions[id]);
    unitCounts.push(shared.length);
    for (const id of shared) {
      const [hx, hy] = hostPositions[id];
      const [cx, cy] = clientPositions[id];
      errors.push(Math.hypot(hx - cx, hy - cy));
    }
    await clientPage.waitForTimeout(500);
  }
  errors.sort((a, b) => a - b);
  const median = errors[Math.floor(errors.length / 2)] ?? Infinity;
  const p95 = errors[Math.floor(errors.length * 0.95)] ?? Infinity;
  report.sharedUnitsPerSample = Math.round(
    unitCounts.reduce((a, b) => a + b, 0) / unitCounts.length
  );
  report.positionSamples = errors.length;
  report.medianErrorUnits = Math.round(median * 10) / 10;
  report.p95ErrorUnits = Math.round(p95 * 10) / 10;
  check(
    'client tracks the host roster',
    report.sharedUnitsPerSample >= 8,
    `${report.sharedUnitsPerSample} shared units`
  );
  check('median position error < 50 units', median < 50, `${report.medianErrorUnits}`);

  // ------------------------------------------------ client orders -> host
  const before = await page.evaluate(() => window.__lol2dNet.debugRemote());
  check('host spawned a champion for the client', !!before, JSON.stringify(before));

  // A right-click march, held so the tick loop sees it, far from the spawn.
  const viewport = clientPage.viewportSize();
  await clientPage.mouse.move(viewport.width * 0.72, viewport.height * 0.3);
  await clientPage.mouse.down({ button: 'right' });
  await clientPage.waitForTimeout(350);
  await clientPage.mouse.up({ button: 'right' });
  await clientPage.waitForTimeout(2_500);

  const afterMove = await page.evaluate(() => window.__lol2dNet.debugRemote());
  const marched =
    before && afterMove ? Math.hypot(afterMove.x - before.x, afterMove.y - before.y) : 0;
  report.remoteMarchUnits = Math.round(marched);
  check(
    'client right-click marches the host champion',
    marched > 100,
    `${report.remoteMarchUnits} units`
  );

  // A cast: press Q/W/E aimed at the world — at least one must commit host-side.
  for (const key of ['q', 'w', 'e']) {
    await clientPage.keyboard.down(key);
    await clientPage.waitForTimeout(120);
    await clientPage.keyboard.up(key);
    await clientPage.waitForTimeout(250);
  }
  await clientPage.waitForTimeout(1_000);
  const afterCast = await page.evaluate(() => window.__lol2dNet.debugRemote());
  const onCooldown = (afterCast?.cooldowns ?? []).filter(
    (cd, slot) => slot >= 1 && slot <= 4 && cd > 0
  );
  report.remoteCooldowns = afterCast?.cooldowns?.map(Math.round);
  check(
    'a client cast commits on the host',
    onCooldown.length > 0,
    JSON.stringify(report.remoteCooldowns)
  );

  // ------------------------------------------------------------ liveness
  const hostStats = await page.evaluate(() => window.__lol2dNet.debugStats);
  const clientStats = await clientPage.evaluate(() => window.__lol2dNet.debugStats);
  report.hostStats = hostStats;
  report.clientStats = clientStats;
  check(
    'snapshots flowed',
    clientStats.snapshotsReceived > 100,
    `${clientStats.snapshotsReceived}`
  );
  check('events flowed', clientStats.eventsApplied > 5, `${clientStats.eventsApplied}`);
});
