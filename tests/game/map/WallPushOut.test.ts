/**
 * A body inside a wall has to come back out of it.
 *
 * `TerrainMap.pushOutOfWalls` is the only thing that enforces walls on a moving
 * body — navigation plans around them, but a dash, a knockback, a blink or a
 * grapple all write `position` directly and hand the result to this function to
 * clean up. So "can a unit end up standing inside a wall" is entirely this
 * function's question.
 *
 * The map file cannot express a thick wall as one shape: SAT only answers for
 * convex polygons, so a slab deeper than it is wide arrives as several convex
 * boxes butted together, and the shipped map has 329 of them. That is the
 * geometry this file reproduces — not a hand-picked pathological shape, but the
 * ordinary consequence of authoring a thick wall under a convex-only collider.
 *
 * The failing case is a body between the two halves. Each half computes its own
 * minimum translation vector, each one points out of *that box* — which is into
 * the other one — and `pushOutOfWalls` averages them. Two opposed pushes average
 * to nothing, so the body stays exactly where it is, in the middle of a solid
 * wall, forever.
 *
 * The assertions here deliberately never ask the collider where the wall is.
 * `SEAM_WALL_UNION` is written out by hand, and the union of the two authored
 * boxes is a rectangle anyone can check by eye against the coordinates below —
 * a check that computed its expected value by asking the code under test would
 * agree with that code however wrong it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rectangle } from '../../../src/libs/quadtree';
import {
  TestVector,
  createGame,
  indexObjects,
  stubGameGlobals,
  TEST_AVATAR_KEY,
  type TestGame,
} from '../fixtures';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import TerrainMap from '../../../src/game/gameObject/map/TerrainMap';
import type { ActiveMap } from '../../../src/content/ContentPack';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';

/**
 * One 200x120 wall, authored the way `summoner_map.json` has to author one:
 * two convex boxes stacked across the slab's *depth*, sharing the edge at
 * y = 1060.
 */
const SEAM_MAP: ActiveMap = {
  id: 'seam-test',
  name: 'Seam Test',
  size: 6_400,
  factions: [{ id: 'blue' }, { id: 'red' }],
  terrain: {
    wall: [
      [
        { x: 1_000, y: 1_000 },
        { x: 1_200, y: 1_000 },
        { x: 1_200, y: 1_060 },
        { x: 1_000, y: 1_060 },
      ],
      [
        { x: 1_000, y: 1_060 },
        { x: 1_200, y: 1_060 },
        { x: 1_200, y: 1_120 },
        { x: 1_000, y: 1_120 },
      ],
    ],
    bush: [],
    water: [],
  },
  slots: { spawn: [], minion: [], structure: [], neutral: [] },
};

/** The two boxes above, unioned by hand. Nothing computes this. */
const SEAM_WALL_UNION = { left: 1_000, right: 1_200, top: 1_000, bottom: 1_120 };

const CHAMPION_RADIUS = 27.5;

/** Frames of push-out a body gets to escape. A tenth of a second is generous. */
const FRAMES = 6;

/**
 * How far a circle at (x, y) overlaps the union rectangle: positive means the
 * body is still in the wall, and larger means deeper. Plain
 * distance-to-rectangle-boundary, written out here rather than imported from
 * anything the fix will touch.
 *
 * The inside branch measures to the nearest *face*, not to the clamped nearest
 * point — clamping an interior point returns the point itself, so a first draft
 * of this reported the same 27.5 for a body grazing the surface and one buried
 * in the middle, which silently emptied the "never deeper" case below.
 */
