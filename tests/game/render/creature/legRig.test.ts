import { describe, expect, it } from 'vitest';
import { LegRig } from '@/game/render/creature/legRig';
import type { LegRigConfig } from '@/game/render/creature/legRig';

/** The resolved defaults a real creature gets — see `creatureSpec.ts`. */
const CONFIG: LegRigConfig = {
  count: 6,
  reach: 32,
  step: 0.35,
  bend: 1,
  spread: 1.6,
  stepMs: 140,
  lead: 1,
  bodyRadius: 20,
};

const rig = () => new LegRig(CONFIG);

/**
 * The worst hip-to-foot distance over a walk, measured in `reach` per frame
 * rather than in pixels: a big camp has long legs, so the same absolute pace is
 * a stroll for it and a sprint for a small one, and only the ratio compares.
 */
const worstStretch = (reachPerFrame: number): number => {
  const walker = rig();
  walker.follow(0, 0, 16);
  let worst = 0;
  let x = 0;
  for (let i = 0; i < 500; i++) {
    x += reachPerFrame * CONFIG.reach;
    walker.follow(x, 0, 16);
    for (const leg of walker.legs) {
      const hip = walker.hipOf(leg);
      worst = Math.max(worst, Math.hypot(leg.footX - hip.x, leg.footY - hip.y));
    }
  }
  return worst;
};

const walking = (rig: LegRig, steps: number, perFrame: number) => {
  let x = 0;
  let both = 0;
  let stepped = 0;
  for (let i = 0; i < steps; i++) {
    x += perFrame;
    rig.follow(x, 0, 16);
    const groups = new Set(rig.legs.filter(leg => leg.stepping).map(leg => leg.group));
    if (groups.size > 1) both++;
    stepped += rig.legs.filter(leg => leg.stepping).length;
  }
  return { x, both, stepped };
};

describe('LegRig — standing still', () => {
  /**
   * The bug this is really about: a trigger that compares against a target
   * recomputed every frame will jitter a foot forever at the threshold, and a
   * camp idling in its clearing twitches all six legs for the whole match.
   */
  it('takes no step at all over ten seconds of standing', () => {
    const rig = new LegRig(CONFIG);
    rig.follow(0, 0, 16);
    const planted = rig.legs.map(leg => [leg.footX, leg.footY]);

    for (let i = 0; i < 600; i++) rig.follow(0, 0, 16);

    expect(rig.legs.map(leg => [leg.footX, leg.footY])).toEqual(planted);
    expect(rig.legs.some(leg => leg.stepping)).toBe(false);
  });

  it('plants every foot within its own span on the first frame', () => {
    const rig = new LegRig(CONFIG);
    rig.follow(0, 0, 16);

    for (const leg of rig.legs) {
      expect(Math.hypot(leg.footX, leg.footY)).toBeCloseTo(CONFIG.bodyRadius + CONFIG.reach, 6);
    }
  });
});

describe('LegRig — walking', () => {
  it('never has both groups off the ground at once', () => {
    const rig = new LegRig(CONFIG);
    rig.follow(0, 0, 16);

    const { both, stepped } = walking(rig, 600, 3);

    expect(both).toBe(0);
    // Guards the assertion above from passing because nothing ever stepped.
    expect(stepped).toBeGreaterThan(0);
  });

  /**
   * The invariant that decides whether this looks like a creature or like a
   * bug, and the one the first version of this file got wrong.
   *
   * A foot further from its hip than the leg is long cannot be reached: the
   * solver extends straight and the drawn leg stops short, so the foot detaches
   * and floats along beside the body. It is not a crash and no other assertion
   * sees it.
   *
   * Swept across speeds because the failure is speed-dependent — the first
   * version held at a stroll and broke at a run, since a fixed swing duration
   * falls further behind the faster the body goes.
   */
  it.each([0.03, 0.09, 0.15, 0.3, 1])(
    'keeps every leg long enough to reach its foot at %s reach/frame',
    pace => {
      expect(worstStretch(pace)).toBeLessThanOrEqual(rig().legLength + 1e-6);
    }
  );

  /**
   * The bound above is guaranteed by `clampToReach`, which means it holds even
   * when the gait has given up and the feet are being dragged. This is the
   * assertion about how it *looks*: across every speed a body in this game
   * actually moves at — a pack's camps run 1.6 to 2.2, its biggest boss runs 6
   * — the clamp is never reached at all, so no foot ever slides.
   */
  it.each([0.027, 0.048, 0.081, 0.1])(
    'never has to drag a foot at %s reach/frame',
    pace => {
      expect(worstStretch(pace)).toBeLessThan(rig().legLength);
    }
  );

  it('turns to face the way it is travelling', () => {
    const rig = new LegRig(CONFIG);
    rig.follow(0, 0, 16);
    for (let i = 0; i < 120; i++) rig.follow(0, i * 3, 16);

    expect(rig.facing).toBeCloseTo(Math.PI / 2, 1);
  });
});

describe('LegRig — losing track of the body', () => {
  /**
   * A camp culled off-screen gets no `follow` at all, so the next one arrives
   * with the body somewhere else entirely. Stepping there means six legs
   * walking at once across the gap.
   */
  it('replants rather than steps after a long gap', () => {
    const rig = new LegRig(CONFIG);
    rig.follow(0, 0, 16);

    rig.follow(900, 0, 5000);

    expect(rig.legs.some(leg => leg.stepping)).toBe(false);
    for (const leg of rig.legs) {
      expect(Math.hypot(leg.footX - 900, leg.footY)).toBeCloseTo(
        CONFIG.bodyRadius + CONFIG.reach,
        6
      );
    }
  });

  it('replants after a teleport inside one frame', () => {
    const rig = new LegRig(CONFIG);
    rig.follow(0, 0, 16);

    rig.follow(900, 0, 16);

    expect(rig.legs.some(leg => leg.stepping)).toBe(false);
  });
});

describe('LegRig — layout', () => {
  it('mounts legs in mirrored pairs, split into two alternating groups', () => {
    const rig = new LegRig(CONFIG);

    expect(rig.legs).toHaveLength(6);
    for (let pair = 0; pair < 3; pair++) {
      const right = rig.legs[pair * 2];
      const left = rig.legs[pair * 2 + 1];
      expect(left.hipAngle).toBeCloseTo(-right.hipAngle, 6);
      expect(left.group).not.toBe(right.group);
    }
    expect(rig.legs.filter(leg => leg.group === 0)).toHaveLength(3);
  });
});
