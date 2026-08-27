/**
 * The LAN lobby's layout, held to the menu's own rhythm — the report that
 * found this: an expanded panel wider and taller than every real menu
 * button, an orphaned "Vào" with no visible input, and a landscape phone
 * whose menu column overflowed a scroll-less screen.
 *
 * Asserts, at a landscape phone viewport (844×390, real touch):
 *   - the expanded panel is no wider than Cấu Hình Trận Đấu, and every
 *     button inside it shares the menu buttons' height;
 *   - the code input and its Vào button sit on one row, input visibly wide;
 *   - the broker-unreachable state is one quiet line (the probe points
 *     `?signal=` at a dead port on purpose — which also keeps this script
 *     offline-runnable and covers the degrade path);
 *   - the menu column either fits or actually scrolls — programmatically
 *     *and* under a real touch drag, because `GameScene`-era preventDefault
 *     habits have killed thumb-scrolling here before;
 *   - nothing overflows horizontally.
 * Then the same panel at a portrait phone (390×844) must fit outright.
 *
 * No zero-console-errors check on purpose: the dead signal port logs a
 * failed fetch, and that failure being *quiet in the UI* is the assertion.
 */
import { startHarness, PHONE_VIEWPORT } from './harness.mjs';

const { url, page, report, check, guard, openPage } = await startHarness({
  viewport: PHONE_VIEWPORT,
  hasTouch: true,
  deviceScaleFactor: 2,
  out: '/tmp/lan-lobby',
});

const DEAD_SIGNAL = 'ws://localhost:9';
const menuUrl = `${url}${url.includes('?') ? '&' : '?'}signal=${DEAD_SIGNAL}`;

const openLobby = async targetPage => {
  await targetPage.goto(menuUrl, { waitUntil: 'load' });
  await targetPage.waitForSelector('#lan-btn', { timeout: 60_000 });
  await targetPage.click('#lan-btn');
  await targetPage.waitForSelector('#lan-box', { timeout: 5_000 });
  // Host once too, so the panel shows its fullest (code button) state.
  await targetPage.click('#lan-host');
  await targetPage.waitForSelector('#lan-start-host', { timeout: 5_000 });
  await targetPage.waitForTimeout(600); // one failed rooms poll -> unreachable line
};

const rectOf = (targetPage, selector) =>
  targetPage.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);

await guard(async () => {
  // ------------------------------------------------ landscape phone, touch
  await openLobby(page);

  const configRect = await rectOf(page, '#config-btn');
  const boxRect = await rectOf(page, '#lan-box');
  const hostBtnRect = await rectOf(page, '#lan-start-host');
  report.configWidth = Math.round(configRect.width);
  report.lanBoxWidth = Math.round(boxRect.width);
  report.lanHostButton = { w: Math.round(hostBtnRect.width), h: Math.round(hostBtnRect.height) };
  check(
    'panel no wider than Cấu Hình Trận Đấu',
    boxRect.width <= configRect.width + 2,
    `${report.lanBoxWidth} vs ${report.configWidth}`
  );
  check(
    'panel buttons share the menu button height',
    Math.abs(hostBtnRect.height - configRect.height) <= 2,
    `${Math.round(hostBtnRect.height)} vs ${Math.round(configRect.height)}`
  );
  check(
    'panel buttons no wider than the menu buttons',
    hostBtnRect.width <= configRect.width + 2,
    `${report.lanHostButton.w}`
  );

  const inputRect = await rectOf(page, '.lan-join-code input');
  const joinBtnRect = await rectOf(page, '.lan-join-code button');
  const sameRow =
    inputRect &&
    joinBtnRect &&
    Math.abs(inputRect.y + inputRect.height / 2 - (joinBtnRect.y + joinBtnRect.height / 2)) <= 2;
  check('code input and Vào share one row', !!sameRow, JSON.stringify({ inputRect, joinBtnRect }));
  check('code input is visibly wide', inputRect.width >= 80, `${Math.round(inputRect.width)}px`);

  const unreachable = await page.evaluate(
    () => document.querySelector('.lan-empty')?.textContent?.trim() ?? ''
  );
  check(
    'dead broker degrades to one quiet line',
    unreachable.includes('Không kết nối được'),
    JSON.stringify(unreachable)
  );

  // --------------------------------------------------------- overflow story
  const scroll = await page.evaluate(() => {
    const menu = document.querySelector('#menu-scene');
    return {
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
      scrollWidth: menu.scrollWidth,
      clientWidth: menu.clientWidth,
    };
  });
  report.landscapeScroll = scroll;
  check(
    'no horizontal overflow',
    scroll.scrollWidth <= scroll.clientWidth + 1,
    JSON.stringify(scroll)
  );

  if (scroll.scrollHeight > scroll.clientHeight + 4) {
    // Must be reachable by scrolling — programmatically to the end…
    const bottomReachable = await page.evaluate(() => {
      const menu = document.querySelector('#menu-scene');
      menu.scrollTop = menu.scrollHeight;
      const about = document.querySelector('#about-btn').getBoundingClientRect();
      const reached = about.bottom <= window.innerHeight + 1;
      menu.scrollTop = 0;
      return reached;
    });
    check('overflowing column scrolls to the bottom', bottomReachable);

    // …and under a real thumb: a drag upward must move the column.
    const { touchStart, touchMove, touchEnd } = await (async () => {
      // Harness exposes the CDP touch trio on the main page only; recreate a
      // small drag with the page's own CDP session.
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
      return {
        touchStart: points => dispatch('touchStart', points),
        touchMove: points => dispatch('touchMove', points),
        touchEnd: () => dispatch('touchEnd', []),
      };
    })();
    // Drag on open background at the left edge — a drag that starts on a
    // lobby control answers a different question than "does the column
    // scroll under a thumb".
    const x = 60;
    await touchStart([{ x, y: 320 }]);
    for (let step = 1; step <= 12; step++) {
      await touchMove([{ x, y: 320 - step * 22 }]);
      await page.waitForTimeout(16);
    }
    await touchEnd();
    await page.waitForTimeout(300);
    const draggedTo = await page.evaluate(() => document.querySelector('#menu-scene').scrollTop);
    report.touchScrollTop = Math.round(draggedTo);
    check('touch drag scrolls the menu', draggedTo > 10, `scrollTop ${report.touchScrollTop}`);
  } else {
    check('landscape column fits outright', true, JSON.stringify(scroll));
  }
  await page.screenshot({ path: '/tmp/lan-lobby-landscape.png' });

  // ------------------------------------------------------- portrait phone
  const { page: portrait } = await openPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    label: 'portrait',
  });
  await openLobby(portrait);
  const portraitScroll = await portrait.evaluate(() => {
    const menu = document.querySelector('#menu-scene');
    return { scrollHeight: menu.scrollHeight, clientHeight: menu.clientHeight };
  });
  report.portraitScroll = portraitScroll;
  check(
    'portrait phone fits without scrolling',
    portraitScroll.scrollHeight <= portraitScroll.clientHeight + 4,
    JSON.stringify(portraitScroll)
  );
  await portrait.screenshot({ path: '/tmp/lan-lobby-portrait.png' });
});