const overlapWithWall = (x: number, y: number, radius: number): number => {
  const inside =
    x > SEAM_WALL_UNION.left &&
    x < SEAM_WALL_UNION.right &&
    y > SEAM_WALL_UNION.top &&
    y < SEAM_WALL_UNION.bottom;
  if (inside) {
    const depth = Math.min(
      x - SEAM_WALL_UNION.left,
      SEAM_WALL_UNION.right - x,
      y - SEAM_WALL_UNION.top,
      SEAM_WALL_UNION.bottom - y
    );
    return radius + depth;
  }
  const nearestX = Math.min(Math.max(x, SEAM_WALL_UNION.left), SEAM_WALL_UNION.right);
  const nearestY = Math.min(Math.max(y, SEAM_WALL_UNION.top), SEAM_WALL_UNION.bottom);
  return radius - Math.hypot(x - nearestX, y - nearestY);
};

/**
 * The surface `pushOutOfWalls` reads. A full `Champion` would work too and
 * would bring a constructor, a stats block and a spell list along with it;
 * these five members are the whole of what the function touches.
 */
const body = (x: number, y: number, radius = CHAMPION_RADIUS) => {
  const position = new TestVector(x, y);
  return {
    position,
    terrainRadius: radius,
    stats: { actionState: 0 },
    getCollideBoundingBox: () =>
      new Rectangle({
        x: position.x - radius,
        y: position.y - radius,
        w: radius * 2,
        h: radius * 2,
      }),
  };
};

let terrainMap: TerrainMap;

beforeEach(() => {
  stubGameGlobals();
  terrainMap = new TerrainMap({}, SEAM_MAP);
});
afterEach(() => vi.unstubAllGlobals());

const settle = (unit: ReturnType<typeof body>, frames = FRAMES) => {
  for (let frame = 0; frame < frames; frame++) {
    terrainMap.pushOutOfWalls(unit as unknown as AttackableUnit);
  }
  return overlapWithWall(unit.position.x, unit.position.y, unit.terrainRadius);
};

/**
 * Who the per-frame sweep actually covers.
 *
 * `pushOutOfWalls` is correct and always was; what decided whether a body ever
 * reached it is the query in `TerrainMap.update`, and for a long time that
 * query was champions and lane minions. A **monster** was in neither list.
 *
 * Under its own power that costs nothing — a camp roams a region the nav grid
 * already keeps out of the rock — but a camp does not move only under its own
 * power. A hook, a knock-back or a kick writes `position` directly, and the
 * body simply stopped wherever the displacement ended. Reported as a monster
 * standing inside a wall for the rest of the match.
 */
describe('the sweep TerrainMap.update runs', () => {
  let game: TestGame;
  let map: TerrainMap;

  const camp = { x: 3_000, y: 3_000, r: 300 };

  /** A camp body dropped at `(x, y)` — where a displacement left it. */
  const monsterAt = (x: number, y: number, preset: Record<string, unknown> = {}) => {
    const unit = new Monster({
      game,
      preset: {
        name: 'Wolf',
        avatar: TEST_AVATAR_KEY,
        camp,
        speed: 2,
        size: 40,
        attackRange: 50,
        reviveTime: 100,
        health: 100,
        ...preset,
      },
    } as ConstructorParameters<typeof Monster>[0]);
    unit.position.set(x, y);
    unit.destination.set(x, y);
    return unit;
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'blue' }));
    map = new TerrainMap(game as never, SEAM_MAP);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The middle of the slab — the deepest a body can be and still be in it. */
  const MIDDLE = { x: 1_100, y: 1_060 };

  it('takes a camp body back out of a wall it was thrown into', () => {
    const wolf = monsterAt(MIDDLE.x, MIDDLE.y);
    indexObjects(game, [wolf]);
    expect(
      overlapWithWall(wolf.position.x, wolf.position.y, wolf.terrainRadius),
      'the fixture did not put it in the wall'
    ).toBeGreaterThan(0);

    for (let frame = 0; frame < FRAMES; frame++) map.update();

    expect(overlapWithWall(wolf.position.x, wolf.position.y, wolf.terrainRadius)).toBeLessThanOrEqual(0);
  });

  /**
   * Scenery is left where it is. A legless anchored boss re-pins itself to
   * `home` every tick, so pushing it is at best a frame of disagreement with
   * that and at worst two rules shoving one body in opposite directions — and
   * it cannot be displaced into a wall in the first place, which is the only
   * way a camp gets into one.
   */
  it('leaves an anchored, legless boss exactly where the map put it', () => {
    const boss = monsterAt(MIDDLE.x, MIDDLE.y, { speed: 0, size: 100 });
    indexObjects(game, [boss]);

    for (let frame = 0; frame < FRAMES; frame++) map.update();

    expect(boss.position.x).toBe(MIDDLE.x);
    expect(boss.position.y).toBe(MIDDLE.y);
  });

  it('still sweeps the minions it always swept', () => {
    // The falsification: swapping the query for one that matched nothing would
    // pass the boss case above and quietly stop enforcing walls on the wave.
    const minion = new Minion({
      game,
      position: createVector(MIDDLE.x, MIDDLE.y),
      teamId: 'blue',
      lane: 'MID',
      waypoints: [{ x: MIDDLE.x, y: MIDDLE.y }],
      preset: { name: 'Melee', health: 100, damage: 5, speed: 2, size: 34, attackRange: 40 },
    } as never);
    indexObjects(game, [minion]);

    for (let frame = 0; frame < FRAMES; frame++) map.update();

    expect(
      overlapWithWall(minion.position.x, minion.position.y, minion.terrainRadius)
    ).toBeLessThanOrEqual(0);
  });
});

