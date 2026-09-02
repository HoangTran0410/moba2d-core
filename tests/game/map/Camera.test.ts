import { afterEach, describe, expect, it, vi } from 'vitest';
import Camera, {
  baseScaleFor,
  clampZoomFactor,
  SCALE_MIN,
  SHAKE_DECAY_MS,
  SHAKE_MAX_PX,
  VISION_SPAN,
} from '../../../src/game/gameObject/map/Camera';

describe('baseScaleFor', () => {
  // The spec's table. A landscape phone is the case the whole feature exists
  // for, and 0.39 is below the clamp floor the old code shipped (0.5) — which
  // is why SCALE_MIN is asserted here rather than left implicit.
  it.each<[string, number, number, number]>([
    ['phone landscape', 844, 390, 0.39],
    ['phone portrait', 390, 844, 0.39],
    ['tablet', 1180, 820, 0.82],
    ['laptop', 1440, 900, 0.9],
    ['desktop', 2560, 1440, 1.44],
    ['ultrawide', 3440, 1440, 1.44],
  ])('%s: %ix%i -> %f', (_name, w, h, expected) => {
    expect(baseScaleFor(w, h)).toBeCloseTo(expected, 5);
  });

  it('keys off the shorter side, so an ultrawide is not punished for its width', () => {
    expect(baseScaleFor(3440, 1440)).toBe(baseScaleFor(1440, 1440));
  });

  it('admits a landscape phone: the floor is below 0.39, not the old 0.5', () => {
    expect(baseScaleFor(844, 390)).toBeGreaterThan(SCALE_MIN);
    expect(SCALE_MIN).toBeLessThan(0.39);
  });

  it('VISION_SPAN is the full vision circle, not the radius', () => {
    expect(VISION_SPAN).toBe(1000);
  });
});

describe('clampZoomFactor', () => {
  it('clamps to the manual range and passes the default through', () => {
    expect(clampZoomFactor(1)).toBe(1);
    expect(clampZoomFactor(0.1)).toBe(0.6);
    expect(clampZoomFactor(99)).toBe(1.6);
  });
});

describe('constantSize', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a world size that renders as `px` on screen, at any scale', () => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
    const c = new Camera();
    for (const scale of [0.39, 1, 1.44]) {
      c.currentScale = scale;
      expect(c.constantSize(12) * scale).toBeCloseTo(12, 5);
    }
  });

  it('does not divide by zero', () => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
    const c = new Camera();
    c.currentScale = 0;
    expect(Number.isFinite(c.constantSize(12))).toBe(true);
  });
});

describe('shake', () => {
  afterEach(() => vi.unstubAllGlobals());

  const camera = (): Camera => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
    const c = new Camera();
    c.currentScale = 1;
    c.snapshotRenderOrigin();
    return c;
  };

  it('accumulates trauma, clamped at 1, and decays it on the render clock', () => {
    const c = camera();
    c.shake(0.6);
    c.shake(0.6);
    expect(c.shaking).toBe(true);
    c.advanceShake(SHAKE_DECAY_MS / 2);
    expect(c.shaking).toBe(true);
    c.advanceShake(SHAKE_DECAY_MS / 2);
    expect(c.shaking).toBe(false);
  });

  it('moves the substituted camera and never the true one', () => {
    const c = camera();
    c.position.x = 100;
    c.position.y = 50;
    c.snapshotRenderOrigin();
    c.shake(1);
    c.advanceShake(0);
    c.applyRenderOrigin(1);
    const moved = Math.hypot(c.position.x - 100, c.position.y - 50);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(SHAKE_MAX_PX + 1e-9);
    c.restoreRenderOrigin();
    expect(c.position.x).toBe(100);
    expect(c.position.y).toBe(50);
  });

  it('is the same number of screen pixels at any zoom', () => {
    const c = camera();
    c.currentScale = 0.5;
    c.shake(1);
    c.advanceShake(0);
    c.applyRenderOrigin(1);
    // Half the scale, twice the world offset: `constantSize` at work.
    expect(Math.hypot(c.position.x, c.position.y) * 0.5).toBeCloseTo(SHAKE_MAX_PX, 5);
    c.restoreRenderOrigin();
  });

  it('is quadratic in trauma, so a small hit barely moves the picture', () => {
    const c = camera();
    c.shake(0.3);
    c.advanceShake(0);
    c.applyRenderOrigin(1);
    expect(Math.hypot(c.position.x, c.position.y)).toBeCloseTo(0.09 * SHAKE_MAX_PX, 5);
    c.restoreRenderOrigin();
  });

  it('is inert when disabled, and disabling stops a shake in progress', () => {
    const c = camera();
    c.shake(1);
    c.setShakeEnabled(false);
    expect(c.shaking).toBe(false);
    c.shake(1);
    expect(c.shaking).toBe(false);
    c.advanceShake(0);
    c.applyRenderOrigin(1);
    expect(c.position.x).toBe(0);
    expect(c.position.y).toBe(0);
    c.restoreRenderOrigin();
  });

  it('settles to a zero offset once the trauma is spent', () => {
    const c = camera();
    c.shake(1);
    c.advanceShake(SHAKE_DECAY_MS * 2);
    c.advanceShake(16);
    c.applyRenderOrigin(1);
    expect(c.position.x).toBe(0);
    expect(c.position.y).toBe(0);
    c.restoreRenderOrigin();
  });
});
