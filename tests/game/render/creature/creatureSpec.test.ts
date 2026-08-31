import { describe, expect, it } from 'vitest';
import { RIG_DEFAULTS, resolveRig } from '@/game/render/creature/creatureSpec';
import { MAP_BACKGROUND_GREY, luminance } from '@/game/render/palette';

/** A body 40 across, so a default `reach` of 1.6 radii is 32. */
const RADIUS = 20;

describe('resolveRig — nothing declared', () => {
  it('builds no rig at all when the pack said nothing', () => {
    expect(resolveRig(undefined, RADIUS)).toBeUndefined();
  });

  /**
   * `rig: {}` is a pack that opened the door and walked away. Building an
   * avatar-bodied, legless rig for it would cost a per-frame call to draw
   * exactly what `AttackableUnit` already draws.
   */
  it('builds no rig for a declaration with nothing in it', () => {
    expect(resolveRig({}, RADIUS)).toBeUndefined();
  });
});

describe('resolveRig — legs', () => {
  it('turns the reach ratio into world units against the body', () => {
    const rig = resolveRig({ legs: { count: 6 } }, RADIUS);

    expect(rig?.legs?.config.reach).toBeCloseTo(32, 6);
    expect(rig?.legs?.config.bodyRadius).toBe(RADIUS);
  });

  it('scales with the body, so one spec reads at any size', () => {
    const small = resolveRig({ legs: { count: 6 } }, 10);
    const big = resolveRig({ legs: { count: 6 } }, 60);

    expect(small?.legs?.config.reach).toBeCloseTo(16, 6);
    expect(big?.legs?.config.reach).toBeCloseTo(96, 6);
  });

  it('reads bend as a direction, not as a number', () => {
    expect(resolveRig({ legs: { count: 4, bend: 'up' } }, RADIUS)?.legs?.config.bend).toBe(1);
    expect(resolveRig({ legs: { count: 4, bend: 'down' } }, RADIUS)?.legs?.config.bend).toBe(-1);
  });

  /**
   * The validator rejects an odd count before a pack can install, but a map
   * slot's override and a hand-edited `localStorage` map both reach here too.
   * An odd count leaves one leg with no opposite and the gait limps.
   */
  it('rounds an odd count down to a pair', () => {
    expect(resolveRig({ legs: { count: 7 } }, RADIUS)?.legs?.config.count).toBe(6);
  });

  /**
   * Every number here is clamped rather than refused, because the validator no
   * longer refuses them — see `validate.test.ts`. This is the only thing
   * standing between a typo in the editor and a rig that draws nonsense.
   */
  it('falls back to the default for a reach that cannot mean anything', () => {
    expect(resolveRig({ legs: { count: 6, reach: -1 } }, RADIUS)?.legs?.config.reach).toBeCloseTo(
      32,
      6
    );
    expect(resolveRig({ legs: { count: 6, reach: 0 } }, RADIUS)?.legs?.config.reach).toBeCloseTo(
      32,
      6
    );
  });

  it('holds step, spread and thickness inside what can be drawn', () => {
    const wild = resolveRig(
      { legs: { count: 6, step: 9, spread: 99, thickness: 500 } },
      RADIUS
    )?.legs;

    expect(wild?.config.step).toBeLessThanOrEqual(1);
    expect(wild?.config.step).toBeGreaterThan(0);
    expect(wild?.config.spread).toBeLessThanOrEqual(Math.PI);
    expect(wild?.thickness).toBeLessThanOrEqual(RADIUS);
  });

  it('holds the count inside what a creature can carry', () => {
    expect(resolveRig({ legs: { count: 1 } }, RADIUS)?.legs?.config.count).toBe(2);
    expect(resolveRig({ legs: { count: 40 } }, RADIUS)?.legs?.config.count).toBe(12);
  });

  it('defaults the body to the avatar, so legs alone keep the sprite', () => {
    expect(resolveRig({ legs: { count: 6 } }, RADIUS)?.body).toBe('avatar');
  });
});

describe('resolveRig — body', () => {
  it('keeps a procedural body with no legs', () => {
    const rig = resolveRig({ body: { kind: 'orb', color: [140, 90, 255] } }, RADIUS);

    expect(rig?.body).toMatchObject({ kind: 'orb', color: [140, 90, 255] });
    expect(rig?.legs).toBeUndefined();
  });
});

/**
 * The bug this exists for shipped: legs drawn in `[26, 30, 40]` on a floor
 * painted `background(30)`, a luminance difference of 0.1 out of 255. They were
 * not faint, they were *absent*, and every other test passed — the rig walked
 * correctly, in a colour nobody could see.
 *
 * The map is dark everywhere a camp can stand (floor 30, water `#082740` at 34
 * luma, bush `#10613a` at 77, walls `#777` at 119), so a leg has to be light.
 * The floor is what this pins, because it is the surface every camp actually
 * walks on; the others are listed so a future colour can be checked by eye
 * against the same list.
 */
describe('the default leg colour against the map it is drawn on', () => {
  const FLOOR = luminance([MAP_BACKGROUND_GREY, MAP_BACKGROUND_GREY, MAP_BACKGROUND_GREY]);

  it('is far enough from the floor to be visible at all', () => {
    expect(Math.abs(luminance(RIG_DEFAULTS.color) - FLOOR)).toBeGreaterThan(90);
  });

  it('is lighter than the floor rather than darker, because the map is dark', () => {
    expect(luminance(RIG_DEFAULTS.color)).toBeGreaterThan(FLOOR);
  });

  /** Walls are the lightest thing a leg can cross, at 119 luma. */
  it('still separates from a wall', () => {
    expect(Math.abs(luminance(RIG_DEFAULTS.color) - luminance([119, 119, 119]))).toBeGreaterThan(40);
  });
});
