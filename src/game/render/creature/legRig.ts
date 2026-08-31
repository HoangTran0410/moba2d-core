import { RENDER_SNAP_PX } from '@/game/render/Interpolation';
import { solveTwoBone, type Joint } from './legIk';

/**
 * Legs that plant on the ground and step when they have to.
 *
 * The rig owns the hard half of a walking creature — where a foot belongs, when
 * it picks itself up, which legs are allowed to be off the ground together —
 * and **draws nothing at all**. It emits joint positions; `drawCreature.ts`
 * strokes them with p5 and the map editor's inspector strokes the same numbers
 * with Canvas2D. One implementation, two renderers, and a third caller
 * (vitest, in node, with no canvas anywhere) that is why the split exists.
 *
 * It reads no game state either — no `targetLock`, no `Game`, no unit. It is
 * fed a position and a frame delta, and that is the whole input, because the
 * editor has no match running behind it.
 *
 * ## What it is fed, and why that makes the network free
 *
 * `follow` is called from `draw()` with `this.position`, which
 * `ObjectManager.draw` has already swapped for the interpolated one. So the
 * legs are computed from the picture rather than from the simulation — and a
 * LAN client, whose camps are snapshot positions with no velocity attached,
 * gets correct legs with nothing crossing the wire.
 */

export interface LegRigConfig {
  /** Even. Legs are mounted in mirrored pairs. */
  count: number;
  /** How far past the body's edge a foot plants, in world units. */
  reach: number;
  /** A foot steps once it is this many `reach` from where it belongs. */
  step: number;
  /** `1` or `-1` — which way the knees break. Mirrored per side by the rig. */
  bend: number;
  /** Radians the pairs fan across, front to back. */
  spread: number;
  /** How long one step takes. */
  stepMs: number;
  /**
   * How far ahead of its rest position a foot lands, as a multiple of the step
   * trigger distance. `0` plants it exactly at rest.
   *
   * **Not a duration.** A lead measured in milliseconds is multiplied by speed,
   * so the faster the body walks the further ahead the foot lands — which
   * overshoots at a run exactly as badly as no lead undershoots. Measured as a
   * distance in trigger-widths the excursion closes: a foot lands `+1` ahead,
   * the body walks it back through `0` to `-1`, and it steps again — so
   * `|foot - rest|` is bounded by the trigger at **every speed**, which is the
   * whole reason the leg geometry can be a fixed multiple of `reach`.
   */
  lead: number;
  bodyRadius: number;
}

/**
 * Where one leg hangs off the body.
 *
 * A single-circle body gives every leg the same frame — one centre, one
 * heading, one radius. A segmented body gives each pair the frame of the
 * vertebra it is mounted on, which is the whole difference between a spider and
 * a centipede, and the only thing the rig needs to know about either.
 */
export interface Mount {
  x: number;
  y: number;
  /** Forward direction at this point on the body. */
  angle: number;
  /** Half-width of the body here — where the leg starts. */
  radius: number;
}

