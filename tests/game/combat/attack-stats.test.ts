import type { DamageType } from '../../../src/game/combat/Mitigation';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { landBasicAttack } from '../../../src/game/combat/BasicAttack';
import EventType from '../../../src/game/enums/EventType';
import type { BasicAttackHit } from '../../../src/game/combat/BasicAttack';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const pair = () => {
  const game = createGame();
  const attacker = createUnit(game, 0, 'blue');
  const victim = createUnit(game, 50, 'red');
  for (const unit of [attacker, victim]) {
    unit.stats.maxHealth.baseValue = 200;
    unit.stats.health.baseValue = 200;
  }
  return { game, attacker, victim };
};

/**
 * Four stats exist so a swing is a build rather than the thing you do between
 * cooldowns. Each is read in exactly one place, and this suite is that place's
 * contract — including the part that matters most: a unit nobody has buffed
 * swings for exactly what it always did.
 */
describe('basic attack stats', () => {
  it('changes nothing for a unit that was granted none of them', () => {
    const { attacker, victim } = pair();

    expect(landBasicAttack(attacker, victim, 20, false)).toBe(true);

    expect(victim.stats.health.value).toBe(180);
    expect(attacker.stats.health.value).toBe(200); // no vamp, no heal
  });

  it('adds on-hit damage to the swing', () => {
    const { attacker, victim } = pair();
    attacker.stats.onHitDamage.baseValue = 7;

    landBasicAttack(attacker, victim, 20, false);

    expect(victim.stats.health.value).toBe(200 - 27);
  });

  it('multiplies the whole swing on a crit, on-hit included', () => {
    const { attacker, victim } = pair();
    attacker.stats.onHitDamage.baseValue = 10;
    attacker.stats.critChance.baseValue = 1; // always
    attacker.stats.critDamage.baseValue = 2;

    landBasicAttack(attacker, victim, 20, false);

    expect(victim.stats.health.value).toBe(200 - 60);
  });

  it('reports the damage it actually dealt, and whether it crit', () => {
    const { game, attacker, victim } = pair();
    const hits: BasicAttackHit[] = [];
    game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) => hits.push(hit));

    attacker.stats.onHitDamage.baseValue = 5;
    landBasicAttack(attacker, victim, 20, true);

    expect(hits).toHaveLength(1);
    expect(hits[0].damage).toBe(25); // not the 20 that was requested
    expect(hits[0].crit).toBe(false);
    expect(hits[0].ranged).toBe(true);
  });
});

/**
 * Three sustain stats split by the *type* of the hit rather than by what dealt
 * it — `combat/Vamp.ts` has the argument. The split is worth driving here
 * rather than only against `vampFraction`, because the whole claim is that
 * `takeDamage` is the one funnel: a stat that reads correctly in isolation and
 * is never consulted by the damage path is a stat that does nothing.
 */
/**
 * A shield's pool is a number of points, and points alone cannot say what the
 * shield is *for*. An anti-magic shield and a general one both read "hấp thụ
 * 35 sát thương", which is the question that started this: a player looking at
 * one had no way to know whether it would be there when the physical damage
 * arrived.
 */
describe('a shield that stands in front of only some damage', () => {
  const shielded = (absorbs: DamageType[] | null) => {
    const { attacker, victim } = pair();
    const shield = new Shield(10_000, victim, victim);
    shield.amount = 30;
    shield.absorbs = absorbs;
    victim.addBuff(shield);
    return { attacker, victim, shield };
  };

  it('eats the type it names', () => {
    const { attacker, victim, shield } = shielded(['MAGIC']);
    const before = victim.stats.health.value;

    victim.takeDamage(20, attacker, 'MAGIC');

    expect(victim.stats.health.value, 'a magic hit reached health').toBe(before);
    expect(shield.amount).toBe(10);
  });

  it('lets every other type past without spending the pool', () => {
    const { attacker, victim, shield } = shielded(['MAGIC']);
    const before = victim.stats.health.value;

    victim.takeDamage(20, attacker, 'PHYSICAL');

    expect(victim.stats.health.value).toBe(before - 20);
    // Not partially spent, not spent at all: a filtered shield that quietly
    // chipped on the wrong type would be a third behaviour nobody asked for.
    expect(shield.amount, 'the pool paid for damage it does not cover').toBe(30);
  });

  it('still eats everything when it names nothing, which is every shield that came before', () => {
    const { attacker, victim, shield } = shielded(null);

    victim.takeDamage(20, attacker, 'TRUE');

    expect(shield.amount).toBe(10);
  });

  it('says which damage it answers for, so the number is not the whole tooltip', () => {
    const { shield } = shielded(['MAGIC']);
    expect(shield.description).toContain('sát thương phép');
    expect(shield.description).toContain('damage magic');

    // And an unfiltered one answers the same question rather than staying
    // silent about it: "hấp thụ 35 sát thương" reads as a tooltip that forgot,
    // not as a promise to eat everything.
    const { shield: general } = shielded(null);
    expect(general.description).toContain('mọi loại sát thương');
    expect(general.description, 'an unfiltered shield claimed a type').not.toContain('phép');
  });
});

