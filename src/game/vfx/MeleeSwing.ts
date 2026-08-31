/**
 * The one melee swing, drawn once.
 *
 * A champion's swing and a minion's were two hand-rolled copies of the same
 * picture — same wind-up glow behind the body, same filled fan sweeping past
 * it, same fade — and they had already drifted: the minion's strike carried a
 * white leading arc and the champion's did not, so the same act read as two
 * effects depending on who did it. Nobody chose that; it is what two copies do.
 *
 * A camp's claw is deliberately **not** this (`monsterAttacks.ts` explains
 * why): three separate arcs on a 100px body is a legibility decision about
 * bodies that big, taken on purpose. This covers the two that were meant to
 * match.
 *
 * **Locals are named for what they mean in the drawing.** `fill`, `stroke`,
 * `line` and `color` are p5 globals in global mode and a local that shadows one
 * turns the call that closes the block into a call on a number.
 */

/** How wide the fan opens either side of the aim line, radians. */
const HALF_ANGLE = 0.61;

/** Segments across the fan. Enough to read as an arc, few enough to be free. */
const SEGMENTS = 5;

export interface MeleeSwingStyle {
  /** Half the attacker's body, world units — where the fan starts. */
  bodyRadius: number;
  /** Surface-to-surface reach of the swing, world units. */
  reach: number;
  color: number[];
}

/**
 * The beat of stillness before the swing releases: a glow gathering behind the
 * attacker, brightening as it charges.
 *
 * Behind, not in front, and that is the whole read — the arm draws back, so the
 * telegraph moves *away* from the target it is about to reach.
 */
export function drawMeleeWindup(style: MeleeSwingStyle, charge: number) {
  const [red, green, blue] = style.color;
  push();
  noStroke();
  fill(red, green, blue, 60 + 120 * charge);
  circle(-style.bodyRadius * 0.55, 0, 6 + 9 * charge);
  pop();
}

/**
 * The swing itself: a fan sweeping out past the body, fading as it goes, with
 * a bright leading edge on its outer rim.
 *
 * Both are drawn in the attacker's own rotated frame — the caller has already
 * `translate`d to the body and `rotate`d to the aim — so this is the same
 * picture whichever way the swing points.
 */
export function drawMeleeStrike(style: MeleeSwingStyle, swept: number) {
  const [red, green, blue] = style.color;
  const fade = 1 - swept;
  const inner = style.bodyRadius * 0.62;
  const outer = style.bodyRadius + style.reach * 0.9;

  push();
  noStroke();
  fill(red, green, blue, 205 * fade);
  beginShape();
  for (let i = 0; i <= SEGMENTS; i++) {
    const along = -HALF_ANGLE + 2 * HALF_ANGLE * (i / SEGMENTS);
    vertex(Math.cos(along) * outer, Math.sin(along) * outer);
  }
  for (let i = SEGMENTS; i >= 0; i--) {
    const along = -HALF_ANGLE + 2 * HALF_ANGLE * (i / SEGMENTS);
    vertex(Math.cos(along) * inner, Math.sin(along) * inner);
  }
  endShape(CLOSE);

  // The leading edge. It is what separates a swing from a cone of light: the
  // eye reads the bright rim as the thing that arrived, and the fill behind it
  // as where it came from.
  noFill();
  stroke(255, 255, 255, 215 * fade);
  strokeWeight(2);
  arc(0, 0, outer * 2, outer * 2, -HALF_ANGLE, HALF_ANGLE);
  pop();
}
