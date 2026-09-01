import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Buff from '../../../src/game/gameObject/Buff';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Stasis from '../../../src/game/gameObject/buffs/Stasis';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';

installSpellObjectGlobals();

const pair = () => {
  const game = createGame();
  const caster = createUnit(game, 0, 'blue');
  const victim = createUnit(game, 50, 'red');
  return { game, caster, victim };
};

/**
 * The other half of "a resistance you can buy": armour answers damage,
 * tenacity answers the crowd control that arrives with it.
 */
describe('tenacity', () => {
  it('changes nothing for a unit nobody granted any', () => {
    const { caster, victim } = pair();
    victim.addBuff(new Stun(2_000, caster, victim));

    expect(victim.buffs[0].duration).toBe(2_000);
  });

  it('takes its share off a stun somebody else applied', () => {
    const { caster, victim } = pair();
    victim.stats.tenacity.baseValue = 0.3;

    victim.addBuff(new Stun(2_000, caster, victim));

    expect(victim.buffs[0].duration).toBe(1_400);
  });

  /**
   * `Stasis` wears the same `Stunned` bit a real stun does and is a way *out*
   * of a fight — the same reason `cleanse()` skips a unit's own buffs. Cutting
   * its duration would make one item shorten another item's escape.
   */
  it('leaves crowd control the unit put on itself alone', () => {
    const { victim } = pair();
    victim.stats.tenacity.baseValue = 0.5;

    victim.addBuff(new Stasis(2_000, victim, victim));

    expect(victim.buffs[0].duration).toBe(2_000);
  });

  /** A slow carries no status flag: it is a stat modifier, and not on the list. */
  it('does not shorten a slow', () => {
    const { caster, victim } = pair();
    victim.stats.tenacity.baseValue = 0.5;
    const slow = new Slow(2_000, caster, victim);
    slow.percent = 0.3;

    victim.addBuff(slow);

    expect(victim.buffs[0].duration).toBe(2_000);
  });

  /**
   * League exempts a short list by name — knock-ups, suppression, nearsight,
   * drowsy and stasis — because they are the effects a player cannot play
   * around at all, and shortening them by an item would quietly delete the
   * counterplay window they exist to create. Airborne and Stasis are already
   * out (one carries no flag on this list, the other is self-applied); these
   * two are the ones that needed saying.
   */
  it.each([
    ['nearsight', StatusFlags.NearSighted],
    ['suppression', StatusFlags.Suppressed],
  ])('leaves %s alone, which no amount of tenacity shortens', (_name, flag) => {
    // The flag, not one of the buff classes that wears it: what is exempt is a
    // property of the *effect*, and a pack inventing its own suppression has to
    // be exempt too. `Nearsight` also reaches the camera on activate, which a
    // bare stat test has no business constructing.
    class Exempt extends Buff {
      statusFlagsToEnable = flag;
    }
    const { caster, victim } = pair();
    victim.stats.tenacity.baseValue = 0.5;

    victim.addBuff(new Exempt(2_000, caster, victim));

    expect(victim.buffs[0].duration).toBe(2_000);
  });

  /**
   * The floor. League refuses to take a disable under 0.3s, so that a stun is
   * always long enough to *be* one — and a champion built to 60% tenacity does
   * not turn every stun in the game into a flicker nobody can react to.
   */
  it('never takes a disable below three tenths of a second', () => {
    const { caster, victim } = pair();
    victim.stats.tenacity.baseValue = 0.9;

    victim.addBuff(new Stun(1_000, caster, victim));

    expect(victim.buffs[0].duration).toBe(300);
  });

  it('leaves a disable that was already shorter than the floor untouched', () => {
    const { caster, victim } = pair();
    victim.stats.tenacity.baseValue = 0.9;

    victim.addBuff(new Stun(200, caster, victim));

    expect(victim.buffs[0].duration).toBe(200);
  });

  /** `duration = 0` is what permanent means to `Buff.update`; a share of it is still 0. */
  it('leaves a permanent effect permanent', () => {
    const { caster, victim } = pair();
    victim.stats.tenacity.baseValue = 0.5;

    victim.addBuff(new Stun(0, caster, victim));

    expect(victim.buffs[0].duration).toBe(0);
  });
});
