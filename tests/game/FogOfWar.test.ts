import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FogOfWar from '../../src/game/gameObject/map/FogOfWar';
import Champion from '../../src/game/gameObject/attackableUnits/Champion';
import { Rectangle } from '../../src/libs/quadtree';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from './fixtures';
import { DEFAULT_ATTACK_REVEAL_MS } from '../../src/game/combat/AttackReveal';

// Static wall polygons, far enough apart that "which wall is in range" is
// unambiguous per test position.
const wallA = {
  id: 'wall-a',
  vertices: [
    { x: 40, y: -20 },
    { x: 60, y: -20 },
    { x: 60, y: 20 },
    { x: 40, y: 20 },
  ],
};
const wallB = {
  id: 'wall-b',
  vertices: [
    { x: -60, y: -20 },
    { x: -40, y: -20 },
    { x: -40, y: 20 },
    { x: -60, y: 20 },
  ],
};
const bush = {
  id: 'bush-1',
  vertices: [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: -10, y: 10 },
  ],
};

function makeGame(getObstacles: (...args: unknown[]) => unknown) {
  return {
    terrainMap: {
      getObstaclesInChampionSight: vi.fn(getObstacles),
    },
  };
}

describe('FogOfWar sight cache', () => {
  beforeEach(() => {
    // The real p5.Graphics carries a pixelDensity setter, which FogOfWar pins
    // to 1 so a retina phone does not allocate a buffer nine times the size.
    vi.stubGlobal('createGraphics', () => ({ pixelDensity: vi.fn() }));
    vi.stubGlobal('windowWidth', 800);
    vi.stubGlobal('windowHeight', 600);
  });

  it('matches a fully fresh computation after reusing cached segments', () => {
    const game = makeGame(() => [wallA]);
    const fog = new FogOfWar(game);

    const obj = { position: { x: 0, y: 0 }, visionRadius: 100 };
    fog.getSightPoly(obj); // first call: builds and caches segments for wallA

    // Move a little; wallA is still the only obstacle in range, so the
    // cached segment list should be reused for this call.
    obj.position = { x: 5, y: 3 };
    const cached = fog.getSightPoly(obj);

    // Independently computed, uncached (no entry passed in) reference for
    // the exact same final position/radius.
    const freshObj = { position: { x: 5, y: 3 }, visionRadius: 100 };
    const fresh = fog.computeSightPoly(freshObj);

    expect(cached).toEqual(fresh);
    expect(cached.length).toBeGreaterThan(0);
  });

  it('invalidates the segment cache when the obstacle set changes, but not when it does not', () => {
    const getObstacles = vi.fn(() => [wallA]);
    const game = makeGame(getObstacles);
    const fog = new FogOfWar(game);
    const buildSegments = vi.spyOn(fog, 'buildSegments');

    const obj = { position: { x: 0, y: 0 }, visionRadius: 100 };
    fog.getSightPoly(obj);
    expect(buildSegments).toHaveBeenCalledTimes(1);

    // Move (so the exact-position early-out doesn't apply) while the
    // obstacle set in range stays the same (still just wallA).
    obj.position = { x: 1, y: 0 };
    fog.getSightPoly(obj);
    expect(buildSegments).toHaveBeenCalledTimes(1); // segments reused, not rebuilt

    // The unit crosses into a neighbourhood with a different obstacle set.
    getObstacles.mockReturnValue([wallB]);
    obj.position = { x: 2, y: 0 };
    fog.getSightPoly(obj);
    expect(buildSegments).toHaveBeenCalledTimes(2); // signature changed, segments rebuilt
  });

  it('does not recompute anything for a stationary unit', () => {
    const getObstacles = vi.fn(() => [wallA]);
    const game = makeGame(getObstacles);
    const fog = new FogOfWar(game);

    const obj = { position: { x: 10, y: 10 }, visionRadius: 100 };
    const first = fog.getSightPoly(obj);
    expect(getObstacles).toHaveBeenCalledTimes(1);

    const second = fog.getSightPoly(obj); // identical position/radius, same object
    expect(getObstacles).toHaveBeenCalledTimes(1); // no recompute at all
    expect(second).toBe(first); // exact same cached array, not merely equal
  });

  it('recomputes when vision radius changes even though position is unchanged', () => {
    const getObstacles = vi.fn(() => [wallA]);
    const game = makeGame(getObstacles);
    const fog = new FogOfWar(game);

    const obj = { position: { x: 10, y: 10 }, visionRadius: 100 };
    fog.getSightPoly(obj);
    expect(getObstacles).toHaveBeenCalledTimes(1);

    obj.visionRadius = 150;
    fog.getSightPoly(obj);
    expect(getObstacles).toHaveBeenCalledTimes(2);
  });

  it('folds the "standing inside a bush" filter into the obstacle signature', () => {
    const game = makeGame(() => [bush]);
    const fog = new FogOfWar(game);
    const buildSegments = vi.spyOn(fog, 'buildSegments');

    // Standing inside the bush: it's filtered out so the player can see
    // through it, which means an empty obstacle list reaches buildSegments.
    const insideObj = { position: { x: 0, y: 0 }, visionRadius: 100 };
    fog.getSightPoly(insideObj);
    expect(buildSegments).toHaveBeenLastCalledWith([]);

    // Standing outside: the bush blocks sight and is part of the segment build.
    const outsideObj = { position: { x: 50, y: 50 }, visionRadius: 100 };
    fog.getSightPoly(outsideObj);
    expect(buildSegments).toHaveBeenLastCalledWith([bush]);
  });
});

