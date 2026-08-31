import type { LegRig } from './legRig';
import type { Spine } from './spine';
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

/**
 * A segmented body: one closed outline traced around the whole spine.
 *
 * Drawn as an outline rather than as its circles, and that is the difference
 * between a creature and a string of beads. Each vertebra contributes one point
 * per flank at its own half-width, the snout rounds the front off and the tail
 * comes to a point, and `curveVertex` runs a Catmull-Rom through the lot — so
 * the body reads as one skin over a skeleton, which is what it is.
 *
 * The ring is closed by repeating control points at both ends: a Catmull-Rom
 * segment needs a point either side of it, so without them the shape opens up
 * with a straight chord across the neck.
 */
export function drawSpineBody(
  spine: Spine,
  body: { color: number[]; glow: number },
  alpha = 255
) {
  const ring = spine.outline();
  if (ring.length < 3) return;
  const [red, green, blue] = body.color;

  push();
  if (body.glow > 0) {
    noStroke();
    fill(red, green, blue, alpha * 0.16 * body.glow);
    for (let i = 0; i < spine.joints.length; i++) {
      const joint = spine.joints[i];
      circle(joint.x, joint.y, spine.widthAt(i) * 2 * (1 + body.glow * 0.7));
    }
  }

  fill(red, green, blue, alpha);
  // A rim **darker** than the fill, and thin.
  //
  // It was lighter, and on a map this dark a bright even outline reads as
  // exactly what it is — a polygon somebody stroked — rather than as an edge.
  // Darker is the shadow a body casts along its own silhouette, which is what
  // the eye expects and what stops the shape looking like a debug draw.
  stroke(red * 0.45, green * 0.45, blue * 0.45, alpha);
  strokeWeight(1);
  beginShape();
  curveVertex(ring[ring.length - 1].x, ring[ring.length - 1].y);
  for (const point of ring) curveVertex(point.x, point.y);
  curveVertex(ring[0].x, ring[0].y);
  curveVertex(ring[1].x, ring[1].y);
  endShape(CLOSE);
  pop();
}

/**
 * Whether this rig replaces the sprite, rather than being drawn under it.
 *
 * Only `orb` does. `orb` means "this creature has no art, draw it a body", so
 * standing in for the sprite is its whole job — while a **chain is additive**,
 * like the legs: it is a body the camp's own portrait sits on the head of.
 * Reported the other way round, as picking a segmented body silently hiding the
 * monster's avatar behind a default-coloured blob.
 */
export const hasOrbBody = (
  rig: ResolvedRig | undefined
): rig is ResolvedRig & { body: { kind: 'orb'; color: number[]; glow: number } } =>
  rig !== undefined && typeof rig.body === 'object' && rig.body.kind === 'orb';
