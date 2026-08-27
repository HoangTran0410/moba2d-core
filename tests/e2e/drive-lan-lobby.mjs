/**
 * The LAN lobby's layout, on the screen it became.
 *
 * It used to be a fold-out box on the menu, and this script's first version
 * measured it against the menu's own rhythm — the report that produced it was
 * a panel wider and taller than every real menu button, an orphaned "Vào" with
 * no visible input, and a landscape phone whose menu column overflowed a
 * scroll-less screen. The panel is its own scene now (`LanScene.vue`, and its
 * header says why), so what has to be measured changed with it: a panel that
 * fits the viewport it owns, rather than a drawer that fits a column.
 *
 * Asserts, at a landscape phone viewport (844×390, real touch):
 *   - the menu offers exactly the two match buttons, and Cấu hình is a link
 *     rather than a third one — the regression the redesign exists to prevent;
 *   - the lobby panel fits the viewport in both axes, and its body scrolls if
 *     the content is taller (programmatically *and* under a real touch drag,
 *     because `GameScene`-era preventDefault habits have killed thumb-scrolling
 *     here before);
 *   - the room code is rendered large — it exists to be read out loud;
 *   - a fresh room lists its own host, which is the control the whole player
 *     list exists for;
 *   - the code input and its Vào button sit on one row, input visibly wide;
 *   - the broker-unreachable state is one quiet line (a second page load
 *     points `?signal=` at a dead port on purpose — which also keeps the
 *     degrade path covered without a network);
 *   - leaving the lobby strips `?net=`/`?room=`, so the menu's Chơi cannot
 *     silently host a LAN match. That was a real trap in the drawer version;
 *   - **pressing Vào keeps the player on this screen**. Joining used to go
 *     straight to `GameScene`, which gave a host that had not pressed Vào trận
 *     fifteen seconds to answer and then died on a loading screen; the wait
 *     belongs beside the host's own. With the broker dead the wait cannot
 *     succeed, so what is measured is the pair that must hold either way — no
 *     navigation, and a failure that lands back on usable controls with the
 *     URL disarmed rather than a spinner nobody can leave;
 *   - nothing overflows horizontally.
 * Then the same panel at a portrait phone (390×844) must fit outright.
 *
 * No zero-console-errors check on purpose: the dead signal port logs a
 * failed fetch, and that failure being *quiet in the UI* is the assertion.
 */
import { spawn } from 'node:child_process';
import { startHarness, PHONE_VIEWPORT } from './harness.mjs';

/**
 * A live relay, because hosting is now a real connection.
 *
 * The panel's fullest state — code card, player list, Vào trận, Huỷ phòng — is
 * the one whose fit matters, and since the host opens its room at Tạo phòng
 * that state only exists when a broker answers. The dead-port probe below
 * still runs, on its own page load, because "the failure is quiet" is a
 * separate assertion from "the panel fits".
 */
const RELAY_PORT = 9700 + Math.floor(Math.random() * 400);
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

const { url, page, report, check, guard, openPage } = await startHarness({
  viewport: PHONE_VIEWPORT,
  hasTouch: true,
  deviceScaleFactor: 2,
  out: '/tmp/lan-lobby',
});

const DEAD_SIGNAL = 'ws://localhost:9';
const menuUrlWith = signal => `${url}${url.includes('?') ? '&' : '?'}signal=${signal}`;
const menuUrl = menuUrlWith(`ws://localhost:${RELAY_PORT}`);
const deadMenuUrl = menuUrlWith(DEAD_SIGNAL);

const openLobby = async (targetPage, at = menuUrl) => {
  await targetPage.goto(at, { waitUntil: 'load' });
  await targetPage.waitForSelector('#lan-btn', { timeout: 60_000 });
  await targetPage.click('#lan-btn');
  await targetPage.waitForSelector('.lan-panel', { timeout: 5_000 });
};

const openLobbyHosting = async (targetPage, at = menuUrl) => {
  await openLobby(targetPage, at);
  // Host, so the panel shows its fullest state — the one that has to fit.
  await targetPage.click('#lan-host');
  await targetPage.waitForSelector('#lan-start-host', { timeout: 10_000 });
  await targetPage.waitForSelector('#lan-players .lan-player', { timeout: 10_000 });
};

const rectOf = (targetPage, selector) =>
  targetPage.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);

