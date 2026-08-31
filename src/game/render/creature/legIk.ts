/**
 * Two-bone inverse kinematics: given where a leg starts and where its foot is,
 * where does the knee go.
 *
 * Deliberately a free function over numbers rather than a method on anything.
 * It has to run in three places — the game (p5), the map editor (Canvas2D) and
 * vitest (no canvas at all) — so it knows about none of them.
 *
 * **Every degenerate case returns a finite point.** The law of cosines hands
 * back `NaN` for a target the leg cannot reach, and a `NaN` coordinate does not
 * throw: `line()` simply draws nothing, so the failure looks like a leg that is
 * missing rather than like a bug. The three guards below are the whole reason
 * this is its own file with its own test.
 */

export interface Joint {
  x: number;
  y: number;
}

/**
 * @param bend Which of the two mirror solutions to take, `1` or `-1`. Both are
 *   equally valid knees; the caller picks the one that reads as a leg rather
 *   than as a leg on backwards — see `legRig.ts`, which mirrors it per side.
 */
export function solveTwoBone(
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  upper: number,
  lower: number,
  bend: number
): Joint {
  const dx = footX - hipX;
  const dy = footY - hipY;
  const distance = Math.hypot(dx, dy);

  // A foot exactly on its own hip has no direction to extend along. Any
  // direction is as wrong as any other, so take one rather than divide by zero.
  if (distance < 1e-6) return { x: hipX + upper, y: hipY };

  const ux = dx / distance;
  const uy = dy / distance;

  // Too far to reach, or too close to fold around: both are a straight leg
  // pointing at the target, which is what a real limb does at either limit.
  if (distance >= upper + lower || distance <= Math.abs(upper - lower)) {
    return { x: hipX + ux * upper, y: hipY + uy * upper };
  }

  // How far along the hip->foot line the knee's projection sits, and how far
  // off that line it stands. `max(0, …)` because floating point can put the
  // radicand a hair below zero at the exact limits the branch above just
  // excluded, and `Math.sqrt(-1e-17)` is `NaN`.
  const along = (distance * distance + upper * upper - lower * lower) / (2 * distance);
  const off = Math.sqrt(Math.max(0, upper * upper - along * along));

  return {
    x: hipX + ux * along - uy * off * bend,
    y: hipY + uy * along + ux * off * bend,
  };
}
