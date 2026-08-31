/**
 * The one melee swing, drawn once.
 *
 * A champion's swing and a minion's were two hand-rolled copies of the same
 * picture and had already drifted apart where nobody would look. A camp's claw
 * is deliberately **not** this (`monsterAttacks.ts` explains why): three
 * separate arcs on a 100px body is a legibility decision about bodies that big.
 * This covers the two that were meant to match.
 *
 * ## Why it is a blade and not a cone
 *
 * It *was* a cone: a filled wedge from the attacker's body out to the full
 * reach, seventy degrees wide. Two things were wrong with that and both were
 * reported. A filled wedge is the shape this game uses for **area** effects —
 * a camp's breath is exactly that — so a basic attack wearing it read as an
 * ability that hits everything inside it. And nothing in the picture said who
 * was actually being hit: the whole drawing lived in the attacker's frame, so
 * a swing at one champion standing in a crowd looked identical to a swing at
 * the crowd.
 *
 * So the swing is a **crescent** now — a band with a thickness, out at the end
 * of the reach rather than filling it, sweeping outward and closing as it goes.
 * A band has an inside and an outside; a wedge only has an inside, and that is
 * the whole difference between a blade and a spotlight.
 *
 * And the victim is marked. `drawMeleeImpact` puts a ring on the body that took
 * it, in world space rather than the attacker's frame, which is the only part
 * of this that can answer "who". It is the half that was missing, not the
 * shape — a prettier cone would still not have said.
 *
 * **Locals are named for what they mean in the drawing.** `fill`, `stroke`,
 * `line` and `color` are p5 globals in global mode, and a local that shadows
 * one turns the call that closes the block into a call on a number.
 */

/** How wide the crescent opens either side of the aim line, radians. */
const HALF_ANGLE = 0.5;

/** Thickness of the blade band, as a share of reach. */
const BLADE_SHARE = 0.2;

/** How long the mark on the victim lives, ms. Short: it is punctuation. */
export const IMPACT_MS = 160;

export interface MeleeSwingStyle {
  /** Half the attacker's body, world units — where the swing starts from. */
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
 * The blade: a crescent thrown out past the body, thinning and closing as it
 * travels, with a bright edge on its leading rim.
 *
 * Drawn in the attacker's own rotated frame — the caller has already
 * `translate`d to the body and `rotate`d to the aim — so this is the same
 * picture whichever way the swing points.
 */
export function drawMeleeStrike(style: MeleeSwingStyle, swept: number) {
  const [red, green, blue] = style.color;
  const fade = 1 - swept;
  // Travels outward rather than filling the reach: what the eye follows is the
  // edge moving, and a shape that is already everywhere cannot move.
  const out = style.bodyRadius + style.reach * (0.5 + 0.45 * swept);
  const band = Math.max(3, style.reach * BLADE_SHARE) * (1 - swept * 0.45);
  const half = HALF_ANGLE * (1 - swept * 0.3);

  push();
  noFill();
  strokeCap(SQUARE);
  stroke(red, green, blue, 215 * fade);
  strokeWeight(band);
  arc(0, 0, out * 2, out * 2, -half, half);

  // The leading edge, just outside the band. It is what separates a swing from
  // a smear: the eye reads the bright rim as the thing that arrived and the
  // band behind it as where it came from.
  stroke(255, 255, 255, 210 * fade);
  strokeWeight(Math.max(1.5, band * 0.26));
  const rim = out + band * 0.44;
  arc(0, 0, rim * 2, rim * 2, -half * 0.9, half * 0.9);
  pop();
}

/**
 * The mark on whoever took it: a ring snapping outward on the victim's own
 * body, with four ticks thrown off it.
 *
 * World space, not the attacker's frame, and that is the point — this is the
 * only part of a basic attack that names a target. Drawn from the swing object
 * rather than from the victim so it survives the attacker being culled, the
 * same reason every reaching effect in this codebase is a `SpellObject`.
 */
export function drawMeleeImpact(
  at: { x: number; y: number },
  victimRadius: number,
  style: MeleeSwingStyle,
  bite: number
) {
  const [red, green, blue] = style.color;
  const fade = 1 - bite;
  const ring = victimRadius * (0.5 + 0.7 * bite);

  push();
  noFill();
  stroke(255, 255, 255, 235 * fade);
  strokeWeight(1 + 2.5 * fade);
  circle(at.x, at.y, ring * 2);

  stroke(red, green, blue, 220 * fade);
  strokeWeight(1 + 1.5 * fade);
  for (let tick = 0; tick < 4; tick++) {
    const along = (Math.PI / 4) * (1 + 2 * tick);
    const inner = ring * 0.95;
    const outer = ring * (1.25 + 0.35 * bite);
    line(
      at.x + Math.cos(along) * inner,
      at.y + Math.sin(along) * inner,
      at.x + Math.cos(along) * outer,
      at.y + Math.sin(along) * outer
    );
  }
  pop();
}
