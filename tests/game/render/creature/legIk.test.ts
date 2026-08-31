import { describe, expect, it } from 'vitest';
import { solveTwoBone } from '@/game/render/creature/legIk';

/**
 * The joint solve, on its own.
 *
 * Every failure this file guards against looks the same on screen — a leg that
 * is simply not there — because a `NaN` coordinate does not throw, it just
 * makes `line()` draw nothing. So the reachable case is one assertion and the
 * three degenerate ones are the rest of the file.
 */
const from = (a: { x: number; y: number }, x: number, y: number) => Math.hypot(a.x - x, a.y - y);

describe('solveTwoBone', () => {
  it('puts the knee exactly one bone from each end', () => {
    const knee = solveTwoBone(0, 0, 60, 0, 40, 40, 1);

    expect(from(knee, 0, 0)).toBeCloseTo(40, 6);
    expect(from(knee, 60, 0)).toBeCloseTo(40, 6);
  });

  it('honours bones of different lengths', () => {
    const knee = solveTwoBone(0, 0, 50, 0, 20, 40, 1);

    expect(from(knee, 0, 0)).toBeCloseTo(20, 6);
    expect(from(knee, 50, 0)).toBeCloseTo(40, 6);
  });

  it('bends to opposite sides of the hip-foot line', () => {
    const one = solveTwoBone(0, 0, 60, 0, 40, 40, 1);
    const other = solveTwoBone(0, 0, 60, 0, 40, 40, -1);

    expect(one.y).toBeGreaterThan(0);
    expect(other.y).toBeCloseTo(-one.y, 6);
  });

  /**
   * `Math.acos` of anything over 1 is `NaN`, and the law of cosines hands it
   * exactly that the moment a foot is further away than the leg is long — which
   * happens on the very first frame, before any foot has been planted.
   */
  it('extends straight at a target it cannot reach, and returns no NaN', () => {
    const knee = solveTwoBone(0, 0, 200, 0, 40, 40, 1);

    expect(Number.isFinite(knee.x)).toBe(true);
    expect(Number.isFinite(knee.y)).toBe(true);
    expect(knee.x).toBeCloseTo(40, 6);
    expect(knee.y).toBeCloseTo(0, 6);
  });

  /** The other end of the same square root: a target too close to fold around. */
  it('survives a target closer than the bones can fold', () => {
    const knee = solveTwoBone(0, 0, 5, 0, 40, 10, 1);

    expect(Number.isFinite(knee.x)).toBe(true);
    expect(Number.isFinite(knee.y)).toBe(true);
  });

  it('survives a foot sitting exactly on the hip', () => {
    const knee = solveTwoBone(10, 10, 10, 10, 40, 40, 1);

    expect(Number.isFinite(knee.x)).toBe(true);
    expect(Number.isFinite(knee.y)).toBe(true);
  });
});
