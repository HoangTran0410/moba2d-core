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

const withParams = (mode, transport, room) =>
  `${url}${url.includes('?') ? '&' : '?'}net=${mode}&transport=${transport}` +
  `&signal=ws://localhost:${RELAY_PORT}&room=${room}`;

await guard(async () => {
  // ------------------------------------------------------------- the host
  await page.goto(withParams('host', 'ws', 'e2e'), { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__lol2dNet, null, { timeout: 15_000 });

  // ------------------------------------------------------------ the client
  const { context: clientContext, page: clientPage } = await openPage({ label: 'client' });
  await clientPage.goto(withParams('join', 'ws', 'e2e'), { waitUntil: 'load' });
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

  // ------------------------------------------------- latency measurements
  // One act measures both numbers: arm the host-side watcher, then the
  // client presses its slots in order until one commits locally (a random
  // kit can hold UNIT-targeted spells that refuse when every enemy is
  // across the map — a refusal says nothing about latency). Own latency is
  // keypress to local state change; remote latency is the same press's
  // commit appearing on the host. Runs before any marching, at the spawn,
  // where the champion cannot already be dead.
  const ownCastProbe = `new Promise(resolve => {
    const game = window.__lol2d.scene.oScene.game;
    const enemies = game.objectManager.objects.filter(
      o => o.constructor?.name?.includes('Champion') && o.teamId !== game.player.teamId && !o.isDead
    );
    const target = enemies[0] ?? game.player;
    game.worldMouse.set(target.position.x, target.position.y);
    const slots = [
      [87, 2],
      [81, 1],
      [69, 3],
      [82, 4],
    ]; // W, Q, E, R
    const tryNext = () => {
      const next = slots.shift();
      if (!next) {
        resolve({ latencyMs: -1, stamp: Date.now() });
        return;
      }
      const [keyCode, slot] = next;
      const spell = game.player.spells[slot];
      const t0 = Date.now();
      game.spellInputController.keyDown(keyCode, false);
      game.spellInputController.keyUp(keyCode);
      const timer = setInterval(() => {
        if (spell.currentCooldown > 0 || spell.state !== 'READY') {
          clearInterval(timer);
          resolve({ latencyMs: Date.now() - t0, stamp: t0 });
        } else if (Date.now() - t0 > 700) {
          clearInterval(timer);
          tryNext();
        }
      }, 2);
    };
    tryNext();
  })`;
  const hostStampProbe = `new Promise(resolve => {
    const session = window.__lol2dNet;
    const armedAt = Date.now();
    const timer = setInterval(() => {
      const remote = session.debugRemote();
      if (remote && remote.cooldowns.slice(1, 5).some(cd => cd > 0)) {
        clearInterval(timer);
        resolve(Date.now());
      } else if (Date.now() - armedAt > 8000) {
        clearInterval(timer);
        resolve(-1);
      }
    }, 2);
  })`;

  const hostStampPromise = page.evaluate(hostStampProbe);
  const ownCast = await clientPage.evaluate(ownCastProbe);
  const hostCommitStamp = await hostStampPromise;
  report.ownCastLatencyMs = ownCast.latencyMs;
  report.remoteCommitLatencyMs = hostCommitStamp > 0 ? hostCommitStamp - ownCast.stamp : -1;
  check(
    'own cast visible under 50ms',
    ownCast.latencyMs >= 0 && ownCast.latencyMs < 50,
    `${ownCast.latencyMs}ms`
  );
  check(
    'remote cast commits under 150ms',
    report.remoteCommitLatencyMs >= 0 && report.remoteCommitLatencyMs < 150,
    `${report.remoteCommitLatencyMs}ms`
  );

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

  // The latency probe above already pressed until a cast committed; the
  // host's cooldown row is that commit's receipt.
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

  // The WS pages keep running as the RTC leg boots two more matches in the
  // same browser; closing the WS client trims one full game's CPU out of the
  // latency measurements below.
  await clientContext.close();

  // ================================================== the WebRTC leg
  // Same match shape, fresh pages, `transport=rtc`: the relay carries only
  // the SDP/ICE handshake and the game runs over peer-to-peer DataChannels
  // (reliable `r` + lossy `u`). Headless chromium negotiates loopback host
  // candidates between the two contexts, which is exactly the same-LAN path.
  const { page: rtcHost } = await openPage({ label: 'rtc-host' });
  await rtcHost.goto(withParams('host', 'rtc', 'e2ertc'), { waitUntil: 'load' });
  await rtcHost.click('#play-btn');
  await rtcHost.waitForFunction(() => window.__lol2dNet, null, { timeout: 30_000 });

  const { page: rtcClient } = await openPage({ label: 'rtc-client' });
  await rtcClient.goto(withParams('join', 'rtc', 'e2ertc'), { waitUntil: 'load' });
  await rtcClient.click('#play-btn');
  await rtcClient.waitForFunction(() => window.__lol2dNet, null, { timeout: 30_000 });
  await rtcClient.waitForTimeout(3_000);

  const rtcErrors = [];
  for (let sample = 0; sample < 8; sample++) {
    const [hostPositions, clientPositions] = await Promise.all([
      rtcHost.evaluate(() => window.__lol2dNet.debugPositions()),
      rtcClient.evaluate(() => window.__lol2dNet.debugPositions()),
    ]);
    for (const id of Object.keys(hostPositions).filter(each => clientPositions[each])) {
      const [hx, hy] = hostPositions[id];
      const [cx, cy] = clientPositions[id];
      rtcErrors.push(Math.hypot(hx - cx, hy - cy));
    }
    await rtcClient.waitForTimeout(400);
  }
  rtcErrors.sort((a, b) => a - b);
  report.rtcPositionSamples = rtcErrors.length;
  report.rtcMedianErrorUnits =
    Math.round((rtcErrors[Math.floor(rtcErrors.length / 2)] ?? Infinity) * 10) / 10;
  check('rtc: client tracks the host', rtcErrors.length > 100, `${rtcErrors.length} samples`);
  check(
    'rtc: median error < 50 units',
    report.rtcMedianErrorUnits < 50,
    `${report.rtcMedianErrorUnits}`
  );

  const rtcHostStamp = rtcHost.evaluate(hostStampProbe);
  const rtcOwnCast = await rtcClient.evaluate(ownCastProbe);
  const rtcHostCommit = await rtcHostStamp;
  report.rtcOwnCastLatencyMs = rtcOwnCast.latencyMs;
  report.rtcRemoteCommitLatencyMs = rtcHostCommit > 0 ? rtcHostCommit - rtcOwnCast.stamp : -1;
  check(
    'rtc: own cast under 50ms',
    rtcOwnCast.latencyMs >= 0 && rtcOwnCast.latencyMs < 50,
    `${rtcOwnCast.latencyMs}ms`
  );
  check(
    'rtc: remote cast commits under 150ms',
    report.rtcRemoteCommitLatencyMs >= 0 && report.rtcRemoteCommitLatencyMs < 150,
    `${report.rtcRemoteCommitLatencyMs}ms`
  );

  const rtcStats = await rtcClient.evaluate(() => window.__lol2dNet.debugStats);
  report.rtcClientStats = rtcStats;
  check(
    'rtc: snapshots flowed p2p',
    rtcStats.snapshotsReceived > 60,
    `${rtcStats.snapshotsReceived}`
  );
});
