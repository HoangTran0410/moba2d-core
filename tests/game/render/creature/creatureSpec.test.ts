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

describe('resolveRig — a segmented body', () => {
  const chain = (over: Record<string, unknown> = {}) =>
    resolveRig({ body: { kind: 'chain', widths: [1, 0.8, 0.6, 0.4], ...over } }, RADIUS);

  it('turns every width into world units against the body', () => {
    const body = chain()?.body as { kind: 'chain'; config: { widths: number[] } };

    expect(body.kind).toBe('chain');
    expect(body.config.widths).toEqual([20, 16, 12, 8]);
  });

  it('spaces the vertebrae against the body too, so one spec reads at any size', () => {
    const small = resolveRig({ body: { kind: 'chain', widths: [1, 0.5] } }, 10);
    const big = resolveRig({ body: { kind: 'chain', widths: [1, 0.5] } }, 40);

    expect((small?.body as { config: { spacing: number } }).config.spacing).toBeCloseTo(9, 6);
    expect((big?.body as { config: { spacing: number } }).config.spacing).toBeCloseTo(36, 6);
  });

  /**
   * A spine of one vertebra is a circle with extra steps, and the outline code
   * has no flank to trace. Clamped to the body it already knows how to draw
   * rather than refused — see the note on clamping in `creatureSpec.ts`.
   */
  it('falls back to a plain body when there are not enough vertebrae', () => {
    expect(resolveRig({ body: { kind: 'chain', widths: [1] } }, RADIUS)?.body).toMatchObject({
      kind: 'orb',
    });
  });

  it('lets a tail taper to a point but never inside out', () => {
    const body = chain({ widths: [1, 0.5, 0, -3] })?.body as { config: { widths: number[] } };

    expect(body.config.widths).toEqual([20, 10, 0, 0]);
  });

  it('holds the bend limit inside what a joint can do', () => {
    expect((chain({ bend: 99 })?.body as { config: { bend: number } }).config.bend).toBeLessThanOrEqual(
      Math.PI / 2
    );
    expect((chain({ bend: -1 })?.body as { config: { bend: number } }).config.bend).toBeGreaterThan(0);
  });
});

describe('resolveRig — where legs mount on a spine', () => {
  const withLegs = (legs: Record<string, unknown>) =>
    resolveRig(
      { body: { kind: 'chain', widths: [1, 0.9, 0.8, 0.7, 0.6, 0.4] }, legs: { count: 4, ...legs } },
      RADIUS
    );

  it('spreads the pairs down the spine when the pack names no joints', () => {
    const on = withLegs({})?.legs?.on ?? [];

    expect(on).toHaveLength(2);
    expect(on[0]).toBeLessThan(on[1]);
    // Never the head or the tail tip: a leg on either reads as an antenna.
    for (const joint of on) {
      expect(joint).toBeGreaterThan(0);
      expect(joint).toBeLessThan(5);
    }
  });

  it('takes the joints the pack named', () => {
    expect(withLegs({ on: [1, 4] })?.legs?.on).toEqual([1, 4]);
  });

  it('holds a named joint inside the spine it actually has', () => {
    expect(withLegs({ on: [-2, 99] })?.legs?.on).toEqual([0, 5]);
  });

  it('gives a pair with no joint named one of its own', () => {
    // Three pairs, two joints named: the third still has to hang somewhere.
    const on = resolveRig(
      {
        body: { kind: 'chain', widths: [1, 0.9, 0.8, 0.7, 0.6, 0.4] },
        legs: { count: 6, on: [1, 3] },
      },
      RADIUS
    )?.legs?.on;

    expect(on).toHaveLength(3);
  });
});

describe('resolveRig — legs nobody asked for', () => {
  /**
   * Reported: a camp set to a segmented body and *no* legs grew two anyway.
   *
   * `count` is the one field a legs block cannot do without, and a block that
   * has lost it — cleared in the inspector, or left behind by a colour picked
   * once and undone — used to fall through `Number(undefined) || MIN_LEGS` and
   * come out as a pair. "Nothing declared" has to mean no legs, not the fewest
   * legs a creature could have.
   */
  it('builds no legs when the count is gone', () => {
    const leftovers = { legs: { color: [1, 2, 3] } } as unknown as Parameters<typeof resolveRig>[0];

    expect(resolveRig(leftovers, RADIUS)).toBeUndefined();
  });

  it('builds no legs for a chain body whose legs block says nothing', () => {
    const rig = resolveRig(
      { body: { kind: 'chain', widths: [1, 0.8, 0.6] }, legs: {} } as unknown as Parameters<
        typeof resolveRig
      >[0],
      RADIUS
    );

    expect(rig?.body).toMatchObject({ kind: 'chain' });
    expect(rig?.legs).toBeUndefined();
  });

  it('still builds legs when the count is there', () => {
    expect(resolveRig({ legs: { count: 4 } }, RADIUS)?.legs?.config.count).toBe(4);
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
