import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import type { DamageType } from '../../../src/game/combat/Mitigation';
import Buff from '../../../src/game/gameObject/Buff';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
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

interface Dealt {
  swung: number;
  landed: number;
  victim: AttackableUnit;
  type: DamageType;
}

/** Records every hit its owner dealt, exactly as the funnel reported it. */
class RecordingDealer extends Buff {
  dealt: Dealt[] = [];
  onDamageDealt(swung: number, landed: number, victim: AttackableUnit, type: DamageType): void {
    this.dealt.push({ swung, landed, victim, type });
  }
}

/**
 * The attacker-side mirror of `Buff.onDamageTaken`. It exists because
 * `Buff.onHit` is basic attacks only (`combat/BasicAttack.ts` is its sole
 * emitter), so an item that answers "I damaged somebody" — a grievous-wounds
 * passive on a mage's item is the first one — had nothing to hang on at all.
 */
describe('the damage-dealt reaction', () => {
  it('hands the attacker’s buffs the hit, its type and who took it', () => {
    const { attacker, victim } = pair();
    const recorder = new RecordingDealer(0, attacker, attacker);
    attacker.addBuff(recorder);

    victim.takeDamage(30, attacker, 'MAGIC');

    expect(recorder.dealt).toHaveLength(1);
    expect(recorder.dealt[0]).toMatchObject({ swung: 30, landed: 30, type: 'MAGIC' });
    expect(recorder.dealt[0].victim).toBe(victim);
  });

  /** The victim's own buffs answer through `onDamageTaken`, not through this. */
  it('does not fire on the victim’s buffs', () => {
    const { attacker, victim } = pair();
    const onVictim = new RecordingDealer(0, victim, victim);
    victim.addBuff(onVictim);

    victim.takeDamage(30, attacker, 'PHYSICAL');

    expect(onVictim.dealt).toHaveLength(0);
  });

  /** A cost a spell charges its own caster is not an attack on somebody. */
  it('does not fire on self-damage', () => {
    const { attacker } = pair();
    const recorder = new RecordingDealer(0, attacker, attacker);
    attacker.addBuff(recorder);

    attacker.takeDamage(20, attacker, 'TRUE');

    expect(recorder.dealt).toHaveLength(0);
  });

  /**
   * A shield eating the whole hit does not make it not a hit — the same
   * sentence `reactToDamage`'s absorbed path already answers to, and the
   * reason `swung` is reported beside `landed` rather than instead of it.
   */
  it('still fires when a shield ate every point, with nothing landed', () => {
    const { attacker, victim } = pair();
    const recorder = new RecordingDealer(0, attacker, attacker);
    attacker.addBuff(recorder);

    const shield = new Shield(3_000, victim, victim);
    shield.amount = 100;
    victim.addBuff(shield);

    victim.takeDamage(40, attacker, 'PHYSICAL');

    expect(victim.stats.health.value).toBe(200);
    expect(recorder.dealt).toHaveLength(1);
    expect(recorder.dealt[0]).toMatchObject({ swung: 40, landed: 0 });
  });

  /**
   * `landed` is what the pool actually took, capped by what was left in it —
   * the same number the scoreboard is credited with, so an item paying out of
   * a fraction of the damage it dealt cannot overpay on an execute.
   */
  it('reports what the pool could take, not what was swung at a corpse', () => {
    const { attacker, victim } = pair();
    victim.stats.health.baseValue = 12;
    const recorder = new RecordingDealer(0, attacker, attacker);
    attacker.addBuff(recorder);

    victim.takeDamage(200, attacker, 'PHYSICAL');

    expect(recorder.dealt[0]).toMatchObject({ swung: 200, landed: 12 });
  });
});
