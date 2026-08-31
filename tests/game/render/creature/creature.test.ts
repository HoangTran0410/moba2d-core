import { describe, expect, it } from 'vitest';
import { Creature } from '@/game/render/creature/creature';
import { resolveRig } from '@/game/render/creature/creatureSpec';

const RADIUS = 20;

const lizard = () =>
  new Creature(
    resolveRig(
      {
        body: { kind: 'chain', widths: [0.9, 1, 0.9, 0.75, 0.6, 0.45, 0.3] },
        legs: { count: 4, on: [1, 4] },
      },
      RADIUS
    )!
  );

const walk = (creature: Creature, steps: number) => {
  creature.follow(0, 0, 16);
  for (let i = 1; i <= steps; i++) creature.follow(i * 3, 0, 16);
};

describe('Creature — a spine with legs on it', () => {
  /**
   * The whole point of the segmented body: a pair of legs belongs to the
   * vertebra it is mounted on, not to the head. Before mounts existed every
   * hip sat on one circle, so a centipede's back legs grew out of its face.
   */
  it('hangs each pair off the vertebra it was given', () => {
    const creature = lizard();
    walk(creature, 100);
    const spine = creature.spine!;

    for (const leg of creature.legRig!.legs) {
      const joint = spine.joints[creature.rig.legs!.on[Math.floor(leg.index / 2)]];
      const hip = creature.legRig!.hipOf(leg);
      // The hip sits on that vertebra's own flank, so it is within a width of
      // its joint and nowhere near the head.
      expect(Math.hypot(hip.x - joint.x, hip.y - joint.y)).toBeLessThanOrEqual(RADIUS + 1e-6);
    }
  });

  it('puts the front pair ahead of the back pair, as the spine does', () => {
    const creature = lizard();
    walk(creature, 100);
    const [front, , back] = creature.legRig!.legs;

    expect(creature.legRig!.hipOf(front).x).toBeGreaterThan(creature.legRig!.hipOf(back).x);
  });

  it('paints out to the end of its own tail', () => {
    const creature = lizard();

    // Six links of 18 plus the widest flank — far past the head's own circle.
    expect(creature.paintRadius).toBeGreaterThan(RADIUS * 5);
  });

  it('drives spine and legs off the same frame', () => {
    const creature = lizard();
    walk(creature, 60);

    expect(creature.spine!.joints[0].x).toBeCloseTo(180, 6);
    expect(creature.legRig!.legs.every(leg => Number.isFinite(leg.footX))).toBe(true);
  });
});

describe('Creature — bodies that are not chains', () => {
  it('builds no spine for a plain body, and legs still work', () => {
    const creature = new Creature(resolveRig({ legs: { count: 6 } }, RADIUS)!);
    walk(creature, 60);

    expect(creature.spine).toBeNull();
    expect(creature.legRig!.legs).toHaveLength(6);
    expect(creature.paintRadius).toBeGreaterThan(0);
  });
});
