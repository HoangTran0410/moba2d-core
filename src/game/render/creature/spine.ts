import { RENDER_SNAP_PX } from '@/game/render/Interpolation';
import { RIG_SNAP_MS } from './legRig';

/**
 * A body that is a chain of vertebrae rather than one circle.
 *
 * The technique is argonaut's (`A simple procedural animation technique`,
 * github.com/argonautcode/animal-proc-anim): a head that follows the creature,
 * and behind it a chain where every joint is pulled to a fixed distance from
 * the one in front and **may not bend past a limit** relative to it. Those two
 * constraints are the whole simulation, and the second one is what separates a
 * body from a folded pile — without it a hard turn drags the tail straight
 * through the head.
 *
 * Pure, like `legRig.ts` and for the same reason: it runs in the game under p5,
 * in the map editor's spine editor under Canvas2D, and in vitest under nothing
 * at all. It computes points; the callers stroke them.
 */

export interface SpineConfig {
  /**
   * Half-width at each vertebra, in world units, head first. Its length **is**
   * the joint count — one number per vertebra, which is what makes a snake a
   * snake and a fish a fish.
   */
  widths: number[];
  /** Distance between neighbouring joints, world units. */
  spacing: number;
  /** How far one joint may bend from the one ahead of it, radians. */
  bend: number;
}

export interface Point {
  x: number;
  y: number;
}

/** How much of the gap to heading a single frame closes. */
const SMOOTHING = 0.25;

/** Below this (world units per ms) the creature is standing, not travelling. */
const MOVING = 0.005;

/**
 * Where the snout sits, as angles either side of the head's heading. The three
 * of them round the front off instead of cutting it square across.
 */
const SNOUT = [-Math.PI / 6, 0, Math.PI / 6];

/** Shortest signed way round from `from` to `to`. */
const angleDelta = (from: number, to: number): number => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

/** `angle`, held within `limit` of `anchor`. */
const constrainAngle = (angle: number, anchor: number, limit: number): number => {
  const delta = angleDelta(anchor, angle);
  if (Math.abs(delta) <= limit) return angle;
  return anchor + (delta > 0 ? limit : -limit);
};

export class Spine {
  /** Head first. */
  readonly joints: Point[] = [];
  /** Each joint's forward direction — towards the joint ahead of it. */
  readonly angles: number[] = [];

  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private started = false;

  constructor(readonly config: SpineConfig) {
    for (let i = 0; i < config.widths.length; i++) {
      this.joints.push({ x: 0, y: 0 });
      this.angles.push(0);
    }
    this.replant(0, 0);
  }

  /** Half-width at a joint, for whoever is drawing it. */
  widthAt(index: number): number {
    return this.config.widths[index] ?? 0;
  }

  /** How far this body can paint from its head — the whole spine plus a flank. */
  get paintRadius(): number {
    const length = this.config.spacing * Math.max(0, this.joints.length - 1);
    return length + Math.max(...this.config.widths);
  }

  /**
   * Advance one rendered frame with the head at `(x, y)`.
   *
   * One pass, head to tail, re-derived every frame rather than integrated: a
   * chain that accumulates state drifts, and this one cannot, because every
   * joint's position is a function of the joint ahead of it and nothing else.
   */
  follow(x: number, y: number, dtMs: number): void {
    const jumped = Math.hypot(x - this.x, y - this.y) > RENDER_SNAP_PX;
    if (!this.started || jumped || !(dtMs > 0) || dtMs > RIG_SNAP_MS) {
      this.replant(x, y);
      return;
    }

    this.vx += ((x - this.x) / dtMs - this.vx) * SMOOTHING;
    this.vy += ((y - this.y) / dtMs - this.vy) * SMOOTHING;
    this.x = x;
    this.y = y;

    if (Math.hypot(this.vx, this.vy) > MOVING) {
      this.angles[0] += angleDelta(this.angles[0], Math.atan2(this.vy, this.vx)) * SMOOTHING;
    }
    this.joints[0].x = x;
    this.joints[0].y = y;
    this.resolve();
  }

  /** Straighten the whole body out behind the head, right now. */
  replant(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.started = true;
    for (let i = 0; i < this.joints.length; i++) {
      this.angles[i] = this.angles[0];
      this.joints[i].x = x - Math.cos(this.angles[0]) * this.config.spacing * i;
      this.joints[i].y = y - Math.sin(this.angles[0]) * this.config.spacing * i;
    }
  }

  /**
   * The closed outline of the body, as a ring of points: down one flank, round
   * the tail, up the other flank, round the snout.
   *
   * Points rather than a path, because the two renderers draw them differently
   * — p5 has `curveVertex` and Canvas2D does not — and because a test can hold
   * points to account and cannot hold a stroke.
   */
  outline(): Point[] {
    const ring: Point[] = [];
    const last = this.joints.length - 1;

    for (let i = 0; i <= last; i++) ring.push(this.edge(i, Math.PI / 2));
    ring.push(this.edge(last, Math.PI));
    for (let i = last; i >= 0; i--) ring.push(this.edge(i, -Math.PI / 2));
    for (const offset of SNOUT) ring.push(this.edge(0, offset));

    return ring;
  }

  /** A point on the body's edge at `offset` from this vertebra's forward. */
  edge(index: number, offset: number): Point {
    const angle = this.angles[index] + offset;
    const width = this.widthAt(index);
    return {
      x: this.joints[index].x + Math.cos(angle) * width,
      y: this.joints[index].y + Math.sin(angle) * width,
    };
  }

  private resolve(): void {
    for (let i = 1; i < this.joints.length; i++) {
      const ahead = this.joints[i - 1];
      const towards = Math.atan2(ahead.y - this.joints[i].y, ahead.x - this.joints[i].x);
      this.angles[i] = constrainAngle(towards, this.angles[i - 1], this.config.bend);
      this.joints[i].x = ahead.x - Math.cos(this.angles[i]) * this.config.spacing;
      this.joints[i].y = ahead.y - Math.sin(this.angles[i]) * this.config.spacing;
    }
  }
}
