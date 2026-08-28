/**
 * A frozen match must not be the end of the session either.
 *
 * `GameScene.updateLoop` arms its next tick with
 * `window.setTimeout(() => this.updateLoop(), interval / 2)` at the *bottom*,
 * after `this.game.update()` — p5's own mistake (`verify-render-guard.mjs`) in
 * our code. Before `guardUpdate`, one throw inside `update()` did not cost a
 * tick, it cost every tick from then on.
 *
 * And it looked worse than a dead draw, because the draw chain is separate and
 * kept painting: the match froze with a canvas still redrawing the last good
 * frame and a HUD that still answered. Escape opened the settings modal
 * normally, and closing it called `resumeRuntime()` — which re-armed the chain,
 * so the match twitched forward a few ticks and stopped again. It read as a
 * hang. It was `VengefulSpirit_E` in the dota pack calling `addBuff` on its own
 * aura object.
 *
 * Vitest can prove the wrapper does not rethrow. What it cannot see is the part
 * that actually failed: the `setTimeout` chain, in a real browser, still
 * arriving after the game threw. So this breaks `update()` and counts ticks.
 *
 *   node tests/e2e/verify-update-guard.mjs
 */
import { startHarness, startMatch } from './harness.mjs';

const { url, page, report, check, errors, guard } = await startHarness();

/** `ObjectManager.update()` bumps this at the end of every simulation tick. */
const revision = () =>
  page.evaluate(() => window.__moba2d?.scene?.oScene?.game?.objectManager?.revision ?? 0);
/** How many times the loop has reached `game.update()`, crash or not. */
const calls = () => page.evaluate(() => window.__updateCalls ?? 0);
const settle = ms => page.waitForTimeout(ms);

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await settle(600);

  // 1. The match is ticking to begin with, or nothing below means anything.
  const before = await revision();
  await settle(500);
  const running = await revision();
  check('the match is ticking', running > before, `${before} -> ${running}`);

  // 2. Break it, at exactly the place a real spell crash lands: inside
  //    `game.update()`, which is what `runTick` wraps.
  await page.evaluate(() => {
    const game = window.__moba2d.scene.oScene.game;
    window.__realUpdate = game.update.bind(game);
    window.__updateCalls = 0;
    game.update = () => {
      window.__updateCalls++;
      throw new Error('e2e-forced-update-crash');
    };
  });
  await settle(800);

  // The tick chain re-arming is the whole property. Before the guard this was
  // exactly 1 — one throw, and the `setTimeout` at the bottom never ran again.
  const duringCrash = await calls();
  check(
    'the tick chain survives an update that throws every tick',
    duringCrash > 5,
    `${duringCrash} calls`
  );

  // 3. And the player, who cannot open a console, is told which half died.
  report.overlay = await page.evaluate(() => {
    const box = document.getElementById('render-crash');
    if (!box) return null;
    return {
      title: box.querySelector('strong')?.textContent ?? '',
      text: box.textContent?.slice(0, 160) ?? '',
      counted: Number(box.querySelector('[data-crash-count]')?.textContent ?? 0),
    };
  });
  check('the crash is put on the screen', report.overlay !== null);
  check(
    'it says the match tick died, not the renderer',
    report.overlay?.title === 'Lỗi khi cập nhật trận đấu',
    report.overlay?.title
  );
  check('it names the error', (report.overlay?.text ?? '').includes('e2e-forced-update-crash'));
  check('it counts the ticks that failed', (report.overlay?.counted ?? 0) > 1, `${report.overlay?.counted}`);

  // 4. Put it back: the match goes straight on simulating, because the chain
  //    was never broken in the first place.
  await page.evaluate(() => {
    window.__moba2d.scene.oScene.game.update = window.__realUpdate;
  });
  await settle(500);
  const recovered = await revision();
  check('the match resumes once the fault clears', recovered > running, `${running} -> ${recovered}`);

  report.ticks = { before, running, crashCalls: duringCrash, recovered };

  // Re-thrown out of band on purpose, exactly once however many ticks threw, so
  // a crash in update is still visible to `pageerror`.
  const forced = errors.filter(entry => entry.includes('e2e-forced-update-crash'));
  report.rethrown = forced.length;
  check('the first crash still reaches pageerror', forced.length === 1, `${forced.length}`);
});
