/**
 * The menu, from a cold start to a running match, in a real browser.
 *
 * Three things here that no unit test reaches:
 *
 *   1. **Chơi is two presses now.** It opens the match-config panel and the
 *      panel's Bắt Đầu starts the match. The separate Cấu hình link is gone.
 *      Nothing about the source of either half looks wrong if the wiring
 *      between them breaks; what breaks is that Play does nothing.
 *   2. **The no-roster nudge is about state that has to be *made*.** A first
 *      boot seeds a default pack URL and installs it, so "this player has no
 *      pack" cannot be assumed — this blocks the fetch, which is the only way
 *      to see what a player with nothing actually meets.
 *   3. **The LAN host configures over a live lobby.** The panel is mounted on
 *      top rather than navigated to, because leaving the lobby drops the room
 *      it is holding open. A regression here looks like a working button and
 *      an empty room.
 *
 *   node tests/e2e/drive-menu-flow.mjs
 */
import { startHarness, PHONE_VIEWPORT } from './harness.mjs';

const { url, page, report, check, guard } = await startHarness();

await guard(async () => {
  // A player with no roster. Blocking the manifest leaves core with its own
  // single champion, which is the state `soloContent` is about.
  await page.route('**/manifest.json', route => route.abort());
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#play-btn');

  check('the menu carries no Cấu hình link any more', (await page.$('#config-btn')) === null);
  check(
    'and Play is offered without waiting out the warm-up',
    await page.evaluate(() => !document.querySelector('#play-btn').disabled)
  );

  // 1. The nudge, once.
  await page.click('#play-btn');
  await page.waitForSelector('#pack-nudge', { timeout: 15_000 });
  check('a player with no roster is told one exists', true);

  await page.click('#pack-nudge-play');
  await page.waitForSelector('#pregame-start-btn', { timeout: 20_000 });
  check('“Chơi luôn” goes on to the setup panel', true);

  await page.click('#practice-close');
  await page.waitForSelector('#play-btn', { timeout: 15_000 });
  await page.click('#play-btn');
  await page.waitForSelector('#pregame-start-btn', { timeout: 20_000 });
  check('and the question is not asked twice', (await page.$('#pack-nudge')) === null);

  // 2. Bắt Đầu is what actually starts a match.
  await page.click('#pregame-start-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game, null, { timeout: 45_000 });
  check('Bắt Đầu reaches a running match', true);

  // 3. The LAN host's panel, over a room that stays open behind it.
  await page.goto(`${url}?ice=none`, { waitUntil: 'load' });
  await page.waitForSelector('#lan-btn');
  await page.click('#lan-btn');
  const hostBtn = await page.waitForSelector('#lan-host-room, .lan-primary', { timeout: 20_000 });
  await hostBtn.click();
  await page.waitForSelector('#lan-config-host', { timeout: 30_000 });
  await page.click('#lan-config-host');
  await page.waitForSelector('.match-config-panel', { timeout: 20_000 });

  report.lan = {
    secondStartButton: (await page.$('#pregame-start-btn')) !== null,
    lobbyStillMounted: (await page.$('#lan-start-host')) !== null,
  };
  check(
    'the host panel offers no second way to start',
    !report.lan.secondStartButton,
    'Bắt Đầu here would open a solo match and strand the room'
  );
  check('and the lobby is still holding its room underneath', report.lan.lobbyStillMounted);

  await page.click('#practice-close');
  await page.waitForSelector('.match-config-panel', { state: 'detached', timeout: 15_000 });
  check('closing puts the host back in the lobby', (await page.$('#lan-start-host')) !== null);

  // 4. The landscape phone every one of these has to fit on.
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#play-btn');
  // Reachable, not merely visible. A pack-failure banner legitimately pushes
  // the column past 390px, and `#menu-scene` answers that by scrolling —
  // `justify-content: safe center` is there so an overflowing column can be
  // scrolled to instead of being clipped at both ends. So the check is that
  // the last link can be *got to*, which is the thing a player needs.
  report.landscape = await page.evaluate(() => {
    const host = document.querySelector('#menu-scene');
    host.scrollTop = host.scrollHeight;
    return {
      viewportH: innerHeight,
      scrolls: host.scrollHeight > host.clientHeight,
      lastLinkBottom: Math.round(
        document.querySelector('#about-btn').getBoundingClientRect().bottom
      ),
    };
  });
  check(
    'every menu link can be reached on a landscape phone',
    report.landscape.lastLinkBottom <= report.landscape.viewportH,
    JSON.stringify(report.landscape)
  );

  // Deliberately not checking `errors`: this run aborts a fetch on purpose,
  // and the console noise from that is the point rather than a failure.
});