export interface Leg {
  /** Its own position in `legs`, so a mount can be found without a search. */
  readonly index: number;
  /** Mounting angle in body space, before `facing` is added. */
  readonly hipAngle: number;
  /** Which alternating set this leg belongs to. */
  readonly group: 0 | 1;
  /** Which of `solveTwoBone`'s two knees this leg takes, mirrored per side. */
  readonly bend: number;
  footX: number;
  footY: number;
  stepping: boolean;
  /** Progress through the current step, `[0, 1]`. */
  t: number;
  /** This swing's own duration — see `swingMs`. */
  stepMs: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/**
 * A gap this long means the body was not drawn — culled off-screen, or the tab
 * was hidden — so wherever it is now is not the end of a walk.
 */
export const RIG_SNAP_MS = 200;

/** Below this (world units per ms) the body is standing, not travelling. */
const MOVING = 0.005;

/** How much of the gap to velocity and facing one frame closes. */
const SMOOTHING = 0.25;

/** Fraction of `reach` a swinging foot bulges away from the body. */
const SWING_BULGE = 0.25;

/**
 * Bone length as a fraction of `reach`, per bone — so a whole leg is twice
 * this.
 *
 * The floor is not `0.5` (the length at which a leg is a straight stick at
 * rest). It is set by the **worst** hip-to-foot distance the gait can produce:
 * a foot may be `step * reach` behind its target before it triggers, and it may
 * then wait out another group's swing before it is allowed to move. Past
 * `upper + lower` the solver gives up and extends straight, which draws a leg
 * that visibly **falls short of its own foot** — the foot detaches and floats.
 *
 * `legRig.test.ts` measures the real worst case across walking speeds and holds
 * this number against it. Raising `step` or slowing `stepMs` means raising
 * this too.
 */
const BONE = 1.1;
/*
 * Measured, not guessed — and measured against the right axis, which is **body
 * speed relative to `reach`**, not pixels per frame. A big camp has long legs,
 * so the same absolute pace is a gentle stroll for it and a sprint for a small
 * one.
 *
 * Worst hip-to-foot distance over 500 frames of walking, as a multiple of
 * `reach`, with the resolved defaults and `clampToReach` lifted so the true
 * excursion shows:
 *
 *   reach/frame  0.03  0.05  0.07  0.09  0.12  0.20
 *   ratio        1.64  1.79  1.82  1.89  2.27  2.94
 *
 * A pack's camps sit at the left of that table — the three Krug bodies run
 * 0.027, 0.048 and 0.081 reach per frame — so `2 * BONE = 2.2` clears every
 * real body with room, and only something moving half again as fast as the
 * fastest camp ever meets `clampToReach`. Raising `step`, or slowing `stepMs`,
 * moves the table up and this number with it.
 */

/**
 * How much faster than the body a swinging foot travels, at minimum.
 *
 * A fixed swing duration is a foot that falls further behind the faster the
 * body walks — and since a leg also waits out the other group's swing, the lag
 * compounds until the leg cannot reach. Tying the swing to the body's own pace
 * keeps the geometry bounded at every speed instead of at one.
 */
const SWING_SPEED_RATIO = 2.5;

/** No swing is shorter than this, however fast the body is going. */
const MIN_STEP_MS = 45;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Shortest signed way round from `from` to `to`. */
const angleDelta = (from: number, to: number): number => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

export class LegRig {
  readonly legs: Leg[] = [];
  /** Body-space rotation, radians. Driven by travel, never by a target. */
  facing = 0;

  private readonly upper: number;
  private readonly lower: number;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private started = false;
  /** This frame's mounts, one per leg, or `null` for a single-circle body. */
  private mounts: Mount[] | null = null;
  /**
   * Which group currently holds the floor.
   *
   * A rule of "step unless the *other* group is mid-step" is not enough, and
   * the way it fails is total rather than cosmetic: once one group is behind,
   * each of its legs re-triggers the instant it lands, so that group is always
   * mid-step, the other group is blocked forever, and its feet stay where they
   * were planted while the body walks off. Measured as a foot 1600 units from
   * its hip on a body that had travelled 2000.
   *
   * The floor passes only when *nothing* is stepping, which makes starvation
   * impossible: a group that wants nothing hands the floor straight back on the
   * next frame, and a group that wants everything still has to put every foot
   * down before it can have another turn.
   */
  private turn: 0 | 1 = 0;

  constructor(readonly config: LegRigConfig) {
    const pairs = Math.max(1, Math.floor(config.count / 2));
    this.upper = config.reach * BONE;
    this.lower = config.reach * BONE;

    for (let pair = 0; pair < pairs; pair++) {
      // Fanned front to back across `spread`, centred on the flank. A single
      // pair sits square on the sides rather than at one end of the fan.
      const along = pairs === 1 ? 0 : pair / (pairs - 1) - 0.5;
      const offset = along * config.spread;
      for (const side of [1, -1] as const) {
        this.legs.push({
          index: this.legs.length,
          hipAngle: side * (Math.PI / 2 + offset),
          // Diagonals move together: the pair index and the side both flip it,
          // so no two neighbours on one flank share a group.
          group: (((pair + (side === 1 ? 0 : 1)) % 2) as 0 | 1),
          bend: config.bend * side,
          footX: 0,
          footY: 0,
          stepping: false,
          t: 0,
          stepMs: config.stepMs,
          fromX: 0,
          fromY: 0,
          toX: 0,
          toY: 0,
        });
      }
    }
  }

