/**
 * Does the global error reporter actually reach a screen in a real browser?
 *
 * `tests/managers/RenderGuard.test.ts` drives `installGlobalErrorReporter`
 * through an injected event source, because core's suite runs on
 * `environment: 'node'`. That proves the bookkeeping and proves nothing about
 * the wiring: whether `main.ts` installs it at all, whether the listeners are
 * on the real `window`, and whether the overlay lands in the real DOM. This is
 * that other half, and it is the only place it can be asked.
 *
 *   node tests/e2e/verify-global-error-overlay.mjs
 */
import { startHarness } from './harness.mjs';

const { page, url, check, report, guard } = await startHarness();

await guard(async () => {
  await page.goto(url);
  await page.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 20_000 });

  // Neither loop is involved: this is a throw from a timer, which is exactly
  // the case the two loop guards cannot see.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('a throw from a timer, in neither loop');
    }, 0);
  });

  const overlay = page.locator('#render-crash');
  await overlay.waitFor({ state: 'visible', timeout: 5_000 });

  report.title = await overlay.locator('strong').innerText();
  report.message = await overlay.locator('div').first().innerText();
  report.hasReloadButton = (await overlay.locator('button').count()) === 1;

  check('the overlay is on screen', await overlay.isVisible());
  check('it says what broke', report.message.includes('in neither loop'), report.message);
  check('it offers a way out', report.hasReloadButton);

  // The canvas must still be there: reporting is not the same as dying, and an
  // overlay that replaced the game would be a worse bug than the one it reports.
  check('the game is still on screen behind it', await page.locator('canvas').isVisible());
});
