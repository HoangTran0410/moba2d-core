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

/**
 * How long the mark on the victim lives, ms.
 *
 * It was 170 and that was too short to find on a dark map — ten frames of a
 * thin stroke. The mark **holds** at full brightness for `IMPACT_HOLD` of that
 * before it starts fading, so what a player actually gets is a beat of solid
 * white rather than something already dimming by the time the eye arrives.
 */
export const IMPACT_MS = 230;

/** Share of `IMPACT_MS` spent at full brightness before the fade begins. */
const IMPACT_HOLD = 0.38;

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
  // Sized off the body rather than in absolute pixels: a fixed 6-15px dot is
  // invisible on a champion and comical on a boss.
  const gathered = style.bodyRadius * (0.34 + 0.3 * charge);
  push();
  noStroke();
  fill(red, green, blue, 70 + 150 * charge);
  circle(-style.bodyRadius * 0.55, 0, gathered * 2);
  fill(255, 255, 255, 120 * charge);
  circle(-style.bodyRadius * 0.55, 0, gathered * 0.9);
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
  const fade = 1 - swept * swept;
  const out = style.bodyRadius * (0.9 + (FLICK_REACH - 0.9) * swept);
  const band = Math.max(4, style.bodyRadius * 0.42) * (1 - swept * 0.4);
  const half = FLICK_HALF_ANGLE * (1 - swept * 0.3);

  push();
  noFill();
  strokeCap(ROUND);
  stroke(red, green, blue, 245 * fade);
  strokeWeight(band);
  arc(0, 0, out * 2, out * 2, -half, half);

  // A white core down the middle of the band. On a `background(30)` map,
  // contrast is what carries a fast effect, and there is no rule against being
  // bright — only against being *wide*. Weight costs nothing in reach.
  stroke(255, 255, 255, 230 * fade);
  strokeWeight(Math.max(1.6, band * 0.34));
  arc(0, 0, out * 2, out * 2, -half * 0.86, half * 0.86);
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
  // Full brightness for the first beat, then out. A mark that starts fading on
  // frame one has already half gone by the time anyone looks at it.
  const fade = 1 - Math.max(0, (bite - IMPACT_HOLD) / (1 - IMPACT_HOLD));
  const ring = victimRadius * (1.0 + 0.24 * bite);
  const half = IMPACT_HALF_ANGLE * (1 - bite * 0.22);
  // Scaled off the victim rather than fixed: this is a cap on a body, so it has
  // to be thick relative to the body it is capping. A 3px stroke on a 55-unit
  // champion is a scratch nobody sees.
  const band = Math.max(3.5, victimRadius * 0.34) * (1 - bite * 0.3);

  push();
  noFill();
  strokeCap(ROUND);

  // The camp's or attacker's colour underneath, wider, so the white core has
  // an edge to sit on and the hit still reads at a glance on a pale body.
  stroke(red, green, blue, 235 * fade);
  strokeWeight(band);
  arc(at.x, at.y, ring * 2, ring * 2, from - half, from + half);

  stroke(255, 255, 255, 250 * fade);
  strokeWeight(band * 0.45);
  arc(at.x, at.y, ring * 2, ring * 2, from - half * 0.9, from + half * 0.9);

  // Three sparks thrown off the crescent — the ends and the centre. They are
  // what stops a fast exchange reading as one continuous glow: every hit gets
  // a tick of its own that arrives and leaves.
  stroke(255, 255, 255, 235 * fade);
  strokeWeight(Math.max(2, band * 0.3));
  for (const side of [-1, 0, 1]) {
    const along = from + half * side;
    const inner = ring * 1.02;
    const outer = ring * (1.3 + 0.55 * bite);
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
 *
 * It bounds the arc's *radius*; half a stroke band sits outside that, so the
 * true painted edge is nearer 1.5 radii. Still nowhere near the victim, and
 * that is the point of separating the two numbers: **weight is free, reach is
 * not.** Everything in this file got bolder without this moving.
 */
const FLICK_REACH = 1.3;

/** How wide the flick opens either side of the aim line, radians. */
const FLICK_HALF_ANGLE = 0.62;

/** How far the crescent wraps around the victim's near side, radians. */
const IMPACT_HALF_ANGLE = 0.95;
