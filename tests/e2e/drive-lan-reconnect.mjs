/**
 * The reconnect, and the two bugs it is made of.
 *
 * Both were reported from a real phone, in one sitting:
 *
 *   1. *"đt nó tắt màn hình … khi t mở màn hình lại thì trạng thái đứng 1 chỗ,
 *      chưa chết"* — the client had lost the wire and went on drawing the last
 *      world it was sent, confidently, for ever. `ClientSession.update()`
 *      drained its channel and never asked whether the channel was alive.
 *   2. *"vô phòng lại thì thành lan 2 luôn, lan 1 hồi nãy vẫn sống trong
 *      game, host ko đuổi lan nào ra khỏi phòng đc luôn"* — a peer id names a
 *      connection, so the returning player was a stranger, and the champion
 *      they left behind had nobody to sweep it because a backgrounded tab
 *      closes nothing.
 *
 * Neither is visible to Vitest: the first is a rendering loop that keeps
 * running, the second needs two real peers and a wire that dies without
 * saying so. Both are structurally invisible to `drive-lan-sync.mjs` too,
 * which measures a *healthy* wire.
 *
 * ## How a dying phone is simulated
 *
 * `Network.emulateNetworkConditions` over CDP, offline — the client's frames
 * stop arriving at the host and the host's stop arriving at the client, while
 * neither side is told anything. That is what matters: a `close` would make
 * this test pass against the old code, because the old code handled exactly
 * the case that announces itself and only that one.
 *
 *   node tests/e2e/drive-lan-reconnect.mjs
 */
import { spawn } from 'node:child_process';
import { startHarness, startMatch } from './harness.mjs';

const RELAY_PORT = 9300 + Math.floor(Math.random() * 400);

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

const withParams = (mode, room) =>
  `${url}${url.includes('?') ? '&' : '?'}net=${mode}&transport=ws` +
  `&signal=ws://localhost:${RELAY_PORT}&room=${room}&ice=none`;

/** How many champions the host has that belong to clients rather than bots. */
const hostClientCount = () =>
  page.evaluate(() => window.__moba2d.scene.oScene.game.net.netClientRows().length);

await guard(
  async () => {
    // ----------------------------------------------------------- the host
    await page.goto(withParams('host', 'recon'), { waitUntil: 'load' });
    await startMatch(page);
    await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
      timeout: 30_000,
    });
    await page.waitForFunction(() => window.__moba2dNet, null, { timeout: 15_000 });

    // --------------------------------------------------------- the client
    const { page: client, context } = await openPage({ label: 'client' });
    await client.goto(withParams('join', 'recon'), { waitUntil: 'load' });
    await startMatch(client);
    await client.waitForFunction(() => window.__moba2dNet, null, { timeout: 30_000 });
    await client.waitForTimeout(2_500);

    const joined = await hostClientCount();
    check('the host has exactly one client champion', joined === 1, `${joined}`);

    // The seat this browser will come back with. Stable across a reload is the
    // entire mechanism — if this is empty the rest of the run proves nothing.
    const seat = await client.evaluate(() => localStorage.getItem('moba2d:netSeat:v1'));
    report.seat = seat;
    check('the client holds a seat that will survive a reload', Boolean(seat), `${seat}`);

    // Which champion it is, so "the same one" can be checked rather than
    // "some one".
    const before = await page.evaluate(() => window.__moba2d.scene.oScene.game.net.netClientRows());
    report.before = before;

    // ------------------------------------- 1. the wire dies without a word
    const cdp = await context.newCDPSession(client);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    // The client must notice. `HOST_SILENT_MS` is 6s, so this is the wait plus
    // room for the judgement to land in a frame.
    const noticed = await client
      .waitForFunction(() => window.__moba2dNet?.link?.lost === true, null, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    report.clientNoticed = noticed;
    check(
      'the client stops believing the world it is drawing',
      noticed,
      'a stale match shown with no doubt is the bug'
    );

    const overlay = await client.$('#net-link-lost');
    check('and says so on screen, over the match', overlay !== null);

    // The host must notice too, and must *not* sweep yet: this is the case
    // where the player is coming back.
    const marked = await page
      .waitForFunction(
        () => window.__moba2d.scene.oScene.game.net.netClientRows().some(row => !row.attached),
        null,
        { timeout: 20_000 }
      )
      .then(() => true)
      .catch(() => false);
    check('the host marks the champion unattended rather than sweeping it', marked, `${marked}`);

    // ------------------------------------------- 2. the player comes back
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    // Exactly what the overlay does: reload, with the join URL as it stands.
    await client.reload({ waitUntil: 'load' });
    await startMatch(client);
    await client.waitForFunction(() => window.__moba2dNet, null, { timeout: 30_000 });
    await client.waitForTimeout(3_000);

    const after = await page.evaluate(() => window.__moba2d.scene.oScene.game.net.netClientRows());
    report.after = after;

    check(
      'the returning player is not a second player',
      after.length === 1,
      `${after.length} client champions: ${JSON.stringify(after)}`
    );
    check(
      'and gets their own champion back, not a new one',
      after.length === 1 && before.length === 1 && after[0].id === before[0].id,
      `${before[0]?.id} → ${after[0]?.id}`
    );
    check('whose wire is live again', after[0]?.attached === true, JSON.stringify(after[0]));

    // ------------------------------------------------ 3. the host can kick
    const kicked = await page.evaluate(id => {
      const game = window.__moba2d.scene.oScene.game;
      return game.net.kickUnit(id);
    }, after[0].id);
    await page.waitForTimeout(1_500);
    const left = await hostClientCount();
    report.afterKick = { kicked, left };
    check('the host can throw a client out', kicked === true && left === 0, JSON.stringify(report.afterKick));
  },
  { cleanup: () => relay.kill() }
);
