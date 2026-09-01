/**
 * Whether the machine is keeping up, as one boolean with hysteresis.
 *
 * ## What `auto` used to mean
 *
 * `ObjectManager.draw`'s quality branch read exactly one thing to decide
 * whether to ration particles or draw units compactly: `game.touchUi`. So
 * "automatic" meant "are you on a phone" — a weak laptop, an old desktop, or a
 * phone that had switched to the pointer HUD got the full-quality path however
 * badly it was coping, and the only way out was for the player to find the
 * quality dropdown and choose Thấp themselves.
 *
 * Meanwhile `FpsMeter` — allocation-free, already smoothing, already tracking
 * the *worst* frame rather than just the mean — was sitting behind the `fps`
 * debug flag and not even being sampled unless a developer turned the readout
 * on. The measurement the decision needed already existed; nothing was asking
 * it anything.
 *
 * ## Against the target, not against 60
 *
 * The thresholds are fractions of whatever the player asked for, because
 * choosing the 30 FPS cap is not the same as failing to reach 60. A machine
 * holding a rock-solid 30 under a 30 cap is not stressed and must not be
 * degraded for it; the same 30 under a 60 cap is missing every other frame.
 *
 * ## Why two thresholds
 *
 * One would oscillate. Degrading raises the frame rate, which clears the
 * condition, which restores the quality, which drops the frame rate — at best a
 * visible flutter of particles appearing and vanishing, at worst a machine
 * spending its whole match on the boundary doing both. Entering at 83% of
 * target and leaving at 95% means the recovery has to be real before the
 * quality comes back.
 */

/** Below this share of the target frame rate, start cutting. */
export const STRESS_ENTER_SHARE = 0.83;

/** Back above this share, and only then, stop cutting. */
export const STRESS_LEAVE_SHARE = 0.95;

/**
 * The next state of the "this machine is struggling" flag.
 *
 * Deliberately total: a target of zero, a `NaN` from a first frame with no
 * measurable delta, or a meter that has not published yet all return the state
 * unchanged rather than inventing one. A quality drop is a visible thing to do
 * to somebody's screen, and doing it because of a divide by zero would be worse
 * than never doing it at all.
 */
export function nextStressState(stressed: boolean, fps: number, targetFps: number): boolean {
  if (!Number.isFinite(fps) || !Number.isFinite(targetFps) || fps <= 0 || targetFps <= 0) {
    return stressed;
  }
  const share = fps / targetFps;
  return stressed ? share < STRESS_LEAVE_SHARE : share < STRESS_ENTER_SHARE;
}
