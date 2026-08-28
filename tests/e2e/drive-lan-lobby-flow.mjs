/**
 * The LAN lobby end to end, on two real browsers: make a room, wait for each
 * other, start, and let a latecomer in.
 *
 * `drive-lan-lobby.mjs` measures the screen; `drive-lan-sync.mjs` measures a
 * running match armed straight off the URL. Neither drives the path a player
 * actually takes, which is the one that has produced three bugs in a row:
 *
 *   1. a client that joined before the host started went into the match and
 *      died on *"WebRTC handshake timed out — is the host still up?"*, about a
 *      host sitting at the same table;
 *   2. the host could not see that anyone had joined, so "wait for everyone,
 *      then start" was done by shouting;
 *   3. and the fix for (2) — opening the room at Tạo phòng — made a *late*
 *      joiner invisible instead, because the lobby went on eating the
 *      `joined` event that is the only thing giving a client a champion.
 *
 * All three are one sequence, so this is one script:
 *
 *   host: Tạo phòng            → the room lists the host alone
 *   client: Vào <code>         → stays on the lobby screen, waiting
 *   both                       → see the same two-player list
 *   host: Vào trận             → the client enters the match on its own
 *   host                       → has a champion for that client
 *   latecomer: Vào <code>      → goes straight into the running match
 *
 * The relay is a `spawn` for the reason `drive-lan-sync.mjs` gives: the
 * harness rule is about not booting a second Vite or browser, and both of
 * those still come from the harness. `transport=ws` throughout — WebRTC
 * between three pages of one headless browser is a different test's problem,
 * and every line above is about the lobby, not the wire.
 */
import { spawn } from 'node:child_process';
import { startHarness } from './harness.mjs';

const RELAY_PORT = 9200 + Math.floor(Math.random() * 400);

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

/** No `net=`/`room=` — the lobby writes those itself, which is half the point. */
const menuUrl = `${url}${url.includes('?') ? '&' : '?'}transport=ws&signal=ws://localhost:${RELAY_PORT}`;

const openLobby = async targetPage => {
  await targetPage.goto(menuUrl, { waitUntil: 'load' });
  await targetPage.waitForSelector('#lan-btn', { timeout: 60_000 });
  await targetPage.click('#lan-btn');
  await targetPage.waitForSelector('.lan-panel', { timeout: 10_000 });
};

/** The seat labels — "Bạn · chủ phòng", "Người chơi 2" — which is what tells rows apart. */
const playerRoles = targetPage =>
  targetPage.evaluate(() =>
    [...document.querySelectorAll('#lan-players .lan-player-role')].map(el => el.textContent.trim())
  );

/** The champion beside each seat — the half that is the same on every screen. */
const playerChampions = targetPage =>
  targetPage.evaluate(() =>
    [...document.querySelectorAll('#lan-players .lan-player-name')].map(el => el.textContent.trim())
  );

