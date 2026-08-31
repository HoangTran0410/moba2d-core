/**
 * The one melee swing, drawn once — and drawn in two places on purpose.
 *
 * A champion's swing and a minion's were two hand-rolled copies of the same
 * picture and had drifted apart. A camp's claw is deliberately **not** this
 * (`monsterAttacks.ts` explains why): three separate arcs on a 100px body is a
 * legibility decision about bodies that big.
 *
 * ## Nothing is painted between the two bodies, or past them
 *
 * This shape is the third answer, and the two it replaced were both wrong in
 * the same direction — they painted **space**, and painted space is what this
 * game means by an area effect.
 *
 * The first was a filled wedge from the attacker out to its full reach, which
 * read as an ability that hits everyone standing in it. The second was a
 * crescent that swept outward through that same reach: better, but it still
 * travelled to `reach` regardless of where the victim actually was, so against
 * anything standing close it swung out *past* the victim and looked like the
 * damage carried on through to whatever was behind them. Reported exactly that
 * way, twice.
 *
 * So neither half reaches now:
 *
 * - **`drawMeleeStrike` stays on the attacker.** A short flick at its own body
 *   edge — the weapon leaving the hand. It never extends past the attacker's
 *   own body, so there is no swept volume to misread. `meleeSwingArt.test.ts`
 *   holds that as a number.
 * - **`drawMeleeImpact` sits on the victim.** A crescent hugging the near side
 *   of the body that took it, facing back the way it came. All of the damage's
 *   art is on the thing that took damage, which is the only arrangement that
 *   cannot be read as hitting anything else.
 *
 * The gap between them is left empty deliberately. A melee attacker is nearly
 * touching its target anyway — `reach` is surface to surface — and an empty gap
 * says "these two, and nothing else" better than any stroke drawn across it.
 *
 * **Locals are named for what they mean in the drawing.** `fill`, `stroke`,
 * `line` and `color` are p5 globals in global mode, and a local that shadows
 * one turns the call that closes the block into a call on a number.
 */

/** How long the mark on the victim lives, ms. Short: it is punctuation. */
export const IMPACT_MS = 170;

export interface MeleeSwingStyle {
  /** Half the attacker's body, world units. The flick never leaves it. */
  bodyRadius: number;
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
 * The release, on the attacker: a flick of the weapon around its own body.
 *
 * Drawn in the attacker's own rotated frame — the caller has already
 * `translate`d to the body and `rotate`d to the aim — and bounded by
 * `FLICK_REACH` body radii, which is what stops it being a sweep. It says *who
 * swung and which way*; it deliberately says nothing about how far.
 */
export function drawMeleeStrike(style: MeleeSwingStyle, swept: number) {
  const [red, green, blue] = style.color;
  const fade = 1 - swept;
  const out = style.bodyRadius * (0.92 + (FLICK_REACH - 0.92) * swept);
  const band = Math.max(2.5, style.bodyRadius * 0.26) * (1 - swept * 0.55);
  const half = FLICK_HALF_ANGLE * (1 - swept * 0.35);

  push();
  noFill();
  strokeCap(ROUND);
  stroke(red, green, blue, 205 * fade);
  strokeWeight(band);
  arc(0, 0, out * 2, out * 2, -half, half);

  stroke(255, 255, 255, 190 * fade);
  strokeWeight(Math.max(1.2, band * 0.3));
  arc(0, 0, out * 2, out * 2, -half * 0.85, half * 0.85);
  pop();
}

/**
 * The hit, on the victim: a crescent across the near side of its body, facing
 * the direction it came from, with two sparks thrown off the edge.
 *
 * World space, not the attacker's frame, and centred on the **victim's** body
 * rather than reaching towards it. That is the part that answers "who" — the
 * only part of a basic attack that ever could, and the half that was missing
 * while the question was being answered with a bigger swing.
 *
 * `from` is the angle from the victim back toward its attacker, so the crescent
 * lands on the side the blow arrived on.
 */
export function drawMeleeImpact(
  at: { x: number; y: number },
  victimRadius: number,
  from: number,
  style: MeleeSwingStyle,
  bite: number
) {
  const [red, green, blue] = style.color;
  const fade = 1 - bite;
  const ring = victimRadius * (1.02 + 0.22 * bite);
  const half = IMPACT_HALF_ANGLE * (1 - bite * 0.3);

  push();
  noFill();
  strokeCap(ROUND);

  stroke(255, 255, 255, 245 * fade);
  strokeWeight(1.4 + 3 * fade);
  arc(at.x, at.y, ring * 2, ring * 2, from - half, from + half);

  const echo = ring * 1.2;
  stroke(red, green, blue, 200 * fade);
  strokeWeight(1 + 1.6 * fade);
  arc(at.x, at.y, echo * 2, echo * 2, from - half * 0.78, from + half * 0.78);

  // Two sparks off the ends of the crescent, thrown outward along the body's
  // edge. They are what stops a fast exchange reading as one continuous arc:
  // each hit gets a visible tick of its own.
  strokeWeight(1 + 1.4 * fade);
  for (const side of [-1, 1]) {
    const along = from + half * side;
    const inner = ring * 1.05;
    const outer = ring * (1.25 + 0.4 * bite);
    line(
      at.x + Math.cos(along) * inner,
      at.y + Math.sin(along) * inner,
      at.x + Math.cos(along) * outer,
      at.y + Math.sin(along) * outer
    );
  }
  pop();
}

/**
 * How far the attacker-side flick may travel, in body radii.
 *
 * The number that keeps this from being a sweep again. Anything past the
 * attacker's own body is space between two units, and painted space in this
 * game means an area effect — see this file's header.
 */
const FLICK_REACH = 1.3;

/** How wide the flick opens either side of the aim line, radians. */
const FLICK_HALF_ANGLE = 0.62;

/** How far the crescent wraps around the victim's near side, radians. */
const IMPACT_HALF_ANGLE = 0.95;
