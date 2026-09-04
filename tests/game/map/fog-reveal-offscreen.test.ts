/**
 * What the team can see is not the same question as what is worth painting.
 *
 * `calculateSight` narrowed its revealers to those whose circle meets the camera
 * box. For the fog overlay that is right and valuable — there is no point
 * erasing fog off screen. But the same pass is the only writer of
 * `visibleToPlayerTeam`, and `Game.minimapBlips` reads that flag to decide
 * whether a unit gets a dot. The minimap draws the *whole map*.
 *
 * So allied minions, wards and champions vanished from the minimap the moment
 * the player walked away from them, along with everything they were lighting —
 * the team had the vision, and the map would not show it.
 *
 * Turrets and fountains were the exception that hid it: they are structures, so
 * `minimapBlips` draws them without consulting the flag at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FogOfWar from '../../../src/game/gameObject/map/FogOfWar';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/** The camera, parked at the top-left corner and nowhere near the action. */
const CAMERA = { x: 0, y: 0, w: 800, h: 600 };
/** Far outside it, by more than any reveal radius on the roster. */
const AWAY = { x: 3_000, y: 3_000 };

let game: TestGame;

const fogOver = (world: TestGame): FogOfWar => {
  const fog = Object.create(FogOfWar.prototype) as FogOfWar;
  (fog as unknown as { game: unknown }).game = world;
  // The raycast is a different concern and needs a real terrain map. This suite
  // is about which revealers the pass considers, so the polygon half is stubbed
  // out to reveal nothing — every reveal an assertion below sees came from a
  // circle revealer.
  (fog as unknown as { calculateSightForObject: () => unknown }).calculateSightForObject = () => ({
    sightPoly: [],
    playersInSight: [],
  });
  return fog;
};

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  (game as unknown as { camera: unknown }).camera = { getBoundingBox: () => CAMERA };
});
afterEach(() => vi.unstubAllGlobals());

describe('an allied revealer off camera still lights the map', () => {
  it('marks the enemy standing in an allied minion’s circle', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const ally = new Minion({
      game,
      teamId: TeamId.BLUE,
      position: createVector(AWAY.x, AWAY.y),
      waypoints: getLaneWaypoints(Lane.MID, TeamId.BLUE),
      lane: Lane.MID,
    });
    expect(ally.fogRevealRadius).toBeGreaterThan(0);

    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(AWAY.x + 10, AWAY.y);

    indexObjects(game, [player, ally, enemy]);
    fogOver(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(true);
  });

  it('marks the allied minion itself, so its own dot survives', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const ally = new Minion({
      game,
      teamId: TeamId.BLUE,
      position: createVector(AWAY.x, AWAY.y),
      waypoints: getLaneWaypoints(Lane.MID, TeamId.BLUE),
      lane: Lane.MID,
    });

    indexObjects(game, [player, ally]);
    fogOver(game).calculateSight();

    expect(ally.visibleToPlayerTeam).toBe(true);
  });

  it('still hides an enemy nobody on the team is lighting', () => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(AWAY.x, AWAY.y);

    indexObjects(game, [player, enemy]);
    fogOver(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(false);
  });
});

/**
 * The practice panel's `revealMap`, which the sight pass had never heard of.
 *
 * `Game.minimapBlips` and `minimapHost.visionCircles` both honoured it, so the
 * cheat lifted the veil off the *minimap* and left the screen it is a map of
 * fogged — and the units in that fog undrawn, because `ObjectManager.draw`
 * reads the same flag these cases do.
 */
describe('hiện bản đồ', () => {
  const withReveal = (world: TestGame, on: boolean): TestGame => {
    (world as unknown as { director: unknown }).director = { revealMap: on };
    return world;
  };

  const enemyInTheDark = (): Champion => {
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(AWAY.x, AWAY.y);

    indexObjects(game, [player, enemy]);
    return enemy;
  };

  it('marks an enemy nobody is lighting', () => {
    const enemy = enemyInTheDark();
    fogOver(withReveal(game, true)).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(true);
  });

  it('hides it again the moment the switch goes off', () => {
    const enemy = enemyInTheDark();
    const fog = fogOver(withReveal(game, true));
    fog.calculateSight();
    expect(enemy.visibleToPlayerTeam).toBe(true);

    withReveal(game, false);
    // A fresh pass, not the cached one — the cheat is read per pass, and
    // `FOG_SIGHT_TICK_INTERVAL` is what decides when the next one runs.
    fogOver(game).calculateSight();

    expect(enemy.visibleToPlayerTeam).toBe(false);
  });

  it('does not lend the enemy a circle of its own', () => {
    // `revealedEnemies` is what makes an attacker light a radius *for the other
    // team*. A cheat about what this player sees must not reach it, or the
    // fog would start revealing allies to nobody's benefit.
    const player = new Champion({ game, teamId: TeamId.BLUE });
    player.position.set(100, 100);
    game.setPlayer(player);

    const enemy = new Champion({ game, teamId: TeamId.RED });
    enemy.position.set(AWAY.x, AWAY.y);
    const bystander = new Champion({ game, teamId: TeamId.RED });
    bystander.position.set(AWAY.x + 10_000, AWAY.y);

    indexObjects(game, [player, enemy, bystander]);
    const lit = fogOver(withReveal(game, true));
    lit.calculateSight();
    const dark = fogOver(withReveal(game, false));
    dark.calculateSight();

    // Both enemies are visible because the cheat says so, and the circle list
    // — which is what lends vision — is exactly the one it would have been.
    expect(enemy.visibleToPlayerTeam).toBe(false); // the pass without the cheat ran last
    expect(lit.visionCircles()).toEqual(dark.visionCircles());
  });
});
