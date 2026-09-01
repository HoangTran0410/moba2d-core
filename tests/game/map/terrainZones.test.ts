/**
 * Zones — tagged ground that is deliberately *not* a terrain layer.
 *
 * The load-bearing tests here are the negative ones, and they are the whole
 * reason zones live in a quadtree of their own rather than in
 * `TerrainMap.obstacles`. Three consumers share that quadtree — `FogOfWar`,
 * `NavigationSystem` (through `wallPolygons`) and
 * `DynamicTerrain.wallOutlinesInArea` — and a zone reaching any of them turns
 * a patch of sand into something that blocks sight or that pathfinding
 * refuses to walk through. Neither is a thing a map said.
 *
 * See `TerrainZone` in `content/ContentPack.ts` for why a zone is not simply
 * a fourth layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerrainMap from '../../../src/game/gameObject/map/TerrainMap';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import TerrainType from '../../../src/game/enums/TerrainType';
import { Circle } from '../../../src/libs/quadtree';
import type { ActiveMap, TerrainZone } from '../../../src/content/ContentPack';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/** A square covering x,y in [0,500) — the top-left quarter of a 2000² map. */
const square = (size: number) => [
  { x: 0, y: 0 },
  { x: size, y: 0 },
  { x: size, y: size },
  { x: 0, y: size },
];

const sand = (extra: Partial<TerrainZone> = {}): TerrainZone => ({
  id: 'sand',
  name: 'Cát',
  speedMultiplier: 0.5,
  render: { fill: '#d9c08a' },
  polygons: [square(500)],
  ...extra,
});

const mapWithZones = (zones?: TerrainZone[]): ActiveMap => ({
  id: 'dunes',
  name: 'Dunes',
  size: 2_000,
  factions: [{ id: 'blue' }, { id: 'red' }],
  terrain: { wall: [], bush: [], water: [] },
  zones,
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
  vi.stubGlobal('frameCount', 1);
  game = createGame(2_000);
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('terrain zones', () => {
  it('answers which zones cover a point', () => {
    const terrainMap = new TerrainMap(game, mapWithZones([sand()]));

    expect(terrainMap.zoneIdsAt(100, 100)).toEqual(['sand']);
    expect(terrainMap.zoneIdsAt(1_500, 1_500)).toEqual([]);
    expect(terrainMap.inZone(100, 100, 'sand')).toBe(true);
    expect(terrainMap.inZone(1_500, 1_500, 'sand')).toBe(false);
    // An id no zone declares is a miss, not a throw — a spell asking about a
    // zone this map does not have is an ordinary answer of "no".
    expect(terrainMap.inZone(100, 100, 'lava')).toBe(false);
  });

  it('slows a unit standing in a zone', () => {
    const terrainMap = new TerrainMap(game, mapWithZones([sand()]));
    const walker = championAt(100, 100);
    indexObjects(game, [walker]);

    terrainMap.update();

    expect(terrainMap.terrainSpeed.affectsSpeed).toBe(true);
    expect(walker.terrainSpeedFactor).toBe(0.5);
  });

  it('leaves a unit outside every zone alone', () => {
    const terrainMap = new TerrainMap(game, mapWithZones([sand()]));
    const walker = championAt(1_500, 1_500);
    indexObjects(game, [walker]);

    terrainMap.update();

    expect(walker.terrainSpeedFactor).toBe(1);
  });

  it('multiplies overlapping zones', () => {
    // Same rule the three layers already follow — see `speedFactorAt`. A map
    // that drew two slow zones over one another has said two things about
    // that ground, and taking only one would make the answer depend on the
    // order they happen to be retrieved in.
    const terrainMap = new TerrainMap(
      game,
      mapWithZones([sand(), sand({ id: 'mud', name: 'Bùn', speedMultiplier: 0.5 })])
    );

    expect(terrainMap.speedFactorAt(100, 100)).toBe(0.25);
  });

  it('costs nothing on a map that declares no zone that changes speed', () => {
    // The negative case `terrainSpeed.test.ts` guards for the layers, guarded
    // again here: a zone that only tints the ground must not switch the
    // per-frame pass on for every map that has one.
    const terrainMap = new TerrainMap(
      game,
      mapWithZones([sand({ speedMultiplier: undefined })])
    );
    const walker = championAt(100, 100);
    walker.terrainSpeedFactor = 0.123;
    indexObjects(game, [walker]);

    terrainMap.update();

    expect(terrainMap.terrainSpeed.affectsSpeed).toBe(false);
    expect(walker.terrainSpeedFactor).toBe(0.123);
  });

  it('keeps zones out of the obstacle quadtree entirely', () => {
    // The whole reason zones are a separate structure. `FogOfWar`,
    // `NavigationSystem` and `DynamicTerrain` all read this quadtree, and a
    // zone arriving in any of them is sand that blocks sight or that
    // pathfinding walks around.
    const terrainMap = new TerrainMap(game, mapWithZones([sand()]));

    expect(terrainMap.obstacles).toHaveLength(0);
    expect(terrainMap.wallPolygons()).toHaveLength(0);
    expect(
      terrainMap.getObstaclesInArea(new Circle({ x: 100, y: 100, r: 50 }))
    ).toHaveLength(0);
    // And it is not reachable by pretending to be a layer, either.
    expect(terrainMap.containsPoint(100, 100, TerrainType.BUSH)).toBe(false);
    expect(terrainMap.containsPoint(100, 100, 'sand')).toBe(false);
  });

  it('treats a map with no zones exactly as before', () => {
    const terrainMap = new TerrainMap(game, mapWithZones());

    expect(terrainMap.zoneIdsAt(100, 100)).toEqual([]);
    expect(terrainMap.terrainSpeed.affectsSpeed).toBe(false);
    expect(terrainMap.speedFactorAt(100, 100)).toBe(1);
  });
});
