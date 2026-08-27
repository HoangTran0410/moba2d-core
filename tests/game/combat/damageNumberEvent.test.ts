import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import AttackableUnit, {
  type DamageNumberEvent,
} from '@/game/gameObject/attackableUnits/AttackableUnit';
import Shield from '@/game/gameObject/buffs/Shield';
import EventType from '@/game/enums/EventType';

/**
 * `EventType.ON_TAKE_DAMAGE` — the damage-number announcement a LAN host
 * forwards to its clients (`HostSession`), whose own `takeDamage` is gated
 * and can float nothing on its own. The contract under test: it fires with
 * the *shown* number (post-mitigation, rounded — the same figure
 * `CombatText.show` gets in the same breath), and it does not fire for a hit
 * that never reached health, because no number was floated for that either.
 */
describe('the ON_TAKE_DAMAGE damage-number event', () => {
  let game: TestGame;
  let attacker: AttackableUnit;
  let victim: AttackableUnit;
  let heard: DamageNumberEvent[];

  const unit = (x: number, teamId: string): AttackableUnit => {
    const created = new AttackableUnit({ game, position: createVector(x, 0), teamId });
    created.stats.health.baseValue = 100;
    created.stats.maxHealth.baseValue = 100;
    return created;
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    attacker = unit(0, 'blue');
    victim = unit(100, 'red');
    game.setPlayer(attacker);
    indexObjects(game, [attacker, victim]);
    heard = [];
    game.eventManager.on(EventType.ON_TAKE_DAMAGE, (hit: DamageNumberEvent) => heard.push(hit));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('announces the post-mitigation number, typed, once per hit', () => {
    victim.stats.armor.baseValue = 100; // halves a physical hit
    victim.takeDamage(40, attacker, 'PHYSICAL');

    expect(heard).toHaveLength(1);
    // 20, by hand: 40 through 100 armour — the shown number, not the swung.
    expect(heard[0].amount).toBe(20);
    expect(heard[0].type).toBe('PHYSICAL');
    expect(heard[0].unit).toBe(victim);
  });

  it('stays silent for a hit a shield swallowed whole — nothing was floated', () => {
    const guard = new Shield(10_000, victim, victim);
    guard.amount = 200;
    guard.stackId = 'test_shield';
    victim.addBuff(guard);

    victim.takeDamage(40, attacker, 'PHYSICAL');

    expect(victim.stats.health.value).toBe(100);
    expect(heard).toHaveLength(0);
  });
});
