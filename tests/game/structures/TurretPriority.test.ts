import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Turret, {
  DEFAULT_TURRET_PRESET,
  TURRET_DEFEND_RANGE_RATIO,
  type TurretPassive,
} from '../../../src/game/gameObject/structures/Turret';
import Minion, { MinionPresets } from '../../../src/game/gameObject/attackableUnits/Minion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import StatAmp from '../../../src/game/gameObject/buffs/StatAmp';
import TeamId from '../../../src/game/enums/TeamId';
import { Lane, getLaneWaypoints } from '../../../src/game/lanes';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * **What a turret shoots first, how far it will answer for an ally, and what a
 * pack is allowed to bolt onto it.**
 *
 * Core had flattened the source game's ladder to "any minion, then a champion",
 * so a siege minion shelling the tower was answered no sooner than the caster
 * standing behind it. Wiki, *Turret* § Target Selection, gives the real order:
 * pets, then siege and super minions, then melee, then casters, then champions.
 *
 * The two other rules here are the ones that used to have no seam at all: the
 * turret's outgoing damage was a plain field nothing could amplify, and there
 * was nowhere for a pack to state what its towers are built carrying.
 */

let game: TestGame;

const turretAt = (teamId: string, x = 0, y = 0, passives?: readonly TurretPassive[]) =>
  new Turret({
    game,
    position: createVector(x, y),
    teamId,
    preset: passives ? { ...DEFAULT_TURRET_PRESET, passives } : undefined,
  });

const minionAt = (teamId: string, x: number, kind: 'melee' | 'ranged' | 'cannon') =>
  new Minion({
    game,
    teamId,
    position: createVector(x, 0),
    waypoints: getLaneWaypoints(Lane.MID, teamId),
    lane: Lane.MID,
    preset: MinionPresets[kind],
  });

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('which body a turret answers first', () => {
  /**
   * All three kinds at once, the caster nearest. Distance is what the old
   * ladder went on, so putting the siege minion furthest away is what makes
   * this case about priority rather than about geometry.
   */
  it('takes the siege minion over the melee and the caster, however they stand', () => {
    const turret = turretAt(TeamId.BLUE);
    const caster = minionAt(TeamId.RED, 120, 'ranged');
    const melee = minionAt(TeamId.RED, 200, 'melee');
    const siege = minionAt(TeamId.RED, 380, 'cannon');
    indexObjects(game, [turret, caster, melee, siege]);

    expect(turret.findTarget()?.unit).toBe(siege);
  });

  it('takes the melee over the caster once the siege is gone', () => {
    const turret = turretAt(TeamId.BLUE);
    const caster = minionAt(TeamId.RED, 120, 'ranged');
    const melee = minionAt(TeamId.RED, 300, 'melee');
    indexObjects(game, [turret, caster, melee]);

    expect(turret.findTarget()?.unit).toBe(melee);
  });

  it('still puts every minion ahead of a champion standing closer', () => {
    const turret = turretAt(TeamId.BLUE);
    const caster = minionAt(TeamId.RED, 350, 'ranged');
    const diver = new Champion({ game, teamId: 'solo', position: createVector(60, 0) });
    indexObjects(game, [turret, caster, diver]);

    expect(turret.findTarget()?.unit).toBe(caster);
  });
});

describe('how far a turret will answer for an ally', () => {
  /**
   * The source game defends an ally within 1400 of a turret that shoots 775 —
   * an ally can be attacked well outside what the tower can hit and the tower
   * still turns. Core defended exactly its own attack range, so standing by
   * your tower bought nothing one step past it.
   */
  it('turns on a champion attacking an ally outside its own reach', () => {
    const turret = turretAt(TeamId.BLUE);
    const range = DEFAULT_TURRET_PRESET.attackRange;

    // The ally is beyond what the turret can shoot, and inside what it defends.
    const ally = new Champion({
      game,
      teamId: TeamId.BLUE,
      position: createVector(range * 1.4, 0),
    });
    // The attacker is inside the turret's own reach, which is what makes this
    // a target it could take rather than one it merely resents.
    const attacker = new Champion({
      game,
      teamId: 'solo',
      position: createVector(range * 0.8, 0),
    });
    const bystander = minionAt('solo', 100, 'melee');
    indexObjects(game, [turret, ally, attacker, bystander]);

    ally.takeDamage(5, attacker, 'PHYSICAL');

    expect(turret.findTarget()?.unit).toBe(attacker);
  });

  it('defends further than it shoots, and says so as a ratio', () => {
    // Written as a ratio rather than a copied 1400: this canvas is pixels and
    // that number is the source game's grid.
    expect(TURRET_DEFEND_RANGE_RATIO).toBeGreaterThan(1);
  });
});

describe('a turret’s own numbers', () => {
  /**
   * The whole reason a "warming up" ramp can live in a pack rather than in
   * `Turret`: the damage a shot lands for is read live off the stat.
   */
  it('reads its damage off the stat, so a buff can amplify it', () => {
    const turret = turretAt(TeamId.BLUE);
    const base = turret.damage;
    expect(base).toBe(DEFAULT_TURRET_PRESET.damage);

    const ramp = new StatAmp(0, turret, turret);
    ramp.bonuses = { attackDamage: { percentBonus: 1 } };
    turret.addBuff(ramp);
    turret.update();

    expect(turret.damage).toBeCloseTo(base * 2, 4);
  });

  it('is built carrying whatever passives its preset names', () => {
    const seen: string[] = [];
    const passives: TurretPassive[] = [
      {
        name: 'probe',
        onSpawn(turret) {
          // The body is finished by the time a passive sees it — a passive that
          // reads `stats.attackDamage` or hangs a buff needs that to be true.
          seen.push(`${turret.teamId}:${turret.damage}`);
        },
      },
    ];

    turretAt(TeamId.BLUE, 0, 0, passives);

    expect(seen).toEqual([`${TeamId.BLUE}:${DEFAULT_TURRET_PRESET.damage}`]);
  });

  it('is a plain tower when its preset names none', () => {
    expect(() => turretAt(TeamId.BLUE)).not.toThrow();
    expect(turretAt(TeamId.BLUE).buffs.length).toBe(0);
  });
});
