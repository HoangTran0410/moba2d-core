import { describe, expect, it } from 'vitest';
import { Spine } from '@/game/render/creature/spine';
import type { SpineConfig } from '@/game/render/creature/spine';

/** Seven vertebrae, fattest just behind the head — a lizard's proportions. */
const CONFIG: SpineConfig = {
  widths: [18, 20, 19, 16, 12, 9, 6],
  spacing: 16,
  bend: 0.45,
};

const gap = (spine: Spine, i: number) =>
  Math.hypot(
    spine.joints[i].x - spine.joints[i - 1].x,
    spine.joints[i].y - spine.joints[i - 1].y
  );

/** Shortest signed distance between two angles. */
const between = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

const walk = (spine: Spine, steps: number, step: (i: number) => [number, number]) => {
  for (let i = 0; i < steps; i++) {
    const [x, y] = step(i);
    spine.follow(x, y, 16);
  }
};

describe('Spine — the links themselves', () => {
  it('has one joint per declared width', () => {
    expect(new Spine(CONFIG).joints).toHaveLength(CONFIG.widths.length);
  });

  it('holds every link at exactly its spacing, however the head moves', () => {
    const spine = new Spine(CONFIG);
    spine.follow(0, 0, 16);

    walk(spine, 300, i => [Math.cos(i * 0.11) * 400, Math.sin(i * 0.17) * 400]);

    for (let i = 1; i < spine.joints.length; i++) {
      expect(gap(spine, i)).toBeCloseTo(CONFIG.spacing, 6);
    }
  });

  it('never lets a joint bend further from its parent than it may', () => {
    const spine = new Spine(CONFIG);
    spine.follow(0, 0, 16);
    let worst = 0;

    for (let i = 0; i < 300; i++) {
      // Deliberately violent: a head that changes direction every frame is
      // what an unconstrained chain folds under.
      spine.follow(Math.cos(i * 1.3) * 300, Math.sin(i * 2.1) * 300, 16);
      for (let j = 1; j < spine.angles.length; j++) {
        worst = Math.max(worst, between(spine.angles[j - 1], spine.angles[j]));
      }
    }

    expect(worst).toBeLessThanOrEqual(CONFIG.bend + 1e-9);
  });

  /**
   * The failure the angle constraint exists for, stated as the thing you would
   * actually see: turn hard enough and an unconstrained chain doubles back
   * through itself, so the creature reads as a folded pile rather than a body.
   */
  it('does not fold back through itself when the head is thrashed', () => {
    const spine = new Spine(CONFIG);
    spine.follow(0, 0, 16);
    walk(spine, 40, i => [i * 6, 0]);

    // A head snapping back and forth across its own body every frame. This is
    // the shape that folds an unconstrained chain: each joint simply points at
    // the one ahead, so a reversal walks the tail straight through the head.
    let worst = Infinity;
    for (let i = 0; i < 200; i++) {
      spine.follow(240 + (i % 2 ? 60 : -60), 0, 16);
      for (let a = 0; a < spine.joints.length; a++) {
        for (let b = a + 2; b < spine.joints.length; b++) {
          worst = Math.min(
            worst,
            Math.hypot(
              spine.joints[a].x - spine.joints[b].x,
              spine.joints[a].y - spine.joints[b].y
            )
          );
        }
      }
    }

    // Two joints with one between them cannot come closer than the bend limit
    // allows; unconstrained they end up on top of each other.
    expect(worst).toBeGreaterThan(CONFIG.spacing);
  });

  it('lies straight behind a head travelling in a straight line', () => {
    const spine = new Spine(CONFIG);
    spine.follow(0, 0, 16);
    walk(spine, 200, i => [i * 4, 0]);

    for (const joint of spine.joints) expect(joint.y).toBeCloseTo(0, 3);
    for (let i = 1; i < spine.joints.length; i++) {
      expect(spine.joints[i].x).toBeLessThan(spine.joints[i - 1].x);
    }
  });
});

describe('Spine — losing track of the body', () => {
  it('lays itself out straight again after a teleport rather than whipping', () => {
    const spine = new Spine(CONFIG);
    spine.follow(0, 0, 16);
    walk(spine, 40, i => [i * 4, 0]);

    spine.follow(4000, 4000, 16);

    for (let i = 1; i < spine.joints.length; i++) {
      expect(gap(spine, i)).toBeCloseTo(CONFIG.spacing, 6);
      expect(between(spine.angles[i - 1], spine.angles[i])).toBeCloseTo(0, 6);
    }
  });
});

describe('Spine — the outline', () => {
  const outlineOf = (spine: Spine) => spine.outline();

  it('traces both flanks, a tail cap and a snout', () => {
    const spine = new Spine(CONFIG);
    spine.follow(0, 0, 16);

    // Both sides (7 each), one tail point, three around the snout.
    expect(outlineOf(spine)).toHaveLength(CONFIG.widths.length * 2 + 4);
  });

  it('is symmetric about a straight spine, at each vertebra its own width', () => {
    const spine = new Spine(CONFIG);
    spine.follow(0, 0, 16);
    walk(spine, 200, i => [i * 4, 0]);
    const points = outlineOf(spine);

    // Travelling along +x, so the flanks sit at -y and +y by the width.
    for (let i = 0; i < CONFIG.widths.length; i++) {
      expect(Math.abs(points[i].y)).toBeCloseTo(CONFIG.widths[i], 3);
    }
  });
});
