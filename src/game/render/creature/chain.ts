/**
 * A chain of fixed-length links held at **both** ends: a whip, a tether, a rope.
 *
 * `spine.ts` solves the other problem. There a head leads and everything behind
 * it trails, which is what a body does — but it means the far end goes wherever
 * the maths leaves it, and a rope whose far end wanders is not attached to
 * anything. Pin both ends and the shape between them stops being decoration and
 * starts carrying the information: how much slack there is, how far the middle
 * is still trailing the ends, where the crack of the whip is right now.
 *
 * Nothing here sags. The camera looks straight down, so there is no direction
 * for a rope to hang in — what a chain does in this view is *lag*, bowing out
 * behind whichever end moved and catching up afterwards.
 *
 * The solve is FABRIK — drag the chain from one end, then drag it back from the
 * other, twice. Every pass restores every link to exactly `spacing`, so length
 * is never negotiable; what the passes trade against each other is only *where*
 * the slack sits.
 *
 * **No angle limit here, unlike `Spine`.** A spine needs one or a hard turn
 * drags its tail through its own head. A chain pinned at both ends cannot fold
 * that way — the pins already hold it open — and a bend limit actively fights
 * them: with both endpoints fixed and a tight limit there may be no arrangement
 * that satisfies all three, and what the solver does then is give up one of the
 * pins. A whip that detaches from the mouth it is swung from is a worse picture
 * than a whip that curls a little too sharply.
 *
 * Pure, like everything else in this directory: it computes points and the
 * callers stroke them.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Forward-and-back pairs per frame.
 *
 * One pair already lands both ends within a pixel when the previous frame was
 * close, which it always is at 60fps. The second is for the frame after a
 * teleport, where the chain starts straight across the map from where it
 * belongs.
 *
 * It is a **per-frame** count, and that makes it the one number here that a
 * caller may have to scale. A chain driven by an animation clock — a whip whose
 * tip is a function of its own age — does not care: the tip is where the clock
 * says and the shape follows. A chain that only ever *lags*, like a tether
 * between two units, does: how far behind it trails is how many passes it got,
 * so at 30fps it would trail twice as far as at 60. That caller passes a count
 * scaled by its own frame delta.
 */
const SOLVE_PASSES = 2;

/** Below this two joints are the same point and have no direction between them. */
const EPSILON = 1e-6;

export class Chain {
  /** Head first — index 0 is whichever end the caller leads with. */
  readonly joints: Point[] = [];

  /**
   * Distance between neighbouring joints.
   *
   * Writable, unlike a `Spine`'s, because a chain's length is not always a
   * property of the thing it is drawn on. A whip is as long as it is; a tether
   * spans two units that walk apart, and holding its slack at a *fraction* of
   * that distance means re-deriving the spacing every frame from a gap the
   * chain does not own.
   */
  spacing: number;

  constructor(links: number, spacing: number) {
    this.spacing = spacing;
    for (let i = 0; i < Math.max(2, Math.floor(links)); i++) {
      this.joints.push({ x: 0, y: 0 });
    }
  }

  /** Straight-line distance the chain can cover. */
  get length(): number {
    return this.spacing * (this.joints.length - 1);
  }

  /** Lay the chain straight from head to tail, right now, with no history. */
  straighten(headX: number, headY: number, tailX: number, tailY: number): void {
    const last = this.joints.length - 1;
    for (let i = 0; i <= last; i++) {
      const along = i / last;
      this.joints[i].x = headX + (tailX - headX) * along;
      this.joints[i].y = headY + (tailY - headY) * along;
    }
  }

  /**
   * Advance one frame with the head at `(headX, headY)` and the tail held at
   * `(tailX, tailY)`.
   *
   * A head asked for further away than the chain is long is **pulled in to
   * where it can reach**, rather than being honoured at the tail's expense.
   * That is the priority made explicit: the tail is bolted to something — a
   * mouth, a caster's hand — and the head is reaching. Let the solver decide it
   * and it drops whichever pin the last pass did not set, which changes with
   * the iteration count rather than with anything the caller meant.
   *
   * Every pass ends on the tail for the same reason.
   *
   * `passes` is how much settling this frame is worth — see `SOLVE_PASSES`.
   */
  span(headX: number, headY: number, tailX: number, tailY: number, passes = SOLVE_PASSES): void {
    const last = this.joints.length - 1;
    const dx = headX - tailX;
    const dy = headY - tailY;
    const away = Math.hypot(dx, dy);
    const held = away > this.length ? this.length / away : 1;
    const reachX = tailX + dx * held;
    const reachY = tailY + dy * held;

    for (let pass = 0; pass < Math.max(1, Math.floor(passes)); pass++) {
      this.drag(0, reachX, reachY, 1);
      this.drag(last, tailX, tailY, -1);
    }
  }

  /**
   * Move one end to `(x, y)` and let the rest of the chain follow it, each
   * joint keeping its own direction from its neighbour and giving up only its
   * distance.
   *
   * Keeping the direction is what carries the shape from one frame to the next:
   * a chain re-derived from the endpoints alone would snap to a straight line
   * every frame and never sag, never trail, never crack.
   */
  private drag(start: number, x: number, y: number, step: 1 | -1): void {
    this.joints[start].x = x;
    this.joints[start].y = y;

    for (let i = start + step; i >= 0 && i < this.joints.length; i += step) {
      const ahead = this.joints[i - step];
      let unitX = this.joints[i].x - ahead.x;
      let unitY = this.joints[i].y - ahead.y;
      const away = Math.hypot(unitX, unitY);

      if (away > EPSILON) {
        unitX /= away;
        unitY /= away;
      } else {
        // Two joints on the same point: borrow the direction of the link
        // before this one, and the x axis when there is no link before it.
        // Any finite direction will do — what matters is that it is finite,
        // because `0/0` here puts a `NaN` in a joint and a `NaN` joint is a
        // whip that silently stops being drawn.
        const behind = this.joints[i - step * 2];
        const backX = behind ? ahead.x - behind.x : 1;
        const backY = behind ? ahead.y - behind.y : 0;
        const back = Math.hypot(backX, backY);
        unitX = back > EPSILON ? backX / back : 1;
        unitY = back > EPSILON ? backY / back : 0;
      }

      this.joints[i].x = ahead.x + unitX * this.spacing;
      this.joints[i].y = ahead.y + unitY * this.spacing;
    }
  }
}
