/**
 * Terrain that changes how fast you move.
 *
 * This is a **new mechanic**, not a constant that was finally exposed: before
 * it, bush set a vision flag and water drew ripples, and nothing on the map
 * touched anyone's speed. So the load-bearing case here is the *negative* one
 * — a map that declares nothing must run no query and write no factor, which
 * is what keeps every map that already exists free of the cost and free of
 * the behaviour change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerrainMap from '../../../src/game/gameObject/map/TerrainMap';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Turret from '../../../src/game/gameObject/structures/Turret';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import type { ActiveMap, MapTuning } from '../../../src/content/ContentPack';
import {
  createGame,
  indexObjects,
  stubGameGlobals,
  TEST_AVATAR_KEY,
  type TestGame,
} from '../fixtures';

/** A 2000² map whose left half, x < 1000, is water. */
const mapWithRiver = (tuning?: MapTuning): ActiveMap => ({
  id: 'river',
  name: 'River',
  size: 2_000,
  factions: [{ id: 'blue' }, { id: 'red' }],
  tuning,
  terrain: {
    wall: [],
    bush: [
      [
        { x: 1_400, y: 0 },
        { x: 1_800, y: 0 },
        { x: 1_800, y: 400 },
        { x: 1_400, y: 400 },
      ],
    ],
    water: [
      [
        { x: 0, y: 0 },
        { x: 1_000, y: 0 },
        { x: 1_000, y: 2_000 },
        { x: 0, y: 2_000 },
      ],
    ],
  },
  slots: { spawn: [], minion: [], structure: [], neutral: [] },
});

let game: TestGame;

const championAt = (x: number, y: number) => {
  const champion = new Champion({ game, teamId: 'blue' });
  champion.position.set(x, y);
  champion.destination.set(x, y);
  return champion;
};