describe('lifesteal and spell vamp', () => {
  it('pays lifesteal out of physical damage and not out of magic', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.lifesteal.baseValue = 0.5;

    victim.takeDamage(40, attacker, 'PHYSICAL');
    expect(attacker.stats.health.value).toBe(120);

    victim.takeDamage(40, attacker, 'MAGIC');
    expect(attacker.stats.health.value, 'lifesteal paid out of a magic hit').toBe(120);
  });

  it('pays spell vamp out of magic damage and not out of physical', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.spellVamp.baseValue = 0.5;

    victim.takeDamage(40, attacker, 'MAGIC');
    expect(attacker.stats.health.value).toBe(120);

    victim.takeDamage(40, attacker, 'PHYSICAL');
    expect(attacker.stats.health.value, 'spell vamp paid out of a physical hit').toBe(120);
  });

  /**
   * True damage sits with the physical half rather than with neither. It is
   * what an execute-flavoured, armour-shredding build deals, and a build that
   * reaches it bought `lifesteal` on the way; paying nobody would make the
   * most committed damage type the least sustainable one in the game.
   */
  it('pays lifesteal out of true damage too', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.lifesteal.baseValue = 0.5;

    victim.takeDamage(40, attacker, 'TRUE');

    expect(attacker.stats.health.value).toBe(120);
  });

  it('adds the general stat to the typed one rather than taking the larger', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.omnivamp.baseValue = 0.25;
    attacker.stats.spellVamp.baseValue = 0.25;

    victim.takeDamage(40, attacker, 'MAGIC');

    // 50% of 40, not the 25% either stat would pay alone.
    expect(attacker.stats.health.value).toBe(120);
  });

  it('still refuses to profit when two stats add past the whole hit', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.omnivamp.baseValue = 0.8;
    attacker.stats.lifesteal.baseValue = 0.8;

    victim.takeDamage(40, attacker, 'PHYSICAL');

    // The sum is 1.6; the clamp is the same one `Stats.omnivamp` carries alone.
    expect(attacker.stats.health.value).toBe(140);
  });
});

describe('omnivamp', () => {
  it('heals the attacker off any damage, not just a swing', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.omnivamp.baseValue = 0.5;

    // A spell, a poison tick, anything: `takeDamage` is the only funnel.
    victim.takeDamage(40, attacker);

    expect(victim.stats.health.value).toBe(160);
    expect(attacker.stats.health.value).toBe(120);
  });

  it('pays on the damage that survived the shield, not the damage requested', () => {
    const { attacker, victim } = pair();
    attacker.stats.health.baseValue = 100;
    attacker.stats.omnivamp.baseValue = 1;
    // The real thing rather than a stub of it: a hand-rolled object with only
    // `modifyIncomingDamage` on it stops being a `Buff` the moment the base
    // class grows a hook, which is exactly what happened when reflection moved
    // onto `onDamageTaken`.
    const shield = new Shield(10_000, victim, victim);
    shield.amount = 30;
    victim.addBuff(shield);

    victim.takeDamage(50, attacker);

    expect(attacker.stats.health.value).toBe(120); // 20, not 50
  });

  it('never refunds a self-inflicted cost', () => {
    const { attacker } = pair();
    attacker.stats.omnivamp.baseValue = 1;

    attacker.takeDamage(30, attacker); // Olaf E pays health for its damage

    expect(attacker.stats.health.value).toBe(170);
  });

  it('cannot exceed the pool it heals into', () => {
    const { attacker, victim } = pair();
    attacker.stats.omnivamp.baseValue = 1;

    victim.takeDamage(80, attacker);

    expect(attacker.stats.health.value).toBe(200);
  });
});
