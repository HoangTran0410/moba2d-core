/**
 * A minion's and a turret's fog obeys the same walls a champion's does.
 *
 * Granted sight — the circle a unit with no combat sight of its own lends the
 * team — used to be painted as a plain disc and tested as a plain distance
 * check. Both reached straight through walls and bushes, so on screen a lane's
 * wave lit the jungle behind the wall it was standing against, while
 * `combat/Vision.ts` had already (correctly) decided the same wave could not
 * see through it. The two halves of one promise disagreed: the enemy standing
 * in that lit-through wall was drawn and was not clickable.
 *
 * Both halves are checked here, because they are separately reachable — the
 * polygon is only cast for revealers near the camera, and the flag is written
 * for the whole map.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FogOfWar from '../../../src/game/gameObject/map/FogOfWar';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion, {
  MINION_FOG_REVEAL_RADIUS,
} from '../../../src/game/gameObject/attackableUnits/Minion';
import TeamId from '../../../src/game/enums/TeamId';
import CollideUtils from '../../../src/utils/collide.utils';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import { createGame, indexObjects, stubGameGlobals, withWalls, type TestGame } from '../fixtures';

/** The whole world is on camera, so the paint half runs for everything. */
const CAMERA = { x: 0, y: 0, w: 1_024, h: 1_024 };

/** A vertical slab between the minion and everything at x > 320. */
const SLAB = [
  { x: 300, y: 380 },
  { x: 320, y: 380 },
  { x: 320, y: 620 },
  { x: 300, y: 620 },
];

const MINION_AT = { x: 200, y: 500 };
/** Behind the slab, and well inside the minion's reveal radius. */
const BEHIND_WALL = { x: 400, y: 500 };
/** The same distance away, on the minion's own side of the slab. */
const OPEN_GROUND = { x: 200, y: 700 };

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  vi.stubGlobal('createGraphics', () => ({ pixelDensity: vi.fn() }));
  vi.stubGlobal('windowWidth', 800);
  vi.stubGlobal('windowHeight', 600);
  game = createGame();
  (game as unknown as { camera: unknown }).camera = { getBoundingBox: () => CAMERA };
});
afterEach(() => vi.unstubAllGlobals());

const alliedMinion = () =>
  new Minion({
    game,
    teamId: TeamId.BLUE,
    position: createVector(MINION_AT.x, MINION_AT.y),
    waypoints: getLaneWaypoints(Lane.MID, TeamId.BLUE),
    lane: Lane.MID,
  });

/** A player parked far away, so nothing it sees for itself can light the test. */
const distantPlayer = () => {
  const player = new Champion({ game, teamId: TeamId.BLUE });
  player.position.set(50, 50);
  game.setPlayer(player);
  return player;
};

describe('what an allied minion lights', () => {
  it('does not light an enemy standing behind a wall', () => {
    const player = distantPlayer();
    const minion = alliedMinion();
    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(BEHIND_WALL.x, BEHIND_WALL.y);
    expect(enemy.position.dist(minion.position)).toBeLessThan(MINION_FOG_REVEAL_RADIUS);

    withWalls(game, [SLAB]);
    indexObjects(game, [player, minion, enemy]);
    new FogOfWar(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(false);
  });

  it('lights the same enemy once the wall is gone', () => {
    const player = distantPlayer();
    const minion = alliedMinion();
    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(BEHIND_WALL.x, BEHIND_WALL.y);

    withWalls(game, []);
    indexObjects(game, [player, minion, enemy]);
    new FogOfWar(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(true);
  });

  it('still lights an enemy at the same range with nothing in the way', () => {
    const player = distantPlayer();
    const minion = alliedMinion();
    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(OPEN_GROUND.x, OPEN_GROUND.y);

    withWalls(game, [SLAB]);
    indexObjects(game, [player, minion, enemy]);
    new FogOfWar(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(true);
  });
});

describe('what an allied minion paints', () => {
  it('casts a wall-aware polygon, not a disc, and stops it at the wall', () => {
    const player = distantPlayer();
    const minion = alliedMinion();

    withWalls(game, [SLAB]);
    indexObjects(game, [player, minion]);
    const painted = new FogOfWar(game).calculateSight();

    const mine = painted.find(entry => entry.object === minion);
    expect(mine).toBeDefined();
    expect(mine!.radius).toBe(MINION_FOG_REVEAL_RADIUS);
    expect(mine!.sightPoly.length).toBeGreaterThan(0);

    const lit = CollideUtils.prepareConcave(mine!.sightPoly);
    // The near side of the slab is lit; the far side is not. A disc — which is
    // what this used to be — would have answered true to both.
    expect(CollideUtils.pointPreparedConcave(250, 500, lit)).toBe(true);
    expect(CollideUtils.pointPreparedConcave(BEHIND_WALL.x, BEHIND_WALL.y, lit)).toBe(false);
  });
});