beforeEach(() => {
  stubGameGlobals();
  // `TerrainMap.update`'s champion pass gates its ripple particles on
  // `frameCount % 45`, and `stubGameGlobals` does not carry that one.
  vi.stubGlobal('frameCount', 1);
  game = createGame(2_000);
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('terrain speed', () => {
  it('does nothing at all on a map that declares no multiplier', () => {
    const terrainMap = new TerrainMap(game, mapWithRiver());
    const swimmer = championAt(500, 500);
    // A sentinel no code path would produce: if the pass ran, it would be
    // overwritten with a real factor.
    swimmer.terrainSpeedFactor = 0.123;
    indexObjects(game, [swimmer]);

    terrainMap.update();

    expect(terrainMap.terrainSpeed.affectsSpeed).toBe(false);
    expect(swimmer.terrainSpeedFactor).toBe(0.123);
  });

  it('slows a unit standing in the water', () => {
    const terrainMap = new TerrainMap(
      game,
      mapWithRiver({ terrain: { water: { speedMultiplier: 0.5 } } })
    );
    const swimmer = championAt(500, 500);
    const walker = championAt(1_500, 1_500);
    indexObjects(game, [swimmer, walker]);

    terrainMap.update();

    expect(swimmer.terrainSpeedFactor).toBe(0.5);
    expect(walker.terrainSpeedFactor).toBe(1);
  });

  it('clears the factor again when the unit leaves', () => {
    const terrainMap = new TerrainMap(
      game,
      mapWithRiver({ terrain: { water: { speedMultiplier: 0.5 } } })
    );
    const swimmer = championAt(500, 500);
    indexObjects(game, [swimmer]);
    terrainMap.update();
    expect(swimmer.terrainSpeedFactor).toBe(0.5);

    swimmer.position.set(1_500, 1_500);
    indexObjects(game, [swimmer]);
    terrainMap.update();

    expect(swimmer.terrainSpeedFactor).toBe(1);
  });

  it('can hurry as well as slow, and does bush separately from water', () => {
    const terrainMap = new TerrainMap(
      game,
      mapWithRiver({
        terrain: { water: { speedMultiplier: 0.5 }, bush: { speedMultiplier: 1.3 } },
      })
    );
    const inBush = championAt(1_600, 200);
    const inWater = championAt(500, 500);
    indexObjects(game, [inBush, inWater]);

    terrainMap.update();

    expect(inBush.terrainSpeedFactor).toBeCloseTo(1.3);
    expect(inWater.terrainSpeedFactor).toBe(0.5);
  });

  it('leaves a unit with no speed alone', () => {
    // A turret has no speed to modify. The skip reads *speed*, not
    // `isImmovable`, which it used to: that flag means "nothing else may move
    // this", and the case below is a body that holds its ground and still
    // walks.
    const terrainMap = new TerrainMap(
      game,
      mapWithRiver({ terrain: { water: { speedMultiplier: 0.5 } } })
    );
    const turret = new Turret({ game, position: createVector(500, 500), teamId: 'blue' });
    indexObjects(game, [turret]);

    terrainMap.update();

    expect(turret.terrainSpeedFactor).toBe(1);
  });

  it('still slows a body that holds its ground but walks under its own power', () => {
    // `anchored` splits "cannot be moved" from "cannot walk". A body that is
    // the first without being the second has a real speed, so the river has
    // to slow it — reading `isImmovable` here would have skipped it and made
    // an anchored boss the one thing in the game the water does not touch.
    const terrainMap = new TerrainMap(
      game,
      mapWithRiver({ terrain: { water: { speedMultiplier: 0.5 } } })
    );
    const boss = new Monster({
      game,
      preset: {
        name: 'Boss',
        avatar: TEST_AVATAR_KEY,
        camp: { x: 500, y: 500, r: 100 },
        speed: 2,
        size: 80,
        attackRange: 300,
        reviveTime: 1_000,
        health: 600,
        anchored: true,
      },
    } as ConstructorParameters<typeof Monster>[0]);
    boss.position.set(500, 500);
    indexObjects(game, [boss]);

    terrainMap.update();

    expect(boss.isImmovable, 'the fixture is not anchored, so this proves nothing').toBe(true);
    expect(boss.terrainSpeedFactor).toBe(0.5);
  });

  it('does not touch isInsideBush for anything the old pass did not', () => {
    // The speed pass is deliberately separate from the champion pass, which
    // owns `isInsideBush` — a vision flag. Widening that loop to save a query
    // would have put every minion into brush stealth as a side effect.
    const terrainMap = new TerrainMap(
      game,
      mapWithRiver({ terrain: { bush: { speedMultiplier: 1.3 } } })
    );
    const inBush = championAt(1_600, 200);
    indexObjects(game, [inBush]);

    terrainMap.update();

    // The champion pass still sets it — for champions, as it always did.
    expect(inBush.isInsideBush).toBe(true);
    expect(inBush.terrainSpeedFactor).toBeCloseTo(1.3);
  });
});

describe('the factor reaches movement', () => {
  it('halves the ground covered in one frame', () => {
    const fast = championAt(0, 0);
    const slow = championAt(0, 0);
    fast.stats.speed.baseValue = 10;
    slow.stats.speed.baseValue = 10;
    slow.terrainSpeedFactor = 0.5;
    fast.destination.set(1_000, 0);
    slow.destination.set(1_000, 0);

    fast.move();
    slow.move();

    expect(fast.position.x).toBeCloseTo(10);
    expect(slow.position.x).toBeCloseTo(5);
  });

  it('and the route follower agrees with the step actually taken', () => {
    // `moveSpeed` is what plans a frame of a route; `move()` is what takes it.
    // Disagreeing would make a unit in slowed terrain overshoot its waypoints.
    const unit = championAt(0, 0);
    unit.stats.speed.baseValue = 10;
    unit.terrainSpeedFactor = 0.5;
    expect(unit.moveSpeed).toBeCloseTo(5);
  });
});