  /** How far a hip can be from its own foot before the leg stops reaching. */
  get legLength(): number {
    return this.upper + this.lower;
  }

  /** Body radius plus a leg's reach — where a foot rests. */
  get span(): number {
    return this.config.bodyRadius + this.config.reach;
  }

  /**
   * The furthest this creature can paint from its own centre: a hip is on the
   * body's edge and a foot can be a whole leg beyond it.
   *
   * `Monster.getDisplayBoundingBox` widens by this. Without it the cull box is
   * the sprite's, and legs are clipped off at the edge of the screen — the same
   * trap `aoe-display-bounds.test.ts` exists for.
   */
  get paintRadius(): number {
    return this.config.bodyRadius + this.legLength;
  }

  /**
   * Advance one rendered frame.
   *
   * Feet are **only** written while stepping. That is not an optimisation: a
   * target recomputed every frame will jitter a planted foot forever at the
   * threshold, and a camp idling in its clearing would twitch every leg for the
   * whole match.
   */
  follow(x: number, y: number, dtMs: number, mounts?: Mount[]): void {
    // Before the snap check, because `replant` places feet against the mounts
    // too — a segmented body replanted against one shared frame puts every
    // foot at the head.
    this.mounts = mounts ?? null;
    const jumped = Math.hypot(x - this.x, y - this.y) > RENDER_SNAP_PX;
    if (!this.started || jumped || !(dtMs > 0) || dtMs > RIG_SNAP_MS) {
      this.replant(x, y);
      return;
    }

    const instantX = (x - this.x) / dtMs;
    const instantY = (y - this.y) / dtMs;
    this.vx += (instantX - this.vx) * SMOOTHING;
    this.vy += (instantY - this.vy) * SMOOTHING;
    this.x = x;
    this.y = y;

    if (Math.hypot(this.vx, this.vy) > MOVING) {
      this.facing += angleDelta(this.facing, Math.atan2(this.vy, this.vx)) * SMOOTHING;
    }

    if (!this.legs.some(leg => leg.stepping)) this.turn = this.turn === 0 ? 1 : 0;

    const trigger = this.config.step * this.config.reach;
    for (const leg of this.legs) {
      if (leg.stepping) {
        leg.t += dtMs / leg.stepMs;
        if (leg.t >= 1) {
          leg.stepping = false;
          leg.footX = leg.toX;
          leg.footY = leg.toY;
        } else {
          this.placeSwinging(leg);
        }
        this.clampToReach(leg);
        continue;
      }

      this.clampToReach(leg);

      if (leg.group !== this.turn) continue;

      const rest = this.restOf(leg);
      if (Math.hypot(leg.footX - rest.x, leg.footY - rest.y) <= trigger) continue;

      const target = this.landingOf(leg);
      const swing = Math.hypot(target.x - leg.footX, target.y - leg.footY);
      leg.stepping = true;
      leg.t = 0;
      leg.stepMs = this.swingMs(swing);
      leg.fromX = leg.footX;
      leg.fromY = leg.footY;
      leg.toX = target.x;
      leg.toY = target.y;
    }
  }

  /** Put every foot where it belongs, right now, with no step. */
  replant(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.started = true;
    for (const leg of this.legs) {
      const rest = this.restOf(leg);
      leg.footX = rest.x;
      leg.footY = rest.y;
      leg.stepping = false;
      leg.t = 0;
    }
  }