/**
 * The fog pass and the spell-made eye.
 *
 * `combat/Vision.ts` has always honoured a statless allied object carrying a
 * plain `visionRadius` (a ward) for *targeting*; the fog pass gated its ally
 * query on `fogRevealRadius > 0`, a getter only AttackableUnit carries, so the
 * same ward lit nothing on screen — planted in a real match it read as an
 * item that does not work at all.
 */
describe('FogOfWar and the spell-made eye', () => {
  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('createGraphics', () => ({ pixelDensity: vi.fn() }));
    vi.stubGlobal('windowWidth', 800);
    vi.stubGlobal('windowHeight', 600);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fogWorld() {
    const game = createGame() as TestGame & { terrainMap: unknown };
    game.terrainMap = { getObstaclesInChampionSight: () => [] };
    const player = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(player);
    // far outside the player's own sight, so only the ward can light it
    const enemy = new Champion({ game, position: createVector(2_000, 0), teamId: 'red' });
    return { game, player, enemy };
  }

  /**
   * One frame's worth of "the world moved".
   *
   * `calculateSight` caches its whole result against `ObjectManager.revision`,
   * which the real quadtree rebuild bumps once a tick — so in a match the pass
   * re-runs every frame. `indexObjects` inserts straight into the tree and
   * bumps nothing, so without this a second call in the same test reads the
   * first one's answer and every assertion after it is about stale state.
   */
  const tick = (game: TestGame): void => {
    (game.objectManager as unknown as { revision: number }).revision++;
  };

  /** A ward the way a pack builds one: position, teamId, a plain visionRadius. */
  function ward(x: number, y: number, teamId: string) {
    const eye = {
      position: { x, y },
      teamId,
      visionRadius: 350,
      toRemove: false,
      getDisplayBoundingBox() {
        return new Rectangle({ x: x - 10, y: y - 10, w: 20, h: 20, data: eye });
      },
    };
    return eye;
  }

  it('an allied ward with a bare visionRadius lights an enemy standing in it', () => {
    const { game, player, enemy } = fogWorld();
    const eye = ward(2_000, 100, player.teamId);
    indexObjects(game, [player, enemy, eye as never]);

    const fog = new FogOfWar(game);
    fog.calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(true);
  });

  it('an enemy ward lights nothing for the player', () => {
    const { game, player, enemy } = fogWorld();
    const eye = ward(2_000, 100, enemy.teamId);
    indexObjects(game, [player, enemy, eye as never]);

    const fog = new FogOfWar(game);
    fog.calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(false);
  });

  /**
   * An enemy who attacked out of the dark.
   *
   * `Vision.test.ts` proves such a unit may be *targeted*; this is the other
   * half, and the two have to agree or the fog stops being a promise. The trap
   * worth naming: the overlay is painted **after** the world, so flagging a
   * unit visible without also burning a hole in the fog leaves it drawn and
   * then covered over — clickable, on the minimap, and invisible on screen.
   */
  describe('a unit that gave itself away', () => {
    it('is lit, with a hole in the fog to be seen through', () => {
      const { game, player, enemy } = fogWorld();
      indexObjects(game, [player, enemy]);
      const fog = new FogOfWar(game);

      fog.calculateSight();
      expect(enemy.visibleToPlayerTeam, 'nothing is lighting it yet').toBe(false);

      enemy.revealForAttack();
      tick(game);
      const lit = fog.calculateSight();

      expect(enemy.visibleToPlayerTeam).toBe(true);
      expect(
        lit.some(entry => entry.object === enemy),
        'flagged visible but no fog erased — it would be drawn and painted over'
      ).toBe(true);
    });

    it('lights whoever is standing with it, which is the point in a brush', () => {
      const { game, player, enemy } = fogWorld();
      // Close enough to ride the attacker's reveal, far enough that nothing
      // else in this world can be lighting it.
      const partner = new Champion({ game, position: createVector(2_100, 0), teamId: 'red' });
      indexObjects(game, [player, enemy, partner]);
      const fog = new FogOfWar(game);

      enemy.revealForAttack();
      fog.calculateSight();

      expect(partner.visibleToPlayerTeam).toBe(true);
    });

    it('goes dark again once the two seconds are up', () => {
      const { game, player, enemy } = fogWorld();
      indexObjects(game, [player, enemy]);
      const fog = new FogOfWar(game);

      enemy.revealForAttack();
      fog.calculateSight();
      expect(enemy.visibleToPlayerTeam).toBe(true);

      (game as unknown as { matchTimeMs: number }).matchTimeMs = DEFAULT_ATTACK_REVEAL_MS + 1;
      tick(game);
      fog.calculateSight();

      expect(enemy.visibleToPlayerTeam).toBe(false);
    });
  });
});
