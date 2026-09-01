/**
 * The simulation's own clock.
 *
 * `render/Interpolation.ts` explains why the two loops are deliberately kept
 * apart: a fixed 60Hz simulation so movement, collision and cooldowns are
 * identical on every machine, and a free render loop so the picture may drop
 * on a slow one. This file is the half of that promise the simulation has to
 * keep, and until now did not.
 *
 * ## What was actually happening
 *
 * Eighty-two places inside the simulation read `deltaTime` — the **p5 global**,
 * which is the time between two *rendered frames*. The tick loop is a
 * `setTimeout` of its own and never touched it. At 60 render / 60 tick the two
 * numbers agree, so nothing looked wrong; the moment they diverge, game speed
 * becomes `tickRate × (1000 / renderFps)` instead of real time.
 *
 * Measured on the shipped build (`tests/e2e/measure-sim-clock.mjs`):
 *
 * | setting | game seconds per real second |
 * |---|---|
 * | 60 FPS, no throttle | 1.00 |
 * | **30 FPS**, no throttle | **2.00** |
 * | 60 FPS, 6x CPU throttle | 0.99 |
 * | 30 FPS, 6x CPU throttle | 2.00 |
 *
 * The FPS cap offered *for* weak machines made the entire game run at double
 * speed — every cooldown, every dash, every minion wave — and a machine
 * struggling under load ran it in slow motion by the same arithmetic.
 *
 * ## The fix
 *
 * A tick advances by exactly one step, whatever the renderer is doing. Rather
 * than thread a `stepMs` argument through eighty-two call sites (and be one
 * missed site away from the same bug), the global those sites already read is
 * *substituted* for the duration of the tick and put back afterwards — the same
 * shape as `ObjectManager.draw`'s position swap, and for the same reason: no
 * caller has to know it happens. Draw-time code keeps p5's real frame delta,
 * which is the right clock for an animation.
 */

/**
 * Runs `body` with the p5 global `deltaTime` fixed to the simulation's step.
 *
 * Restores through a throw. A tick that dies half way through has already
 * broken the frame; leaving the global pinned would additionally freeze every
 * animation in the *draw* loop, which is how one bad tick would have become a
 * permanently wrong-looking game.
 */
export function withSimulationStep<T>(stepMs: number, body: () => T): T {
  const scope = globalThis as { deltaTime?: number };
  const rendered = scope.deltaTime;
  scope.deltaTime = stepMs;
  try {
    return body();
  } finally {
    scope.deltaTime = rendered;
  }
}

/**
 * How many steps one hitch may repay.
 *
 * The tick loop polls; when a long frame, a GC pause or a tab regaining focus
 * costs several steps, the loop used to run exactly one and silently drop the
 * rest, which is a permanent loss of game time. Running *all* of them is worse:
 * on a machine that is already behind, catch-up is the thing that turns a
 * stutter into a freeze (the classic spiral of death).
 *
 * Three is the standard compromise — enough to absorb a hitch of ~50ms, few
 * enough that a machine which genuinely cannot keep up degrades into honest
 * slow motion instead of locking up.
 */
export const MAX_CATCHUP_STEPS = 3;

/**
 * The tick loop's decision, as arithmetic rather than as a branch inside a
 * timer callback: given the time since the last tick, how many steps to run and
 * how far the notional tick clock moves.
 *
 * `advanceMs` intentionally counts the steps that were *dropped* as well as the
 * ones that ran. The clock has to stay pinned to wall time, or a scene that
 * fell far behind would keep firing catch-up batches forever, each one landing
 * later than the last; and `GameScene.draw` reads the same clock to work out
 * how far into the current step the renderer is, so letting it drift would
 * spread the error into the interpolation as well.
 */
export function stepsToRun(
  elapsedMs: number,
  intervalMs: number
): { run: number; advanceMs: number } {
  if (!(intervalMs > 0) || !Number.isFinite(elapsedMs) || elapsedMs < intervalMs) {
    return { run: 0, advanceMs: 0 };
  }
  const due = Math.floor(elapsedMs / intervalMs);
  return { run: Math.min(due, MAX_CATCHUP_STEPS), advanceMs: due * intervalMs };
}