await guard(async () => {
  // ------------------------------------------------ the menu it is reached from
  await page.goto(menuUrl, { waitUntil: 'load' });
  await page.waitForSelector('#lan-btn', { timeout: 60_000 });
  const menuShape = await page.evaluate(() => ({
    bigButtons: [...document.querySelectorAll('#menu-scene .hextech-btn')].map(el => el.id),
    links: [...document.querySelectorAll('#menu-scene .menu-link')].map(el => el.id),
  }));
  report.menuShape = menuShape;
  check(
    'the menu offers exactly the two match buttons',
    menuShape.bigButtons.length === 2 &&
      menuShape.bigButtons.includes('play-btn') &&
      menuShape.bigButtons.includes('lan-btn'),
    JSON.stringify(menuShape.bigButtons)
  );
  check(
    'Cấu hình is a link, not a third big button',
    menuShape.links.includes('config-btn'),
    JSON.stringify(menuShape.links)
  );
  // The one shot of the menu itself: the counts above say the shape is right,
  // and this says whether it *looks* right. One screenshot, not a run's worth
  // — see the "keeping a pass cheap" note in CLAUDE.md.
  await page.screenshot({ path: '/tmp/lan-lobby-menu.png' });

  // ------------------------------------------------ landscape phone, touch
  await openLobbyHosting(page);

  const panel = await rectOf(page, '.lan-panel');
  const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  report.panel = {
    w: Math.round(panel.width),
    h: Math.round(panel.height),
    viewport,
  };
  check(
    'panel fits the viewport in both axes',
    panel.width <= viewport.w + 1 && panel.height <= viewport.h + 1,
    JSON.stringify(report.panel)
  );
  check(
    'panel is on screen, not clipped off an edge',
    panel.x >= -1 && panel.y >= -1 && panel.x + panel.width <= viewport.w + 1,
    JSON.stringify({ x: Math.round(panel.x), y: Math.round(panel.y) })
  );

  const codeSize = await page.evaluate(() => {
    const el = document.querySelector('.lan-code-value');
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  });
  report.codeFontPx = Math.round(codeSize);
  check('the room code is rendered large', codeSize >= 24, `${report.codeFontPx}px`);

  const inputRect = await rectOf(page, '.lan-join-code input');
  const joinBtnRect = await rectOf(page, '.lan-join-code button');
  const sameRow =
    inputRect &&
    joinBtnRect &&
    Math.abs(inputRect.y + inputRect.height / 2 - (joinBtnRect.y + joinBtnRect.height / 2)) <= 2;
  check('code input and Vào share one row', !!sameRow, JSON.stringify({ inputRect, joinBtnRect }));
  check('code input is visibly wide', inputRect.width >= 80, `${Math.round(inputRect.width)}px`);

  const roomRoster = await page.evaluate(() =>
    [...document.querySelectorAll('#lan-players .lan-player-role')].map(el => el.textContent.trim())
  );
  report.hostRoster = roomRoster;
  check(
    'a fresh room lists its host',
    roomRoster.length === 1 && roomRoster[0].includes('Bạn'),
    JSON.stringify(roomRoster)
  );

  // --------------------------------------------------------- overflow story
  const scroll = await page.evaluate(() => {
    const body = document.querySelector('.lan-body');
    const root = document.querySelector('#lan-scene');
    return {
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
    };
  });
  report.landscapeScroll = scroll;
  check(
    'no horizontal overflow',
    scroll.rootScrollWidth <= scroll.rootClientWidth + 1,
    JSON.stringify(scroll)
  );

  if (scroll.bodyScrollHeight > scroll.bodyClientHeight + 4) {
    // Must be reachable by scrolling — programmatically to the end…
    const bottomReachable = await page.evaluate(() => {
      const body = document.querySelector('.lan-body');
      body.scrollTop = body.scrollHeight;
      const reached = body.scrollTop > 10;
      body.scrollTop = 0;
      return reached;
    });
    check('overflowing panel body scrolls to the bottom', bottomReachable);

    // …and under a real thumb: a drag upward must move the body.
    const cdp = await page.context().newCDPSession(page);
    const dispatch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((point, index) => ({
          x: Math.round(point.x),
          y: Math.round(point.y),
          id: point.id ?? index,
          radiusX: 8,
          radiusY: 8,
          force: 1,
        })),
      });
    // Start the drag inside the body but away from a control: a drag that
    // begins on a button answers a different question than "does the panel
    // scroll under a thumb".
    const bodyRect = await rectOf(page, '.lan-body');
    const x = Math.round(bodyRect.x + bodyRect.width - 8);
    const y0 = Math.round(bodyRect.y + bodyRect.height - 20);
    await dispatch('touchStart', [{ x, y: y0 }]);
    for (let step = 1; step <= 12; step++) {
      await dispatch('touchMove', [{ x, y: y0 - step * 12 }]);
      await page.waitForTimeout(16);
    }
    await dispatch('touchEnd', []);
    await page.waitForTimeout(300);
    const draggedTo = await page.evaluate(() => document.querySelector('.lan-body').scrollTop);
    report.touchScrollTop = Math.round(draggedTo);
    check(
      'touch drag scrolls the panel body',
      draggedTo > 10,
      `scrollTop ${report.touchScrollTop}`
    );
  } else {
    check('landscape panel fits outright', true, JSON.stringify(scroll));
  }
  await page.screenshot({ path: '/tmp/lan-lobby-landscape.png' });

  // -------------------------------------------- leaving disarms the URL
  const armed = await page.evaluate(() => window.location.search);
  check('hosting armed the URL', /net=host/.test(armed) && /room=/.test(armed), armed);
  await page.click('#lan-close');
  await page.waitForSelector('#play-btn', { timeout: 10_000 });
  const afterBack = await page.evaluate(() => window.location.search);
  report.searchAfterBack = afterBack;
  check(
    'Quay lại strips net/room, so Chơi means Chơi',
    !/[?&]net=/.test(afterBack) && !/[?&]room=/.test(afterBack),
    afterBack
  );
  check('and leaves the other params alone', /signal=/.test(afterBack), afterBack);

  // --------------------------------------------- the dead-broker degrade path
  //
  // Its own page load, on a port Chrome refuses outright. Two things have to
  // stay quiet: the room list says so in one line rather than throwing, and
  // pressing Vào keeps the player on this screen — the reported bug was that
  // it went straight to `GameScene`, which gave a host that had not started
  // fifteen seconds to answer and then died on a loading screen. With no
  // broker the wait cannot succeed, so what is measured is the pair that must
  // hold either way: no navigation, and a failure that lands back on usable
  // controls rather than a spinner nobody can leave.
  await openLobby(page, deadMenuUrl);
  await page.waitForTimeout(600); // one failed rooms poll -> unreachable line
  const unreachable = await page.evaluate(
    () => document.querySelector('.lan-empty')?.textContent?.trim() ?? ''
  );
  check(
    'dead broker degrades to one quiet line',
    unreachable.includes('Không kết nối được'),
    JSON.stringify(unreachable)
  );
  await page.fill('.lan-join-code input', 'ZZZZZ');
  await page.click('#lan-join');
  await page.waitForSelector('#lan-waiting, #lan-error', { timeout: 5_000 });
  const stillHere = await page.evaluate(() => !!document.querySelector('.lan-panel'));
  check('pressing Vào keeps the player on the lobby screen', stillHere);
  await page.waitForSelector('#lan-error', { timeout: 20_000 });
  const joinError = await page.evaluate(
    () => document.querySelector('#lan-error')?.textContent?.trim() ?? ''
  );
  report.joinError = joinError;
  check('a dead broker ends the wait with a readable line', joinError.length > 0, joinError);
  const armedAfterFail = await page.evaluate(() => window.location.search);
  check('a failed join disarms the URL again', !/[?&]net=/.test(armedAfterFail), armedAfterFail);

  // ------------------------------------------------------- portrait phone
  const { page: portrait } = await openPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    label: 'portrait',
  });
  await openLobbyHosting(portrait);
  const portraitFit = await portrait.evaluate(() => {
    const body = document.querySelector('.lan-body');
    const rect = document.querySelector('.lan-panel').getBoundingClientRect();
    return {
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      panelHeight: Math.round(rect.height),
      viewportHeight: window.innerHeight,
    };
  });
  report.portraitFit = portraitFit;
  check(
    'portrait phone fits without scrolling',
    portraitFit.bodyScrollHeight <= portraitFit.bodyClientHeight + 4,
    JSON.stringify(portraitFit)
  );
  await portrait.screenshot({ path: '/tmp/lan-lobby-portrait.png' });
});
