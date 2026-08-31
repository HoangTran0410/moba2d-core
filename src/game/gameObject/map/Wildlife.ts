import { Rectangle } from '@/libs/quadtree';
import GameObject from '@/game/gameObject/GameObject';
import type { GameObjectGameContext } from '@/game/gameObject/GameObject';
import { Creature } from '@/game/render/creature/creature';
import { resolveRig } from '@/game/render/creature/creatureSpec';
import type { CreatureRigSpec, ResolvedRig } from '@/game/render/creature/creatureSpec';
import {
  drawLegs,
  drawOrbBody,
  drawSpineBody,
  hasOrbBody,
} from '@/game/render/creature/drawCreature';

/**
 * A creature that lives on the map and takes no part in the match.
 *
 * An eel in the river, a crab on the bank, something long in the pit nobody
 * fights. It has no health, no team, no collision and no aggro; it cannot be
 * targeted, cannot be hit, and — this is the load-bearing half — **nothing
 * about it crosses the wire.** Its whole path is a function of its own age, so
 * two machines watching the same match see the same animal without a byte
 * being sent about it, and a host that never simulated one is not out of sync
 * with a client drawing it.
 *
 * That is what makes it cheap enough to be worth having. Every other body in
 * this game is in the gameplay quadtree, so every vision check, target scan
 * and area query walks past it; decoration that joined them would tax the
 * whole match for scenery. `ObjectManager.isDecoration` keeps this out of that
 * tree the same way it keeps particles out — see `_decorTree`.
 *
 * Authored per map, in the map editor, as a `decor` slot. Core ships none: a
 * pack decides whether its river has anything living in it.
 */
export default class Wildlife extends GameObject {
  /** The rig this animal is, already resolved against its own size. */
  readonly rig?: ResolvedRig;

  private readonly creature?: Creature;
  private readonly home: { x: number; y: number };
  private readonly roam: number;
  private readonly bodyRadius: number;
  private readonly pace: number;
  /** Four phases, so two animals sharing a slot do not swim in formation. */
  private readonly phase: [number, number, number, number];
  private age = 0;

  constructor(options: WildlifeOptions) {
    super({ game: options.game, position: createVector(options.x, options.y) });
    this.home = { x: options.x, y: options.y };
    this.roam = Math.max(0, options.roam);
    this.bodyRadius = Math.max(1, options.size) / 2;
    this.pace = Math.max(0, options.speed);

    // A decor animal has no sprite to fall back on, so an undeclared body is an
    // orb rather than the `avatar` every other rig defaults to. Declaring
    // `'avatar'` explicitly still means "draw me no body", which for something
    // with no portrait is a set of legs walking on their own — odd, but it is
    // what was asked for, and refusing it would be the leg-count bug again.
    this.rig = resolveRig({ body: { kind: 'orb' }, ...options.rig }, this.bodyRadius);
    if (this.rig) this.creature = new Creature(this.rig);

    this.phase = [
      phaseFrom(options.x, options.y, 1),
      phaseFrom(options.x, options.y, 2),
      phaseFrom(options.x, options.y, 3),
      phaseFrom(options.x, options.y, 4),
    ];
  }

  /**
   * The wander, as a closed curve rather than a walk.
   *
   * Two sines per axis at unrelated rates: it never repeats visibly, never
   * needs a destination, never has to be told about walls, and **never leaves
   * its own radius**, which is the promise the editor's circle makes to
   * whoever drew it. A random walk would need clamping back inside that circle
   * every frame, and clamping is what makes a drifting thing look like it is
   * bouncing off glass.
   *
   * The per-axis amplitudes sum to `INSIDE_CIRCLE`, not to one, and that
   * factor is the whole difference between a circle and a square. Summing to
   * one bounds each axis at `roam` — which puts the corner at `roam * √2`, and
   * an animal 41% outside the ring somebody drew is an animal standing in a
   * wall they never put it near. Measured at 311 units out of a 240 slot
   * before the factor was there.
   */
  update(): void {
    if (this.roam <= 0 || this.pace <= 0) return;
    this.age += deltaTime;
    const beat = (this.age / 1000) * this.pace * WANDER_RATE;
    const reach = this.roam * INSIDE_CIRCLE;
    this.position.set(
      this.home.x +
        reach *
          (0.62 * Math.sin(beat + this.phase[0]) + 0.38 * Math.sin(beat * 1.7 + this.phase[1])),
      this.home.y +
        reach *
          (0.62 * Math.cos(beat * 0.83 + this.phase[2]) +
            0.38 * Math.cos(beat * 1.31 + this.phase[3]))
    );
  }

  /**
   * Advanced off the render clock, exactly as `Monster.drawRig` is and for the
   * same reasons: `ObjectManager.draw` has already swapped in the interpolated
   * position, so the rig follows the picture, and a culled animal is simply not
   * advanced until it comes back — which arrives as a delta past `RIG_SNAP_MS`
   * and replants rather than walking it across the gap.
   */
  draw(): void {
    const creature = this.creature;
    if (!creature) return;
    creature.follow(this.position.x, this.position.y, deltaTime);

    const style = this.rig?.legs;
    if (creature.legRig && style) drawLegs(creature.legRig, style);
    const body = this.rig?.body;
    if (creature.spine && typeof body === 'object' && body.kind === 'chain') {
      drawSpineBody(creature.spine, body);
    } else if (hasOrbBody(this.rig)) {
      drawOrbBody(this.position.x, this.position.y, this.bodyRadius, this.rig.body);
    }
  }

  getDisplayBoundingBox(): Rectangle {
    const paint = Math.max(this.bodyRadius, this.creature?.paintRadius ?? 0);
    return new Rectangle({
      x: this.position.x - paint,
      y: this.position.y - paint,
      w: paint * 2,
      h: paint * 2,
      data: this,
    });
  }
}

export interface WildlifeOptions {
  game: GameObjectGameContext;
  x: number;
  y: number;
  /** How far from its slot it drifts, world units. Zero stands still. */
  roam: number;
  /** Body diameter, world units — what every ratio in the rig resolves against. */
  size: number;
  /** A multiplier on the wander, not a speed in units: see `WANDER_RATE`. */
  speed: number;
  rig: CreatureRigSpec;
}

/**
 * Body diameter for a decor slot that named none, world units.
 *
 * Smaller than any camp on purpose: scenery that is the size of the thing you
 * fight is a thing players will try to fight.
 */
export const DEFAULT_DECOR_SIZE = 48;

/**
 * Radians per second of wander at `speed: 1`.
 *
 * Slow on purpose. Scenery that moves at the pace of the fight competes with
 * it for the eye, and the one thing decoration must never do is read as a
 * thing you can click.
 */
const WANDER_RATE = 0.45;

/**
 * What each axis is allowed, as a share of the roam radius, so that the two of
 * them at once still land inside the circle rather than in its bounding box.
 */
const INSIDE_CIRCLE = Math.SQRT1_2;

/** A stable per-animal phase, so identical slots do not move in lockstep. */
const phaseFrom = (x: number, y: number, salt: number): number =>
  ((Math.sin(x * 12.9898 + y * 78.233 + salt * 43.7) + 1) % 1) * Math.PI * 2;
