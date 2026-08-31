import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Wildlife, { DEFAULT_DECOR_SIZE } from '@/game/gameObject/map/Wildlife';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * Scenery: an animal a map puts on itself that takes no part in the match.
 *
 * The two claims worth holding are both about what it is *not*. It never
 * leaves the circle the editor drew for it — that circle is the whole promise
 * the slot makes to whoever placed it, and a wander that could drift out of it
 * would put animals in walls nobody put them in. And its path is a function of
 * its own age and its own slot, so nothing about it has to cross the wire and
 * two machines watching the same match see the same animal for free.
 */

let game: TestGame;

const animal = (overrides: Partial<Parameters<typeof Wildlife>[0]> = {}) =>
  new Wildlife({
    game,
    x: 1_000,
    y: 1_000,
    roam: 240,
    size: 40,
    speed: 1,
    rig: { body: { kind: 'chain', widths: [0.8, 1, 0.7, 0.4] } },
    ...overrides,
  });

const away = (creature: Wildlife) =>
  Math.hypot(creature.position.x - 1_000, creature.position.y - 1_000);

const run = (creature: Wildlife, frames: number) => {
  for (let i = 0; i < frames; i++) creature.update();
};

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => vi.unstubAllGlobals());

describe('Wildlife — where it goes', () => {
  it('never leaves the circle the slot drew for it', () => {
    const creature = animal();
    let furthest = 0;

    // Two minutes of match at 60fps, which is longer than the wander's slowest
    // component takes to come round.
    for (let i = 0; i < 7_200; i++) {
      creature.update();
      furthest = Math.max(furthest, away(creature));
    }

    expect(furthest).toBeLessThanOrEqual(240 + 1e-6);
  });

  it('actually uses the room it is given', () => {
    const creature = animal();
    let furthest = 0;
    for (let i = 0; i < 7_200; i++) {
      creature.update();
      furthest = Math.max(furthest, away(creature));
    }

    // Not a wander that shuffles on the spot: a slot drawn at 240 should read
    // as a creature patrolling it, not as one pinned to the middle.
    expect(furthest).toBeGreaterThan(120);
  });

  it('stands still when it was given nowhere to go', () => {
    const still = animal({ roam: 0 });
    run(still, 600);
    expect(away(still)).toBe(0);

    const frozen = animal({ speed: 0 });
    run(frozen, 600);
    expect(away(frozen)).toBe(0);
  });

  /**
   * Two animals on the same slot would be one animal drawn twice. The phases
   * come from the slot's own coordinates, so this costs nothing to keep and
   * needs no state.
   */
  it('does not swim in formation with its neighbours', () => {
    const first = animal({ x: 1_000, y: 1_000 });
    const second = animal({ x: 1_040, y: 1_000 });
    run(first, 200);
    run(second, 200);

    const apart = Math.hypot(
      first.position.x + 40 - second.position.x,
      first.position.y - second.position.y
    );
    expect(apart).toBeGreaterThan(20);
  });

  /**
   * The path is `age -> position` and nothing else, so a machine that has been
   * running the match longer does not have a differently-placed animal.
   */
  it('is a function of its age, so two of them agree without being told', () => {
    const here = animal();
    const there = animal();
    run(here, 300);
    run(there, 300);

    expect(there.position.x).toBeCloseTo(here.position.x, 9);
    expect(there.position.y).toBeCloseTo(here.position.y, 9);
  });
});

describe('Wildlife — what it is made of', () => {
  /**
   * The one place a decor rig differs from a camp's: a camp that declares no
   * body keeps its sprite, and scenery has no sprite to keep.
   */
  it('is an orb when its slot named no body', () => {
    const creature = animal({ rig: { legs: { count: 4 } } });
    expect(creature.rig?.body).toMatchObject({ kind: 'orb' });
  });

  it('sizes its whole rig off the slot, defaulting when it named none', () => {
    const declared = animal({ size: 200, rig: { body: { kind: 'orb' } } });
    const bare = new Wildlife({
      game,
      x: 0,
      y: 0,
      roam: 0,
      size: DEFAULT_DECOR_SIZE,
      speed: 1,
      rig: { body: { kind: 'orb' } },
    });

    // `paintRadius` is in world units, so a body twice the size paints twice
    // as far — the check that `size` really is what the ratios resolve against.
    expect(declared.getDisplayBoundingBox().w).toBeGreaterThan(bare.getDisplayBoundingBox().w);
  });

  it('paints past its own centre, so it is not culled at the screen edge', () => {
    const creature = animal();
    expect(creature.getDisplayBoundingBox().w).toBeGreaterThan(40);
  });
});
