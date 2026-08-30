import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Turret, { TurretBolt } from '@/game/gameObject/structures/Turret';
import Minion, { MinionBolt } from '@/game/gameObject/attackableUnits/Minion';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import AIChampion from '@/game/gameObject/attackableUnits/AIChampion';
import TeamId from '@/game/enums/TeamId';
import { Lane, getLaneWaypoints } from '@/game/lanes';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * What armour is for.
 *
 * ## The report
 *
 * "Chỉ số item trao đang sai sai" — an item's stats do not seem to do what
 * they say. The engine's damage types turned out to be complete and correct;
 * what was wrong is that almost nothing *used* them.
 *
 * `takeDamage`'s `type` defaults to `MAGIC`, deliberately: abilities are the
 * overwhelming majority of callers and that default moved no number on the day
 * the parameter was added. A basic attack is the one thing that is never
 * magic — and only the champion's said so. A minion's swing, a minion's bolt,
 * a turret's bolt and all three of a camp's attacks passed two arguments and
 * took the default, so **armour protected a player from nothing but other
 * champions**, and magic resist quietly did both jobs.
 *
 * Underneath that, a second one: `Minion`, `Monster`, `AIChampion` and
 * `Turret` each overrode `takeDamage` with a two-parameter signature — legal,
 * since a narrower override is assignable — and forwarded only two arguments.
 * So even a correctly typed hit was re-defaulted the moment it landed on one
 * of those bodies, and a basic attack against a *bot* was mitigated by magic
 * resist while the same swing against a human was mitigated by armour.
 *
 * These cases are about the two ends of that: what a swing declares, and
 * whether the declaration survives the body it lands on.
 */

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Health lost by a victim wearing `armor`/`magicResist`, from one hit. */
const lost = (victim: Champion, hit: () => void): number => {
  const before = victim.stats.health.value;
  hit();
  return before - victim.stats.health.value;
};

const victimWith = (armor: number, magicResist: number): Champion => {
  const victim = new Champion({ game, teamId: TeamId.RED, position: createVector(100, 0) });
  victim.stats.armor.baseValue = armor;
  victim.stats.magicResist.baseValue = magicResist;
  return victim;
};

describe('a basic attack', () => {
  /**
   * 100 armour halves a physical hit (`100 / (100 + r)`), and no amount of
   * magic resist touches it. Asserting the *ratio* rather than a number keeps
   * this about the damage type rather than about the turret's tuning.
   */
  it('from a turret is stopped by armour, not by magic resist', () => {
    const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    const armoured = victimWith(100, 0);
    const warded = victimWith(0, 100);
    indexObjects(game, [turret, armoured, warded]);

    const fire = (victim: Champion): number => {
      turret.fireAt(victim);
      const bolt = game.objectManager._objectToBeAdd.find(o => o instanceof TurretBolt) as TurretBolt;
      game.objectManager._objectToBeAdd.length = 0;
      return lost(victim, () => bolt.onArrive());
    };

    const throughArmour = fire(armoured);
    const throughResist = fire(warded);

    expect(throughArmour, 'armour did nothing against a turret').toBeLessThan(throughResist);
    expect(throughArmour / throughResist).toBeCloseTo(0.5, 2);
  });

  it('from a minion is stopped by armour too', () => {
    const minion = new Minion({
      game,
      teamId: TeamId.BLUE,
      position: createVector(0, 0),
      waypoints: getLaneWaypoints(Lane.MID, TeamId.BLUE),
      lane: Lane.MID,
    });
    const armoured = victimWith(100, 0);
    const warded = victimWith(0, 100);
    indexObjects(game, [minion, armoured, warded]);

    const bolt = (victim: Champion): number => {
      const shot = new MinionBolt(minion);
      shot.target = victim;
      shot.damage = 40;
      return lost(victim, () => shot.onArrive());
    };

    expect(bolt(armoured) / bolt(warded)).toBeCloseTo(0.5, 2);
  });

  /**
   * The override half. A bot is an `AIChampion`, whose `takeDamage` used to
   * take two parameters — so the `'PHYSICAL'` the swing above declares was
   * thrown away on arrival and the bot's *magic resist* answered a sword.
   */
  it('keeps its type when the body it lands on overrides takeDamage', () => {
    const bot = new AIChampion({ game, teamId: TeamId.RED, position: createVector(100, 0) });
    bot.stats.armor.baseValue = 100;
    bot.stats.magicResist.baseValue = 0;
    indexObjects(game, [bot]);

    const before = bot.stats.health.value;
    bot.takeDamage(40, undefined, 'PHYSICAL');
    const physical = before - bot.stats.health.value;

    const beforeMagic = bot.stats.health.value;
    bot.takeDamage(40, undefined, 'MAGIC');
    const magic = beforeMagic - bot.stats.health.value;

    expect(physical, 'the bot’s armour did not apply to a physical hit').toBeCloseTo(20, 5);
    expect(magic, 'the bot’s (absent) magic resist should not reduce a magic hit').toBeCloseTo(40, 5);
  });

  it('names itself in the recap whoever swung it', () => {
    // One label for all five swings, so a death to a turret does not read as
    // a death to nothing. `BASIC_ATTACK_SOURCE`.
    const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
    const victim = victimWith(0, 0);
    indexObjects(game, [turret, victim]);
    turret.fireAt(victim);
    const bolt = game.objectManager._objectToBeAdd.find(o => o instanceof TurretBolt) as TurretBolt;

    const seen: (string | undefined)[] = [];
    const original = victim.takeDamage.bind(victim);
    victim.takeDamage = (damage, attacker, type, source) => {
      seen.push(source);
      original(damage, attacker, type, source);
    };
    bolt.onArrive();

    expect(seen).toEqual(['Đánh thường']);
  });
});
