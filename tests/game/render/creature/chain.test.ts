import { describe, expect, it } from 'vitest';
import { Chain } from '@/game/render/creature/chain';

const LINKS = 9;
const SPACING = 14;

const gap = (chain: Chain, i: number) =>
  Math.hypot(chain.joints[i].x - chain.joints[i - 1].x, chain.joints[i].y - chain.joints[i - 1].y);

const tail = (chain: Chain) => chain.joints[chain.joints.length - 1];

const made = () => {
  const chain = new Chain(LINKS, SPACING);
  chain.straighten(0, 0, 0, SPACING * (LINKS - 1));
  return chain;
};

describe('Chain — the links', () => {
  it('is as long as its links laid end to end', () => {
    expect(made().length).toBeCloseTo(SPACING * (LINKS - 1), 6);
  });

  it('holds every link at exactly its spacing, wherever the ends go', () => {
    const chain = made();

    for (let i = 0; i < 200; i++) {
      chain.span(
        Math.cos(i * 0.23) * 300,
        Math.sin(i * 0.31) * 300,
        Math.cos(i * 0.05) * 40,
        Math.sin(i * 0.07) * 40
      );
    }

    for (let i = 1; i < chain.joints.length; i++) {
      expect(gap(chain, i)).toBeCloseTo(SPACING, 6);
    }
  });
});

describe('Chain — both ends', () => {
  it('leaves the tail exactly on its anchor', () => {
    const chain = made();

    for (let i = 0; i < 60; i++) {
      chain.span(Math.cos(i * 0.4) * 200, Math.sin(i * 0.4) * 200, 7, -3);
    }

    expect(tail(chain).x).toBeCloseTo(7, 6);
    expect(tail(chain).y).toBeCloseTo(-3, 6);
  });

  it('reaches a head it can reach', () => {
    const chain = made();
    // Half the chain's length away: comfortably inside its reach.
    const target = { x: chain.length * 0.5, y: 0 };

    for (let i = 0; i < 40; i++) chain.span(target.x, target.y, 0, 0);

    expect(Math.hypot(chain.joints[0].x - target.x, chain.joints[0].y - target.y)).toBeLessThan(
      0.5
    );
  });

  /**
   * The whole reason `span` clamps rather than letting the solver decide. A
   * whip swung at something out of range should fall short, still attached —
   * not detach at the mouth and hover at the target.
   */
  it('falls short of a head it cannot reach, and stays anchored', () => {
    const chain = made();
    const far = chain.length * 3;

    for (let i = 0; i < 40; i++) chain.span(far, 0, 0, 0);

    expect(tail(chain).x).toBeCloseTo(0, 6);
    expect(tail(chain).y).toBeCloseTo(0, 6);
    // Stretched out towards it and no further: the head sits at the chain's
    // full length, never past it. Not exactly on it, because every frame ends
    // on the pass that pins the tail — a sub-pixel shortfall on a 112px whip
    // is the price of the mouth never letting go.
    expect(chain.joints[0].x).toBeLessThanOrEqual(chain.length);
    expect(chain.joints[0].x).toBeGreaterThan(chain.length - 1);
  });

  /**
   * Slack has to *stay* somewhere. A chain re-derived from its two endpoints
   * every frame is a straight line with a kink, and reads as a stick: this is
   * the assertion that the previous frame's shape is what the next one bends
   * out of. Both ends sit on the same point, so a straight chain is the
   * degenerate answer and any real one is folded well away from it.
   */
  it('keeps the slack it had rather than snapping straight', () => {
    const chain = made();
    // Swung out sideways, then brought home: the loop should still be hanging.
    for (let i = 0; i < 20; i++) chain.span(chain.length * 0.9, 0, 0, 0);
    for (let i = 0; i < 6; i++) chain.span(0, 0, 0, 0);

    const middle = chain.joints[Math.floor(chain.joints.length / 2)];
    expect(Math.hypot(middle.x, middle.y)).toBeGreaterThan(SPACING);
  });
});

describe('Chain — the degenerate frames', () => {
  it('stays finite when both ends are the same point', () => {
    const chain = new Chain(LINKS, SPACING);
    chain.straighten(0, 0, 0, 0);

    for (let i = 0; i < 10; i++) chain.span(0, 0, 0, 0);

    for (const joint of chain.joints) {
      expect(Number.isFinite(joint.x)).toBe(true);
      expect(Number.isFinite(joint.y)).toBe(true);
    }
    for (let i = 1; i < chain.joints.length; i++) {
      expect(gap(chain, i)).toBeCloseTo(SPACING, 6);
    }
  });

  it('cannot be built with fewer than two joints', () => {
    expect(new Chain(0, SPACING).joints.length).toBeGreaterThanOrEqual(2);
    expect(new Chain(1, SPACING).joints.length).toBeGreaterThanOrEqual(2);
  });
});
