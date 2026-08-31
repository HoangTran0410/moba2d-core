import type { LegRig } from './legRig';
import type { ResolvedRig } from './creatureSpec';

/**
 * The p5 half of a procedural creature, and the only file here that draws.
 *
 * Everything it needs has already been decided: `legRig.ts` worked out where
 * the joints are, `creatureSpec.ts` worked out how thick and what colour. This
 * strokes them and nothing else, which is what lets the map editor paint the
 * same rig with Canvas2D from the same numbers.
 *
 * **Locals are named for what they mean in the drawing**, never for the
 * quantity's generic word: `fill`, `stroke`, `line`, `image` and `color` are
 * all p5 globals in global mode, and a local that shadows one turns the call
 * that closes the block into a call on a number — at runtime, in the browser,
 * on a frame nobody is looking at.
 */

/** How much thinner the shin is than the thigh. */
const SHIN_TAPER = 0.72;

/** Foot dot diameter, in thicknesses. */
const FOOT_SIZE = 1.5;

/**
 * Legs, drawn under the body.
 *
 * Two strokes per leg rather than one three-point curve: the taper is what
 * makes a stick read as a limb, and a `curveVertex` chain cannot change weight
 * partway through.
 */
export function drawLegs(rig: LegRig, style: { thickness: number; color: number[] }, alpha = 255) {
  const [red, green, blue] = style.color;

  push();
  noFill();
  strokeCap(ROUND);
  stroke(red, green, blue, alpha);

  for (const leg of rig.legs) {
    const hip = rig.hipOf(leg);
    const knee = rig.kneeOf(leg);
    strokeWeight(style.thickness);
    line(hip.x, hip.y, knee.x, knee.y);
    strokeWeight(style.thickness * SHIN_TAPER);
    line(knee.x, knee.y, leg.footX, leg.footY);
  }

  noStroke();
  fill(red, green, blue, alpha);
  for (const leg of rig.legs) {
    circle(leg.footX, leg.footY, style.thickness * FOOT_SIZE);
  }
  pop();
}

/**
 * A body drawn from code, for a creature that has no sprite.
 *
 * Deliberately not a flat disc: the halo and the lighter core are what stop it
 * reading as a debug circle, and they cost two more `circle` calls on a body
 * that has no image to load at all.
 */
export function drawOrbBody(
  x: number,
  y: number,
  radius: number,
  body: { color: number[]; glow: number },
  alpha = 255
) {
  const [red, green, blue] = body.color;

  push();
  noStroke();
  if (body.glow > 0) {
    fill(red, green, blue, alpha * 0.22 * body.glow);
    circle(x, y, radius * 2 * (1 + body.glow * 0.6));
  }
  fill(red, green, blue, alpha);
  circle(x, y, radius * 2);
  // A highlight up and left of centre, so the ball has a light source rather
  // than being a filled shape.
  fill(255, 255, 255, alpha * 0.18);
  circle(x - radius * 0.28, y - radius * 0.28, radius * 0.9);
  pop();
}

/** Whether this rig replaces the sprite rather than sitting under it. */
export const hasProceduralBody = (
  rig: ResolvedRig | undefined
): rig is ResolvedRig & { body: { kind: 'orb'; color: number[]; glow: number } } =>
  rig !== undefined && rig.body !== 'avatar';
