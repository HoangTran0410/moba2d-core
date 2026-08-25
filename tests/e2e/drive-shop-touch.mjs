/**
 * The shop, reached the only way a phone can reach it.
 *
 * Every other door is desktop-only: the gold pill and the six inventory tiles
 * live in `DesktopHudView`, which a phone does not render, and `P` is not a key
 * a thumb can press. So the corner button in `InGameHUD.vue` is not a
 * convenience — without it the shop is unreachable on the device this game is
 * most played on, and nothing in a unit test can see that.
 *
 * The gesture is a real CDP touch, not a click: `GameScene` calls
 * `preventDefault()` on every touch on the page, so the browser synthesises no
 * trailing `click` and a `@click`-only control is dead under a thumb while
 * being perfect under a mouse. That failure has shipped here three times.
 *
 *   node tests/e2e/drive-shop-touch.mjs /tmp/shoptouch
 */
import { startHarness, PHONE_VIEWPORT } from './harness.mjs';

const OUT = process.argv[2] ?? '/tmp/shoptouch';
const h = await startHarness({
  out: OUT,
  viewport: PHONE_VIEWPORT,
  hasTouch: true,
  touch: true,
  deviceScaleFactor: 3,
});
const { page, check, report, guard, tap } = h;

await guard(async () => {
  await page.goto(h.url, { waitUntil: 'load' });
  await page.click('#play-btn');
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  const bar = await page.locator('.bottom-HUD').count();
  check('no desktop strip on a phone', bar === 0, `${bar} strips`);

  const btn = page.locator('.shop-btn');
  check('the shop button is there', (await btn.count()) === 1, `${await btn.count()} buttons`);
  const lit = await page.locator('.shop-btn.at-shop').count();
  report.litAtFountain = lit;
  check('and it is lit at the fountain', lit === 1, `${lit} lit`);

  const box = await btn.boundingBox();
  report.buttonBox = box && {
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.width),
    h: Math.round(box.height),
  };
  // A thumb needs a real target. 40px is the CSS size; anything smaller here
  // would mean the rule that sets it is not the rule that won.
  check(
    'big enough for a thumb',
    box && box.width >= 38 && box.height >= 38,
    JSON.stringify(report.buttonBox)
  );

  await tap(box.x + box.width / 2, box.y + box.height / 2, 80);
  await page.waitForTimeout(400);
  const panel = await page.locator('.shop-panel').count();
  check('a tap opens the shop', panel === 1, `${panel} panels`);

  const panelBox = await page.locator('.shop-panel').boundingBox();
  report.panelBox = panelBox && {
    w: Math.round(panelBox.width),
    h: Math.round(panelBox.height),
    right: Math.round(panelBox.x + panelBox.width),
  };
  check(
    'the panel fits the viewport',
    panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= PHONE_VIEWPORT.width + 1,
    JSON.stringify(report.panelBox)
  );
  check(
    'and does not run off the bottom',
    panelBox && panelBox.y >= 0 && panelBox.y + panelBox.height <= PHONE_VIEWPORT.height + 1,
    JSON.stringify(report.panelBox)
  );

  await page.screenshot({ path: `${OUT}-phone.png` });
  check('no runtime errors', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
});
