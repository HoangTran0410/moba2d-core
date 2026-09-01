import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Minion, {
  CANNON_FLASH_MS,
  MELEE_WINDUP_MS,
  MinionBolt,
  MinionPresets,
  RANGED_WINDUP_FRACTION,
  RANGED_WINDUP_MAX_MS,
} from '../../../src/game/gameObject/attackableUnits/Minion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { Lane } from '../../../src/game/lanes';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * **A minion has a wind-up, and the three styles stop looking the same.**
 *
 * The damage always resolved late — `MinionSwing` waits out its own beat and a
 * bolt has to fly — but the *body* never knew: a minion snapped from standing
 * to having attacked, with the spawned object as the only sign anything had
 * happened. A champion has had `windupMs` on its controller since the reveal
 * rule was written; a minion had nothing.
 *
 * What these cases hold is the part art cannot be trusted to hold on its own:
 * the wind-up is a real countdown on the unit, it is the *same* clock the
 * object it spawns resolves on, and a caster's shot and a cart's shell are no
 * longer the same object in two colours.
 */

const LANE = [
  { x: 300, y: 300 },
  { x: 900, y: 900 },
];

const spawn = (game: TestGame, preset = MinionPresets.melee, x = 0, y = 0) =>
  new Minion({
    game,
    position: createVector(x, y),
    teamId: TeamId.BLUE,
    lane: Lane.MID,
    waypoints: LANE.map(point => ({ ...point })),
    preset,
  });

const enemy = (game: TestGame, x: number) =>
  new Champion({ game, position: createVector(x, 0), teamId: 'red' });

/** Everything the world holds, settled or queued — `addObject` parks first. */
const spawned = (game: TestGame): unknown[] => {
  const manager = game.objectManager as unknown as {
    objects: unknown[];
    _objectToBeAdd: unknown[];
  };
  return [...manager.objects, ...manager._objectToBeAdd];
};

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  vi.stubGlobal('deltaTime', 16);
  game = createGame();
});
afterEach(() => vi.unstubAllGlobals());

describe('the beat between committing to a swing and landing it', () => {
  it('starts a countdown on the minion itself', () => {
    const minion = spawn(game);
    const target = enemy(game, 60);

    expect(minion._windupMs).toBe(0);
    minion.launchAttack(target, 80);
    expect(minion._windupMs).toBeGreaterThan(0);
  });

  it('runs down, and reaches zero', () => {
    const minion = spawn(game);
    minion.launchAttack(enemy(game, 60), 80);

    const started = minion._windupMs;
    minion.update();
    expect(minion._windupMs).toBeLessThan(started);

    for (let frame = 0; frame < 60; frame++) minion.update();
    expect(minion._windupMs).toBeLessThanOrEqual(0);
  });

  /**
   * The load-bearing one. `MinionSwing` resolves its damage at
   * `MELEE_WINDUP_MS`; a body that leaned into its swing on any other clock
   * would be art that lies about when the blade arrives.
   */
  it('is the same clock the melee swing resolves on', () => {
    expect(spawn(game, MinionPresets.melee).windupFor()).toBe(MELEE_WINDUP_MS);
  });

  it('is a share of a ranged minion’s own beat, under the ceiling', () => {
    const caster = spawn(game, MinionPresets.ranged);
    expect(caster.windupFor()).toBeLessThanOrEqual(RANGED_WINDUP_MAX_MS);
    expect(caster.windupFor()).toBeCloseTo(
      Math.min(RANGED_WINDUP_MAX_MS, caster.attackInterval * RANGED_WINDUP_FRACTION),
      6
    );
  });

  it('reads 0 at the start and 1 at the end, for the art to lean on', () => {
    const minion = spawn(game);
    minion.launchAttack(enemy(game, 60), 80);
    expect(minion.windupCharge()).toBeLessThan(0.2);

    // Stopped one frame short of the end on purpose: `windupCharge` is 0 once
    // the wind-up has cleared (there is nothing left to lean into), so a loop
    // that runs it to zero measures the rest pose rather than the swing.
    while (minion._windupMs > 20) minion.update();
    expect(minion.windupCharge()).toBeGreaterThan(0.8);
  });
});

describe('a ranged minion’s shot', () => {
  it('is nocked for exactly the wind-up, rather than leaving at once', () => {
    const minion = spawn(game, MinionPresets.ranged);
    minion.launchAttack(enemy(game, 300), 400);

    const bolt = spawned(game).find(object => object instanceof MinionBolt) as MinionBolt;
    expect(bolt, 'no bolt was spawned at all').toBeTruthy();
    expect(bolt.armMs).toBe(minion.windupFor());
  });

  /**
   * A caster's bolt and a cart's shell were one object in two colours, which is
   * backwards for the one body in a wave a player most needs to pick out.
   */
  it('knows which body fired it, so a shell is not an orb', () => {
    const caster = spawn(game, MinionPresets.ranged);
    caster.launchAttack(enemy(game, 300), 400);
    const orb = spawned(game).find(object => object instanceof MinionBolt) as MinionBolt;
    expect(orb.style).toBe('ranged');

    const cart = spawn(game, MinionPresets.cannon, 50, 50);
    cart.launchAttack(enemy(game, 400), 500);
    const shells = spawned(game).filter(object => object instanceof MinionBolt) as MinionBolt[];
    expect(shells.at(-1)!.style).toBe('cannon');
  });

  /** The cart answers its own shot; the other two styles have no flash to arm. */
  it('gives the cart a muzzle flash the caster does not get', () => {
    const cart = spawn(game, MinionPresets.cannon);
    cart.launchAttack(enemy(game, 400), 500);
    expect(cart._recoverMs).toBeCloseTo(cart.windupFor() + CANNON_FLASH_MS, 6);

    const caster = spawn(game, MinionPresets.ranged, 50, 50);
    caster.launchAttack(enemy(game, 300), 400);
    expect(caster._recoverMs).toBe(0);
  });
});
