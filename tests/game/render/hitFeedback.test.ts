import { describe, expect, it } from 'vitest';
import {
  DEATH_SHAKE_TRAUMA,
  KILL_SHAKE_TRAUMA,
  damageTextScale,
  hitFlashMs,
  hitFraction,
  hitShakeTrauma,
} from '@/game/render/hitFeedback';

/**
 * The maths behind "a hit you can feel": every number here is a fraction of
 * the victim's max health in, and a presentation quantity out. Pure, so the
 * three consumers (flash, text, camera) can be tuned in one file and tested
 * without a canvas.
 */
describe('hitFraction', () => {
  it('is the hit as a share of max health, clamped to [0, 1]', () => {
    expect(hitFraction(25, 100)).toBe(0.25);
    expect(hitFraction(300, 100)).toBe(1);
    expect(hitFraction(-5, 100)).toBe(0);
  });

  it('treats a missing or zero pool as no fraction, not infinity', () => {
    expect(hitFraction(20, 0)).toBe(0);
    expect(hitFraction(20, Number.NaN)).toBe(0);
  });
});

describe('hitFlashMs', () => {
  it('grows with the bite and stops growing past the heavy-hit threshold', () => {
    expect(hitFlashMs(0, false)).toBe(120);
    expect(hitFlashMs(0.15, false)).toBe(200);
    expect(hitFlashMs(1, false)).toBe(200);
    expect(hitFlashMs(0.075, false)).toBe(160);
  });

  it('holds a crit a little longer', () => {
    expect(hitFlashMs(0, true)).toBe(hitFlashMs(0, false) + 40);
  });
});

describe('damageTextScale', () => {
  it('is 1 for a scratch and 1.5 for a quarter of the pool or more', () => {
    expect(damageTextScale(0, false)).toBe(1);
    expect(damageTextScale(0.25, false)).toBe(1.5);
    expect(damageTextScale(1, false)).toBe(1.5);
    expect(damageTextScale(0.125, false)).toBe(1.25);
  });

  it('marks a crit by size, never by colour, and caps the product', () => {
    expect(damageTextScale(0, true)).toBeCloseTo(1.3, 5);
    expect(damageTextScale(1, true)).toBeCloseTo(1.9, 5);
  });
});

describe('hitShakeTrauma', () => {
  it('ignores chip damage and ramps to its ceiling at a third of the pool', () => {
    expect(hitShakeTrauma(0.04, false)).toBe(0);
    expect(hitShakeTrauma(0.05, false)).toBe(0);
    expect(hitShakeTrauma(0.3, false)).toBeCloseTo(0.45, 5);
    expect(hitShakeTrauma(1, false)).toBeCloseTo(0.45, 5);
    expect(hitShakeTrauma(0.175, false)).toBeCloseTo(0.225, 5);
  });

  it('adds a kick for a crit, even a small one', () => {
    expect(hitShakeTrauma(0.01, true)).toBeCloseTo(0.1, 5);
  });

  it('keeps death above a kill above any single hit', () => {
    expect(DEATH_SHAKE_TRAUMA).toBeGreaterThan(hitShakeTrauma(1, true));
    expect(KILL_SHAKE_TRAUMA).toBeLessThan(DEATH_SHAKE_TRAUMA);
    expect(KILL_SHAKE_TRAUMA).toBeGreaterThan(0);
  });
});
