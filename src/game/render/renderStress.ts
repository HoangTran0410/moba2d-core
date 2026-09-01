/**
 * Whether the machine is keeping up — and it takes rather more than one bad
 * frame to say so.
 *
 * ## What the first version got wrong
 *
 * It compared one smoothed reading against two thresholds and flipped on the
 * spot: below 83% of target, degrade; back above 95%, restore. Reported from a
 * real match on an M4 Pro, which is not a machine that struggles: automatic
 * quality dropped anyway and did not come back.
 *
 * Traced on the shipped build (`tests/e2e/`-style probe, idle match, one
 * deliberate 900ms hitch):
 *
 *     idle            displayFps 58.5 - 60.6, worst frame 24ms every sample
 *     after a hitch   displayFps 54.2
 *
 * Two things fall out of that and both were fatal. A healthy machine's *normal*
 * band already dips to 58.5, and a single hitch drops the average to 54.2 —
 * which is **below the 57 the old rule needed to restore quality**. So one
 * hiccup could park it in the degraded state, and every later hiccup parked it
 * again before the average had climbed out. Worse, the worst frame at idle is a
 * routine 24ms, so anything reading `displayLow` would have called this machine
 * stressed forever.
 *
 * ## What it takes now
 *
 * Time, in both directions. A machine has to stay under the floor
 * *continuously* for `STRESS_ENTER_SUSTAIN_MS` before anything is given up, and
 * back over the ceiling for `STRESS_LEAVE_SUSTAIN_MS` before it is handed back.
 * A single hitch — the case that actually happens — moves neither, because the
 * counter it feeds is reset by the very next healthy frame.
 *
 * The band is wider too, and deliberately placed outside the measured jitter: a
 * machine holding 48fps of a 60 target is not degraded at all. That is the
 * point. Degrading is a visible thing to do to somebody's screen, and 48fps is
 * playable where guessing wrong is not.
 */

/** Below this share of the target, and only while it lasts, start cutting. */
export const STRESS_ENTER_SHARE = 0.75;

/** Back above this share, and only while it lasts, stop cutting. */
export const STRESS_LEAVE_SHARE = 0.88;

/**
 * How long the rate has to stay under the floor before anything is given up.
 *
 * Long enough that no single stall reaches it: the measured hitch above cost
 * one frame and the average was back inside a few hundred ms.
 */
export const STRESS_ENTER_SUSTAIN_MS = 1_500;

/**
 * And how long it has to stay over the ceiling before quality comes back.
 *
 * Shorter than the entry window on purpose. The two errors are not equal —
 * degrading a machine that was fine costs the player information they need,
 * and restoring one that is still struggling costs a few dropped frames.
 */
export const STRESS_LEAVE_SUSTAIN_MS = 800;

/** The running state. `Game` holds one and reads `stressed` off it. */
export interface RenderStress {
  stressed: boolean;
  /** ms spent continuously under the floor, or over the ceiling. */
  belowMs: number;
  aboveMs: number;
}

export const freshRenderStress = (): RenderStress => ({
  stressed: false,
  belowMs: 0,
  aboveMs: 0,
});

/**
 * Advances the state by one frame.
 *
 * Deliberately total: a target of zero, a `NaN` from a first frame with no
 * measurable delta, or a meter that has not published yet all return the state
 * untouched rather than inventing one.
 */
export function nextStressState(
  state: RenderStress,
  fps: number,
  targetFps: number,
  elapsedMs: number
): RenderStress {
  if (
    !Number.isFinite(fps) ||
    !Number.isFinite(targetFps) ||
    !Number.isFinite(elapsedMs) ||
    fps <= 0 ||
    targetFps <= 0 ||
    elapsedMs < 0
  ) {
    return state;
  }

  const share = fps / targetFps;

  if (share < STRESS_ENTER_SHARE) {
    const belowMs = state.belowMs + elapsedMs;
    if (!state.stressed && belowMs >= STRESS_ENTER_SUSTAIN_MS) {
      return { stressed: true, belowMs: 0, aboveMs: 0 };
    }
    return { stressed: state.stressed, belowMs, aboveMs: 0 };
  }

  if (share > STRESS_LEAVE_SHARE) {
    const aboveMs = state.aboveMs + elapsedMs;
    if (state.stressed && aboveMs >= STRESS_LEAVE_SUSTAIN_MS) {
      return { stressed: false, belowMs: 0, aboveMs: 0 };
    }
    return { stressed: state.stressed, belowMs: 0, aboveMs };
  }

  // Between the two: neither a machine in trouble nor one clearly out of it.
  // Both counters reset, so a rate wandering across a threshold accumulates
  // nothing — only a *sustained* stretch on one side of the band moves this.
  return { stressed: state.stressed, belowMs: 0, aboveMs: 0 };
}