await guard(async () => {
  // ------------------------------------------------------- host makes a room
  await openLobby(page);
  await page.click('#lan-host');
  await page.waitForSelector('#lan-code', { timeout: 10_000 });
  const code = await page.getAttribute('#lan-code', 'data-code');
  report.roomCode = code;
  check('hosting produced a room code', !!code && code.length >= 4, String(code));

  await page.waitForFunction(
    () => document.querySelectorAll('#lan-players .lan-player').length === 1,
    null,
    { timeout: 10_000 }
  );
  const hostSoloRoles = await playerRoles(page);
  check(
    'the host lists itself before anyone joins, as itself',
    hostSoloRoles.length === 1 && hostSoloRoles[0].includes('Bạn'),
    JSON.stringify(hostSoloRoles)
  );

  // ------------------------------------------- a client joins and waits here
  const { page: client } = await openPage({ label: 'client' });
  await openLobby(client);
  await client.fill('.lan-join-code input', code);
  await client.click('#lan-join');
  await client.waitForSelector('#lan-waiting', { timeout: 10_000 });

  // Bug (1): this used to be a loading screen counting down to a timeout.
  await client.waitForTimeout(2_000);
  const stillWaiting = await client.evaluate(() => !!document.querySelector('#lan-waiting'));
  check('the client waits in the lobby instead of entering the match', stillWaiting);

  // Bug (2): the host had no idea anybody was there.
  await page.waitForFunction(
    () => document.querySelectorAll('#lan-players .lan-player').length === 2,
    null,
    { timeout: 15_000 }
  );
  report.hostSeesRoles = await playerRoles(page);
  check(
    'the host sees the joiner',
    report.hostSeesRoles.length === 2 && report.hostSeesRoles[1] === 'Người chơi 2',
    JSON.stringify(report.hostSeesRoles)
  );

  await client.waitForFunction(
    () => document.querySelectorAll('#lan-players .lan-player').length === 2,
    null,
    { timeout: 15_000 }
  );
  report.clientSeesRoles = await playerRoles(client);
  // The seats differ by design — each screen names its own row "Bạn" and the
  // other end "Chủ phòng" — so what has to match is *who is in the room*.
  const [hostChampions, clientChampions] = await Promise.all([
    playerChampions(page),
    playerChampions(client),
  ]);
  report.roomChampions = hostChampions;
  check(
    'and both screens show the same room',
    JSON.stringify(hostChampions) === JSON.stringify(clientChampions) && hostChampions.length === 2,
    `${JSON.stringify(hostChampions)} vs ${JSON.stringify(clientChampions)}`
  );
  check(
    'each screen names the host from its own side',
    report.hostSeesRoles[0].includes('Bạn') && report.clientSeesRoles[0] === 'Chủ phòng',
    `${JSON.stringify(report.hostSeesRoles)} / ${JSON.stringify(report.clientSeesRoles)}`
  );

  // -------------------------------------------------------- the host starts
  await page.click('#lan-start-host');
  await page.waitForFunction(() => window.__moba2dNet, null, { timeout: 45_000 });

  // The client leaves the lobby on its own — nobody pressed anything on it.
  await client.waitForFunction(() => window.__moba2dNet, null, { timeout: 45_000 });
  check('the waiting client is pulled into the match when the host starts', true);

  // And the handover kept it: `joined` is the only thing that gives a client a
  // champion, and those events were delivered to the lobby long before
  // `HostSession` existed.
  const clientsAfterStart = await page.evaluate(
    () => window.__moba2dNet.debugStats && document.querySelectorAll('canvas').length > 0
  );
  check('the host booted its session', !!clientsAfterStart);
  await page.waitForFunction(
    () => Object.keys(window.__moba2dNet.debugPositions()).length > 0,
    null,
    { timeout: 20_000 }
  );
  const championsInMatch = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.objectManager.objects.filter(o => o.spells).length
  );
  report.hostChampions = championsInMatch;
  check(
    'the host built a champion for the waiting client',
    championsInMatch >= 2,
    `${championsInMatch} champions`
  );

  // ------------------------------------------------ and a latecomer walks in
  //
  // Bug (3): the lobby's own listener stayed installed after the handover, so
  // this player's `joined` was absorbed by a lobby nobody was looking at and
  // the match never gave them a body.
  const { page: late } = await openPage({ label: 'late' });
  await openLobby(late);
  await late.fill('.lan-join-code input', code);
  await late.click('#lan-join');
  await late.waitForFunction(() => window.__moba2dNet, null, { timeout: 45_000 });
  check('a player joining after the start goes straight into the match', true);

  await page.waitForFunction(
    () => window.__moba2d.scene.oScene.game.objectManager.objects.filter(o => o.spells).length >= 3,
    null,
    { timeout: 20_000 }
  );
  report.hostChampionsAfterLate = await page.evaluate(
    () => window.__moba2d.scene.oScene.game.objectManager.objects.filter(o => o.spells).length
  );
  check(
    'and the host gave the latecomer a champion too',
    report.hostChampionsAfterLate >= 3,
    `${report.hostChampionsAfterLate} champions`
  );
});
