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
 * And a second rung, for a machine that is not merely late but drowning.
 *
 * ## Why one rung was not enough
 *
 * The first rung was doing almost nothing. Profiled at 10x CPU throttle in a
 * ten-champion fight — 15.5fps, a 34ms frame — everything `stressed` gives up
 * came to **1.2ms of that 34ms**: the particle ration and the trail collapse.
 * Three and a half percent. The machine was correctly identified as struggling
 * and then handed a rounding error.
 *
 * The reason is not that the cuts are wrong, it is that only two places in the
 * whole renderer ever asked. So the answer is more askers — and once the
 * minimap, the combat text and the fight's own crowd are giving things up, one
 * rung is too blunt: a machine at 34fps and a machine at 15fps are not in the
 * same trouble and should not lose the same things.
 *
 * ## Where the line is
 *
 * Measured, not picked. The same fight at three throttles:
 *
 *     4x   56.6 fps   share 0.94   healthy, touch nothing
 *     6x   34.5 fps   share 0.58   late — the first rung
 *     10x  15.5 fps   share 0.26   drowning — the second
 *
 * 0.45 of target (27fps at a 60 cap) sits in the gap between those two
 * machines with room on both sides. The leave share keeps the same hysteresis
 * the first rung uses, and its consequence is deliberate: a machine that the
 * deep cuts have lifted from 15fps to 30fps reads 0.5 — above the entry, below
 * the exit — so it **stays** simplified. That is the right answer. The cuts are
 * why it is at 30, and handing them back would put it at 15 again.
 */
export const STRESS_DEEP_ENTER_SHARE = 0.45;

/** Back above this share, and only while it lasts, stop cutting *deeply*. */
export const STRESS_DEEP_LEAVE_SHARE = 0.58;

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

/** The running state. `Game` holds one and reads the two flags off it. */
export interface RenderStress {
  stressed: boolean;
  /**
   * The second rung — see `STRESS_DEEP_ENTER_SHARE`. Always implies `stressed`:
   * a machine cannot be drowning without also being late, and the two gates
   * cannot disagree because the deep floor is below the shallow one.
   */
  deeplyStressed: boolean;
  /** ms spent continuously under the floor, or over the ceiling. */
  belowMs: number;
  aboveMs: number;
  /** The same two clocks for the deep rung, which has its own band. */
  deepBelowMs: number;
  deepAboveMs: number;
}

export const freshRenderStress = (): RenderStress => ({
  stressed: false,
  deeplyStressed: false,
  belowMs: 0,
  aboveMs: 0,
  deepBelowMs: 0,
  deepAboveMs: 0,
});

/**
 * One rung, advanced by one frame.
 *
 * Both rungs are the same rule against different numbers, so they are the same
 * code against different numbers — a second hand-written copy of a state
 * machine this carefully argued is how the two quietly stop agreeing.
 */
function advanceGate(
  on: boolean,
  belowMs: number,
  aboveMs: number,
  share: number,
  enterShare: number,
  leaveShare: number,
  elapsedMs: number
): { on: boolean; belowMs: number; aboveMs: number } {
  if (share < enterShare) {
    const next = belowMs + elapsedMs;
    if (!on && next >= STRESS_ENTER_SUSTAIN_MS) return { on: true, belowMs: 0, aboveMs: 0 };
    return { on, belowMs: next, aboveMs: 0 };
  }
  if (share > leaveShare) {
    const next = aboveMs + elapsedMs;
    if (on && next >= STRESS_LEAVE_SUSTAIN_MS) return { on: false, belowMs: 0, aboveMs: 0 };
    return { on, belowMs: 0, aboveMs: next };
  }
  // Between the two: neither a machine in trouble nor one clearly out of it.
  // Both counters reset, so a rate wandering across a threshold accumulates
  // nothing — only a *sustained* stretch on one side of the band moves this.
  return { on, belowMs: 0, aboveMs: 0 };
}

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

  const shallow = advanceGate(
    state.stressed,
    state.belowMs,
    state.aboveMs,
    share,
    STRESS_ENTER_SHARE,
    STRESS_LEAVE_SHARE,
    elapsedMs
  );
  const deep = advanceGate(
    state.deeplyStressed,
    state.deepBelowMs,
    state.deepAboveMs,
    share,
    STRESS_DEEP_ENTER_SHARE,
    STRESS_DEEP_LEAVE_SHARE,
    elapsedMs
  );

  return {
    stressed: shallow.on,
    // The floors are ordered, so a rate under the deep floor is under the
    // shallow one too and the shallow gate is already on by the time this can
    // be. Stated anyway rather than relied on: every reader of `deeplyStressed`
    // is entitled to assume it implies the rung below it, and one day somebody
    // will move a threshold.
    deeplyStressed: deep.on && shallow.on,
    belowMs: shallow.belowMs,
    aboveMs: shallow.aboveMs,
    deepBelowMs: deep.belowMs,
    deepAboveMs: deep.aboveMs,
  };
}

/**
 * How much the renderer is allowed to give up: the player's choice and the
 * measurement, resolved into one number.
 *
 * One function because the rule was about to exist in four places — the draw
 * pass, the fog, the minimap and the combat text — and four copies of "low, or
 * auto and the flag" is how they quietly stop agreeing about what Cao means.
 *
 *   0  draw everything
 *   1  the machine is late: decoration goes
 *   2  the machine is drowning: the fight itself gets simpler
 *
 * Two asymmetries are deliberate. **Cao is never overridden** — a player who
 * chose it is overriding the measurement on purpose, and a measurement must not
 * override them back. **Thấp goes straight to 2** — asking for low quality is
 * asking for all of it, not for the middle of it.
 *
 * What this does *not* decide is `compactUnits`. Compact art answers a question
 * about size — is this body twelve screen pixels wide, on a phone, in a crowd —
 * and it takes away health numbers and buff icons, which a late frame is not a
 * reason to do. See `ObjectManager.draw`, which keeps that branch separate.
 */
export function stressTier(
  quality: 'auto' | 'low' | 'high' | undefined,
  stressed: boolean | undefined,
  deeplyStressed: boolean | undefined
): 0 | 1 | 2 {
  if (quality === 'high') return 0;
  if (quality === 'low') return 2;
  if (deeplyStressed === true) return 2;
  return stressed === true ? 1 : 0;
}
