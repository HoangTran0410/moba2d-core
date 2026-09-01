/**
 * Does one second of wall time buy one second of game time?
 *
 * The simulation keeps a fixed 60Hz clock of its own (`GameScene.updateLoop`)
 * while the renderer runs free, and eighty-two places inside the simulation
 * read `deltaTime` — which is p5's **render** delta. At 60 render / 60 tick the
 * two numbers agree and nothing looks wrong, so this cannot be seen by reading
 * either loop; it needs the two clocks measured against each other under
 * settings a player can actually choose.
 *
 * `Game.matchTimeMs` is the probe: it is advanced once per tick, so its rate
 * against `performance.now()` *is* the game's speed. What this found, before
 * `src/game/simulationClock.ts` existed:
 *
 *     renderFps 60, throttle 1x    speed 1.001
 *     renderFps 30, throttle 1x    speed 1.999   <- the FPS cap doubled the game
 *     renderFps 60, throttle 16x   speed 0.972
 *
 * The setting offered *for* a weak machine ran the whole match at double speed,
 * and a machine struggling under load ran it in slow motion by the same
 * arithmetic. Every row should now read 1.00.
 *
 *   node tests/e2e/measure-sim-clock.mjs
 */
import { startHarness, startMatch } from './harness.mjs';

/** How long each arm is sampled for. Long enough that timer jitter averages out. */
const WINDOW_MS = Number(process.env.MOBA2D_WINDOW_MS ?? 4_000);

/** How far a row may sit from real time before it is called a failure. */
const SPEED_TOLERANCE = 0.06;

const ARMS = [
  { label: 'renderFps 60, throttle 1x', renderFps: 60, throttle: 1 },
  { label: 'renderFps 30, throttle 1x', renderFps: 30, throttle: 1 },
  { label: 'renderFps 60, throttle 6x', renderFps: 60, throttle: 6 },
  { label: 'renderFps 60, throttle 16x', renderFps: 60, throttle: 16 },
  { label: 'renderFps 30, throttle 6x', renderFps: 30, throttle: 6 },
];

const { url, page, report, check, guard } = await startHarness();

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__moba2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);

  const cdp = await page.context().newCDPSession(page);

  for (const { label, renderFps, throttle } of ARMS) {
    await page.evaluate(fps => window.__moba2d.scene.oScene.game.setRenderFps(fps), renderFps);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    // Let the new frame rate settle before the window opens, or the first
    // sample carries the old cap's deltas.
    await page.waitForTimeout(800);

    const row = await page.evaluate(async windowMs => {
      const game = window.__moba2d.scene.oScene.game;
      const proto = Object.getPrototypeOf(game);
      const realDraw = proto.draw;
      const realTick = proto.fixedUpdate;
      let frames = 0;
      let ticks = 0;
      proto.draw = function (...args) {
        frames++;
        return realDraw.apply(this, args);
      };
      proto.fixedUpdate = function (...args) {
        ticks++;
        return realTick.apply(this, args);
      };

      const startedAt = performance.now();
      const startedGame = game.matchTimeMs;
      await new Promise(resolve => setTimeout(resolve, windowMs));
      const wall = performance.now() - startedAt;
      const gameMs = game.matchTimeMs - startedGame;

      proto.draw = realDraw;
      proto.fixedUpdate = realTick;

      return {
        speed: Number((gameMs / wall).toFixed(3)),
        fps: Number(((frames * 1000) / wall).toFixed(1)),
        tickRate: Number(((ticks * 1000) / wall).toFixed(1)),
      };
    }, WINDOW_MS);

    report[label] = row;
    check(
      label,
      Math.abs(row.speed - 1) <= SPEED_TOLERANCE,
      `speed ${row.speed}, fps ${row.fps}, tick ${row.tickRate}`
    );
  }

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.evaluate(() => window.__moba2d.scene.oScene.game.setRenderFps(60));
});
