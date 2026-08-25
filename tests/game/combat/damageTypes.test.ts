import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Shield from '@/game/gameObject/buffs/Shield';

/**
 * `takeDamage` with a damage type, and the two decisions in it.
 *
 * The numbers are written out by hand rather than computed from
 * `Mitigation`'s own helpers — a check that asks the code under test what it
 * meant agrees with it however wrong it is, and `Mitigation.test.ts` is
 * already the unit test for the curve. What this file is for is the
 * *integration*: that the type reaches the resistance at all, and where in
 * `takeDamage`'s pipeline it lands.
 */
const unit = (game: TestGame, x: number, teamId: string): AttackableUnit => {
  const created = new AttackableUnit({ game, position: createVector(x, 0), teamId });
  created.stats.health.baseValue = 100;
  created.stats.maxHealth.baseValue = 100;
  return created;
};

describe('takeDamage(damage, attacker, type)', () => {
  let game: TestGame;
  let attacker: AttackableUnit;
  let victim: AttackableUnit;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    attacker = unit(game, 0, 'blue');
    victim = unit(game, 100, 'red');
    // `CombatText` reaches for the player to decide whose numbers to draw, so
    // a bare test game with nobody in that slot throws before any assertion
    // here is reached.
    game.setPlayer(attacker);
    indexObjects(game, [attacker, victim]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('changes nothing at all for a unit with no resistances', () => {
    // The property the whole migration rests on: every unit in the game starts
    // at 0 of both, so the day damage types landed, no existing number moved.
    victim.takeDamage(40, attacker);
    expect(victim.stats.health.value).toBe(60);
  });

  it('halves a physical hit against 100 armour', () => {
    victim.stats.armor.baseValue = 100;
    victim.takeDamage(40, attacker, 'PHYSICAL');
    expect(victim.stats.health.value).toBe(80);
  });

  it('ignores armour on a magic hit, and magic resist on a physical one', () => {
    victim.stats.armor.baseValue = 100;
    victim.takeDamage(40, attacker, 'MAGIC');
    expect(victim.stats.health.value).toBe(60);

    victim.stats.health.baseValue = 100;
    victim.stats.armor.baseValue = 0;
    victim.stats.magicResist.baseValue = 100;
    victim.takeDamage(40, attacker, 'PHYSICAL');
    expect(victim.stats.health.value).toBe(60);
  });

  it('lets true damage past both', () => {
    victim.stats.armor.baseValue = 500;
    victim.stats.magicResist.baseValue = 500;
    victim.takeDamage(40, attacker, 'TRUE');
    expect(victim.stats.health.value).toBe(60);
  });

  it('defaults to magic when the caller says nothing', () => {
    // Which is every ability in every published pack, all of which call this
    // with two arguments and will keep doing so.
    victim.stats.magicResist.baseValue = 100;
    victim.takeDamage(40, attacker);
    expect(victim.stats.health.value).toBe(80);
  });

  /**
   * The ordering decision, and the reason it is a test rather than a comment.
   *
   * Armour is a property of the body, so it makes the hit smaller; a shield is
   * a pool standing in front of the body, so it eats a hit whose size is
   * already settled. Mitigate first, then run the buff chain.
   *
   * Get it the other way round and a 30-point shield in front of 100 armour
   * absorbs 30 of the *raw* 40 and lets 10 through — halved to 5. Correct
   * order: 40 is halved to 20, the shield eats all 20, nothing lands, and 10
   * of the shield is still standing.
   */
  it('mitigates before the shields, not after', () => {
    victim.stats.armor.baseValue = 100;
    const guard = new Shield(10_000, victim, victim);
    guard.amount = 30;
    guard.stackId = 'test_shield';
    victim.addBuff(guard);

    victim.takeDamage(40, attacker, 'PHYSICAL');

    expect(victim.stats.health.value, 'the shield did not cover the mitigated hit').toBe(100);
    expect(guard.amount, 'the shield ate the raw hit instead of the mitigated one').toBe(10);
  });

  it('still rounds to whole points', () => {
    // 33 armour is not a clean fraction: 40 * 100/133 = 30.07…
    victim.stats.armor.baseValue = 33;
    victim.takeDamage(40, attacker, 'PHYSICAL');
    expect(Number.isInteger(victim.stats.health.value)).toBe(true);
    expect(victim.stats.health.value).toBe(70);
  });

  it('never turns a hit into a heal, however much armour is shredded', () => {
    victim.stats.armor.baseValue = -100_000;
    victim.stats.health.baseValue = 100;
    victim.takeDamage(10, attacker, 'PHYSICAL');
    // Amplified, but bounded: the curve's ceiling is 2x, so a 10 can never
    // land as more than 20 and can certainly never be negative.
    expect(victim.stats.health.value).toBeLessThan(100);
    expect(victim.stats.health.value).toBeGreaterThanOrEqual(80);
  });
});