  /**
   * A foot may never be further from its hip than the leg is long.
   *
   * Past that the solver extends straight and the drawn leg stops short of its
   * own foot, which reads as a foot floating along beside the body — the one
   * failure in this file that looks like a different bug entirely. Lead and
   * gait keep a walking creature well inside this; the clamp is what makes the
   * bound a property of the module rather than of the tuning, so a camp hauled
   * by a knock-back or a map that doubles every speed cannot break the picture.
   *
   * A dragging foot at that speed is both correct-looking and preferable to a
   * detached one. Written only when it actually fires, so a standing creature's
   * feet are never touched — see `follow`.
   */
  private clampToReach(leg: Leg): void {
    const hip = this.hipOf(leg);
    const dx = leg.footX - hip.x;
    const dy = leg.footY - hip.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= this.legLength || distance < 1e-6) return;
    leg.footX = hip.x + (dx / distance) * this.legLength;
    leg.footY = hip.y + (dy / distance) * this.legLength;
  }

  /**
   * How long a swing of `distance` may take: the slower of this rig's own pace
   * and whatever keeps the foot ahead of the body. See `SWING_SPEED_RATIO`.
   */
  private swingMs(distance: number): number {
    const speed = Math.hypot(this.vx, this.vy);
    if (speed <= MOVING) return this.config.stepMs;
    return Math.max(MIN_STEP_MS, Math.min(this.config.stepMs, distance / (speed * SWING_SPEED_RATIO)));
  }

  /**
   * This leg's frame: the vertebra it hangs off, or the one body circle when
   * there is only one.
   */
  private frameOf(leg: Leg): Mount {
    return (
      this.mounts?.[leg.index] ?? {
        x: this.x,
        y: this.y,
        angle: this.facing,
        radius: this.config.bodyRadius,
      }
    );
  }

  /** Where this leg's hip sits in the world. */
  hipOf(leg: Leg): Joint {
    const frame = this.frameOf(leg);
    const angle = leg.hipAngle + frame.angle;
    return {
      x: frame.x + Math.cos(angle) * frame.radius,
      y: frame.y + Math.sin(angle) * frame.radius,
    };
  }

  /** Where this leg's knee sits in the world. */
  kneeOf(leg: Leg): Joint {
    const hip = this.hipOf(leg);
    return solveTwoBone(hip.x, hip.y, leg.footX, leg.footY, this.upper, this.lower, leg.bend);
  }

  /**
   * Where this foot belongs with the body standing where it is — the position a
   * planted foot is measured against, with no lead in it. A lead here would
   * make a *standing* creature's feet wrong and, worse, would move the thing
   * the trigger compares to, so every foot would chase its own threshold.
   */
  private restOf(leg: Leg): Joint {
    const frame = this.frameOf(leg);
    const angle = leg.hipAngle + frame.angle;
    const out = frame.radius + this.config.reach;
    return { x: frame.x + Math.cos(angle) * out, y: frame.y + Math.sin(angle) * out };
  }

  /** Where a foot that steps *now* should land: rest, plus the lead. */
  private landingOf(leg: Leg): Joint {
    const rest = this.restOf(leg);
    const speed = Math.hypot(this.vx, this.vy);
    if (speed <= MOVING) return rest;
    const ahead = this.config.step * this.config.reach * this.config.lead;
    return { x: rest.x + (this.vx / speed) * ahead, y: rest.y + (this.vy / speed) * ahead };
  }

  /**
   * A foot mid-swing arcs **outward, away from the body** — not upward. This is
   * a top-down view and there is no Z; an outward bulge reads as a leg swinging
   * over, and a vertical lift reads as nothing at all.
   */
  private placeSwinging(leg: Leg): void {
    const eased = smoothstep(leg.t);
    const x = leg.fromX + (leg.toX - leg.fromX) * eased;
    const y = leg.fromY + (leg.toY - leg.fromY) * eased;
    const outX = x - this.x;
    const outY = y - this.y;
    const away = Math.hypot(outX, outY) || 1;
    const bulge = Math.sin(Math.PI * leg.t) * this.config.reach * SWING_BULGE;
    leg.footX = x + (outX / away) * bulge;
    leg.footY = y + (outY / away) * bulge;
  }
}
