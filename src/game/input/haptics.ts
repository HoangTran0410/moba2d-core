import { hapticsPreference, hapticsSupported } from './touchPreferences';
import { DEATH_SHAKE_TRAUMA } from '@/game/render/hitFeedback';

/**
 * The thumb's half of "a hit you can feel".
 *
 * Everything here keys off the same *trauma* scalar the camera shake reads
 * (`render/hitFeedback.ts`), so the eye and the hand always agree about how
 * hard a hit was, and there is one table to tune rather than two. The pattern
 * is chosen by what happened, not only how hard: a kill is two short taps, a
 * death one long shudder, a hit a single pulse scaled to the bite — three
 * shapes a thumb can tell apart without looking.
 *
 * `navigator.vibrate` is fire-and-forget and a new call replaces the old, so
 * nothing here queues or throttles: under a burst the latest hit wins, which
 * is also what the eye sees.
 */
export type FeedbackKind = 'hit' | 'kill' | 'death';

/** Below this trauma a hit does not reach the hand — chip damage stays silent, as it does for the camera. */
const HAPTIC_MIN_TRAUMA = 0.1;
const HAPTIC_HIT_MAX_MS = 60;
const HAPTIC_KILL_PATTERN: readonly number[] = [15, 40, 15];
const HAPTIC_DEATH_PATTERN: readonly number[] = [90, 60, 140];

/** The vibration for an event, or `null` when it should not be felt at all. */
export const hapticPattern = (kind: FeedbackKind, trauma: number): readonly number[] | null => {
  switch (kind) {
    case 'kill':
      return HAPTIC_KILL_PATTERN;
    case 'death':
      return HAPTIC_DEATH_PATTERN;
    default: {
      if (!(trauma >= HAPTIC_MIN_TRAUMA)) return null;
      const share = Math.min(1, trauma / DEATH_SHAKE_TRAUMA);
      return [Math.round(HAPTIC_HIT_MAX_MS * share)];
    }
  }
};

/**
 * Buzz, if this device can and the player has not said no. A single number
 * is passed through as a number — a button pulse is `vibrate(10)` — because
 * that is the shape the touch layer's own test pins.
 */
export function vibrate(pattern: number | readonly number[]): void {
  try {
    if (!hapticsSupported() || !hapticsPreference()) return;
    navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    // Vibration is optional and may be denied by the browser or device policy.
  }
}

/** The thumb's answer to a hit, kill or death worth `trauma` on the camera. */
export function feelHaptic(kind: FeedbackKind, trauma: number): void {
  const pattern = hapticPattern(kind, trauma);
  if (pattern) vibrate(pattern);
}
