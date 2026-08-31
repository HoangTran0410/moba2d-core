import { describe, expect, it, vi } from 'vitest';
import BeamRenderer from '@/game/vfx/BeamRenderer';
import type { BeamGeometry } from '@/game/gameObject/spellObjects/BeamSpellObject';

/** One frame at 60fps, the rate the renderer's pass count is written for. */
const FRAME_MS = 1000 / 60;

type LiveBeam = BeamGeometry & {
  start: { x: number; y: number };
  end: { x: number; y: number };
};

const beam = (): LiveBeam => ({
  start: { x: 0, y: 0 },
  end: { x: 300, y: 0 },
  width: 12,
});

const run = (renderer: BeamRenderer, frames: number, deltaMs = FRAME_MS) => {
  for (let i = 0; i < frames; i++) renderer.update(deltaMs);
};

/** How far the rope's middle has strayed off the straight line between the ends. */
const bow = (renderer: BeamRenderer): number => {
  const rope = renderer.rope!;
  const middle = rope.joints[Math.floor(rope.joints.length / 2)];
  const { start, end } = renderer.geometry;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const across = Math.hypot(dx, dy);
  return Math.abs((middle.x - start.x) * dy - (middle.y - start.y) * dx) / across;
};

describe('BeamRenderer — the rope', () => {
  it('holds the caster end exactly on the beam it was given', () => {
    const geometry = beam();
    const renderer = new BeamRenderer(geometry);

    geometry.end.y = 260;
    run(renderer, 30);

    const rope = renderer.rope!;
    const anchored = rope.joints[rope.joints.length - 1];
    expect(anchored.x).toBeCloseTo(geometry.start.x, 4);
    expect(anchored.y).toBeCloseTo(geometry.start.y, 4);
  });

  /**
   * The reason the rope is taut rather than slack. Spare length between two
   * pinned ends has nowhere to go in a top-down view but *along the line*, and
   * it comes out as the beam's far end poking past the point it is aimed at,
   * permanently, while nothing is moving.
   */
  it('lies straight and stops where the beam stops when nothing moves', () => {
    const geometry = beam();
    const renderer = new BeamRenderer(geometry);

    run(renderer, 30);

    expect(bow(renderer)).toBeLessThan(1);
    const tip = renderer.rope!.joints[0];
    expect(tip.x).toBeLessThanOrEqual(geometry.end.x + 0.5);
    expect(tip.x).toBeGreaterThan(geometry.end.x - 1);
  });

  /**
   * The whole reason the default stopped being one `line()`. A rigid segment
   * between two moving points is the same picture at every frame of a swing;
   * this asserts the middle is somewhere the straight line is not, and then
   * that it chases the line rather than staying bent.
   */
  it('bows out behind an end that moves, then chases it down', () => {
    const geometry = beam();
    const renderer = new BeamRenderer(geometry);
    run(renderer, 10);

    geometry.end.y = 300;
    renderer.update(FRAME_MS);
    const swung = bow(renderer);
    expect(swung, 'the rope kept up perfectly, so it is still rigid').toBeGreaterThan(20);

    run(renderer, 60);
    expect(bow(renderer)).toBeLessThan(swung / 2);
  });

  /**
   * `docs/TRAPS.md`, the smoothing rule: how far the rope trails is how many
   * solver passes it got, so a fixed count per frame would make the curve a
   * function of frame rate. Same elapsed time, half the frames, same picture.
   */
  it('settles by elapsed time, not by frame count', () => {
    const fast = new BeamRenderer(beam());
    const slow = new BeamRenderer(beam());

    run(fast, 10);
    run(slow, 5, FRAME_MS * 2);
    (fast.geometry as LiveBeam).end.y = 300;
    (slow.geometry as LiveBeam).end.y = 300;

    // 20 frames of 16.7ms against 10 of 33.3ms — a third of a second either way.
    run(fast, 20);
    run(slow, 10, FRAME_MS * 2);

    expect(Math.abs(bow(fast) - bow(slow))).toBeLessThan(1);
  });
});

describe('BeamRenderer — a painter of its own', () => {
  it('builds no rope and draws only what the caller gave it', () => {
    const geometry = beam();
    const paint = vi.fn();
    const renderer = new BeamRenderer(geometry, paint);

    renderer.update(FRAME_MS);
    renderer.draw();

    expect(renderer.rope).toBeNull();
    expect(paint).toHaveBeenCalledWith(geometry);
  });

  it('draws nothing at all once disposed', () => {
    const paint = vi.fn();
    const renderer = new BeamRenderer(beam(), paint);

    renderer.dispose();
    renderer.draw();

    expect(paint).not.toHaveBeenCalled();
  });
});
