import { LegRig, type Mount } from './legRig';
import { Spine } from './spine';
import type { ResolvedRig } from './creatureSpec';

/**
 * One creature: a body, and the legs hanging off it.
 *
 * It exists so that neither caller has to know how the two fit together. The
 * game builds one per camp and draws it with p5; the map editor builds one from
 * whatever is currently typed into the inspector and draws it with Canvas2D.
 * Both call `follow` with a position and a frame delta, and read geometry back.
 *
 * Pure, like everything else beside it — `creatureSeam.test.ts` holds that.
 */
export class Creature {
  /** The vertebrae, when this body is a chain. */
  readonly spine: Spine | null;
  readonly legRig: LegRig | null;

  constructor(readonly rig: ResolvedRig) {
    const body = rig.body;
    this.spine = typeof body === 'object' && body.kind === 'chain' ? new Spine(body.config) : null;
    this.legRig = rig.legs ? new LegRig(rig.legs.config) : null;
  }

  /**
   * Advance one rendered frame.
   *
   * The spine resolves **first**, because the legs mount on the vertebrae it
   * just placed. A frame's legs hanging off the previous frame's spine is a
   * body whose legs lag one frame behind it, which reads as the legs being
   * loosely attached — visible at exactly the speeds a boss moves at.
   */
  follow(x: number, y: number, dtMs: number): void {
    this.spine?.follow(x, y, dtMs);
    this.legRig?.follow(x, y, dtMs, this.mounts());
  }

  /**
   * Advance the body and **not** the legs, for a creature that has stopped
   * driving itself.
   *
   * A corpse whose whole rig kept running would keep walking: `LegRig` steps
   * whenever a foot has fallen far enough behind its hip, and it cannot tell a
   * body being dragged by a death animation from a body going somewhere. Legs
   * left un-advanced simply stay planted where they last were, which is what a
   * dead thing's legs do.
   */
  limp(x: number, y: number, dtMs: number): void {
    this.spine?.follow(x, y, dtMs);
  }

  /** How far this creature paints from the point it is standing on. */
  get paintRadius(): number {
    const body = this.spine?.paintRadius ?? this.legRig?.paintRadius ?? 0;
    return this.spine && this.legRig
      ? this.spine.paintRadius + this.legRig.legLength
      : body;
  }

  /**
   * One mount per leg, or `undefined` for a body with only one place to hang
   * anything — which is what `LegRig` falls back to on its own.
   */
  private mounts(): Mount[] | undefined {
    const spine = this.spine;
    const legs = this.legRig;
    if (!spine || !legs) return undefined;

    const on = this.rig.legs?.on ?? [];
    return legs.legs.map(leg => {
      const joint = on[Math.floor(leg.index / 2)] ?? 0;
      return {
        x: spine.joints[joint].x,
        y: spine.joints[joint].y,
        angle: spine.angles[joint],
        radius: spine.widthAt(joint),
      };
    });
  }
}
