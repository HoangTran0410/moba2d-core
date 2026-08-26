import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { landBasicAttack } from '../../../src/game/combat/BasicAttack';
import { applyOnHitEffects, MAX_ONHIT_DEPTH } from '../../../src/game/combat/OnHit';
import type { OnHitEvent } from '../../../src/game/combat/OnHit';
import Buff from '../../../src/game/gameObject/Buff';
import Spell from '../../../src/game/gameObject/Spell';
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

/** A payload effect: records every application it was handed. */
class RecordingOnHit extends Buff {
  hits: OnHitEvent[] = [];
  onHit(hit: OnHitEvent): void {
    this.hits.push(hit);
  }
}

/** A well-behaved propagator: echoes each real swing once, never an echo. */
class EchoOnce extends Buff {
  onHit(hit: OnHitEvent): void {
    if (hit.echo) return;
    applyOnHitEffects({ ...hit, echo: true });
  }
}

/** The pack-author bug the depth latch exists for: echoes even echoes. */
class RunawayEcho extends Buff {
  applications = 0;
  onHit(hit: OnHitEvent): void {
    this.applications++;
    applyOnHitEffects({ ...hit, echo: true });
  }
}

describe('the on-hit pipeline', () => {
  it('hands every buff on the attacker the swing that actually landed', () => {
    const { attacker, victim } = pair();
    attacker.stats.onHitDamage.baseValue = 5;
    const recorder = new RecordingOnHit(0, attacker, attacker);
    attacker.addBuff(recorder);

    expect(landBasicAttack(attacker, victim, 20, true)).toBe(true);

    expect(recorder.hits).toHaveLength(1);
    const hit = recorder.hits[0];
    expect(hit.attacker).toBe(attacker);
    expect(hit.victim).toBe(victim);
    expect(hit.damage).toBe(25); // the landed swing, on-hit stat included
    expect(hit.ranged).toBe(true);
    expect(hit.echo).toBe(false);
  });

  it('runs nothing when the attack itself is refused', () => {
    const { attacker, victim } = pair();
    const recorder = new RecordingOnHit(0, attacker, attacker);
    attacker.addBuff(recorder);
    victim.takeDamage(10_000, attacker, 'TRUE');
    expect(victim.isDead).toBe(true);

    expect(landBasicAttack(attacker, victim, 20, false)).toBe(false);
    expect(recorder.hits).toHaveLength(0);
  });

  it("an effect's own damage carries its own type instead of riding the swing", () => {
    const { attacker, victim } = pair();
    class MagicSting extends Buff {
      onHit(hit: OnHitEvent): void {
        hit.victim.takeDamage(7, hit.attacker, 'TRUE');
      }
    }
    attacker.addBuff(new MagicSting(0, attacker, attacker));

    landBasicAttack(attacker, victim, 20, false);

    expect(victim.stats.health.value).toBe(200 - 20 - 7);
  });

  it('a propagator doubles the payloads without doubling itself', () => {
    const { attacker, victim } = pair();
    const recorder = new RecordingOnHit(0, attacker, attacker);
    attacker.addBuff(recorder);
    attacker.addBuff(new EchoOnce(0, attacker, attacker));

    landBasicAttack(attacker, victim, 20, false);

    // the payload ran twice — once real, once echoed — and the echo is marked
    expect(recorder.hits.map(hit => hit.echo)).toEqual([false, true]);
  });

  it('two propagators stacked still terminate, echoes coming only off the real swing', () => {
    const { attacker, victim } = pair();
    const recorder = new RecordingOnHit(0, attacker, attacker);
    attacker.addBuff(recorder);
    const first = new EchoOnce(0, attacker, attacker);
    first.stackId = 'echo-one';
    const second = new EchoOnce(0, attacker, attacker);
    second.stackId = 'echo-two';
    attacker.addBuff(first);
    attacker.addBuff(second);

    landBasicAttack(attacker, victim, 20, false);

    // one real application plus one echo per propagator — never echoes of echoes
    expect(recorder.hits.map(hit => hit.echo)).toEqual([false, true, true]);
  });

  it('the depth latch stops a propagator that forgot its echo check', () => {
    const { attacker, victim } = pair();
    const runaway = new RunawayEcho(0, attacker, attacker);
    attacker.addBuff(runaway);

    landBasicAttack(attacker, victim, 20, false);

    expect(runaway.applications).toBe(MAX_ONHIT_DEPTH);
  });

  it('a one-shot effect may remove its own buff mid-walk without breaking it', () => {
    const { attacker, victim } = pair();
    class OneShot extends Buff {
      fired = 0;
      onHit(): void {
        this.fired++;
        this.deactivateBuff();
      }
    }
    const oneShot = new OneShot(0, attacker, attacker);
    const recorder = new RecordingOnHit(0, attacker, attacker);
    attacker.addBuff(oneShot);
    attacker.addBuff(recorder);

    landBasicAttack(attacker, victim, 20, false);
    landBasicAttack(attacker, victim, 20, false);

    expect(oneShot.fired).toBe(1);
    expect(recorder.hits).toHaveLength(2);
  });
});

describe('a spell takes its owned buffs with it when removed', () => {
  class Bench extends Spell {
    name = 'Bench';
    targetingMode = 'SELF' as const;
  }

  it('onRemoved deactivates exactly the buffs that named it sourceSpell', () => {
    const { attacker } = pair();
    const spell = new Bench(attacker);
    spell.owner = attacker;

    const owned = new RecordingOnHit(0, attacker, attacker);
    owned.stackId = 'owned';
    owned.sourceSpell = spell;
    const unrelated = new RecordingOnHit(0, attacker, attacker);
    unrelated.stackId = 'unrelated';
    attacker.addBuff(owned);
    attacker.addBuff(unrelated);

    spell.onRemoved();

    expect(owned.toRemove).toBe(true);
    expect(unrelated.toRemove).toBe(false);
  });
});

describe('what counts as an ability cast', () => {
  it('an ordinary spell does; the flag is the default', () => {
    const { attacker } = pair();
    class Bench extends Spell {
      targetingMode = 'SELF' as const;
    }
    expect(new Bench(attacker).countsAsAbilityCast).toBe(true);
  });
});