describe('pushOutOfWalls', () => {
  it('loads the two-box wall this file is about', () => {
    // Guards the mock rather than the collider: if the asset stopped arriving,
    // every case below would pass by having no wall to be stuck in.
    expect(terrainMap.obstacles.length).toBe(2);
  });

  it('pushes a body clear of a wall it only grazes', () => {
    // The case that has always worked, and the reason it is here is to prove
    // the harness: a body 15px under the slab's outer face, overlapping it by
    // 12.5px, with only one box in reach. If this ever goes red the fixture is
    // broken, not the collider.
    const unit = body(1_100, SEAM_WALL_UNION.bottom + 15);
    expect(overlapWithWall(unit.position.x, unit.position.y, unit.terrainRadius)).toBeCloseTo(12.5);

    expect(settle(unit)).toBeLessThanOrEqual(0);
    expect(unit.position.y).toBeGreaterThanOrEqual(SEAM_WALL_UNION.bottom + CHAMPION_RADIUS);
  });

  it('pushes a body out of the near half of a split slab', () => {
    // 5px above the shared edge: inside box A, and close enough to box B that
    // both are in reach. The nearest way out of the *wall* is straight up, 55px.
    const unit = body(1_100, 1_055);

    expect(settle(unit)).toBeLessThanOrEqual(0);
  });

  it('pushes a body off the shared edge of a split slab', () => {
    // Standing exactly on the seam — the symmetric worst case, and where an
    // averaged push is exactly zero.
    const unit = body(1_100, 1_060);

    expect(settle(unit)).toBeLessThanOrEqual(0);
  });

  it('gets a body out in a single frame, not eventually', () => {
    // The strong form, and the one that separates a correct answer from a lucky
    // one. Every implementation this replaced could pass "escapes within six
    // frames" if you gave it enough frames and a friendly starting point; none
    // of them could do it in one. Averaging moved this body 5px *deeper* and
    // then held it there. Resolving each piece in turn walks it out of one half
    // into the other and back. Reading a distance field puts it 82.5px straight
    // up — out of the slab, in the direction of the nearest surface — first go.
    //
    // Stated as an absolute rather than "no worse than before", which after the
    // fix compares 0 against 82.5 and can no longer fail.
    const unit = body(1_100, 1_055);

    terrainMap.pushOutOfWalls(unit as unknown as AttackableUnit);

    expect(
      overlapWithWall(unit.position.x, unit.position.y, unit.terrainRadius)
    ).toBeLessThanOrEqual(0);
    // Out through the near face, 55px away, not the far one 65px away.
    expect(unit.position.y).toBeLessThanOrEqual(SEAM_WALL_UNION.top - CHAMPION_RADIUS);
  });
});
