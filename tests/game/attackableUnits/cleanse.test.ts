import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Stun from '@/game/gameObject/buffs/Stun';
import Root from '@/game/gameObject/buffs/Root';
import Silence from '@/game/gameObject/buffs/Silence';
import Slow from '@/game/gameObject/buffs/Slow';
import Stasis from '@/game/gameObject/buffs/Stasis';
import Shield from '@/game/gameObject/buffs/Shield';

/**
 * Getting out of crowd control — the mechanic a Quicksilver-style item is, and
 * the one an ally-cast cleanse will be.
 *
 * Written in core rather than in whichever pack wants it first, because the
 * definition of "this buff is crowd control" is core's: it is a mask over
 * `StatusFlags`, and a pack computing it for itself would be a second answer
 * to a question the engine already has to answer every frame in
 * `Stats.updateActionState`.
 *
 * Two boundaries, and both are the interesting half:
 *
 *   - **Only what someone else did to you.** `Stasis` locks a champion down
 *     with the same `Stunned` flag a real stun uses, but it is *self*-cast and
 *     it is a way out of a fight. Pressing one item to cancel another is not a
 *     cleanse, it is a bug with two buttons. The unit's own buffs are left
 *     alone, which is also the rule the health bar's CC line already follows.
 *   - **Crowd control, not everything.** A slow is a stat modifier, not a
 *     status flag, and a cleanse that took shields and damage-over-time off
 *     with it would be a full dispel — a much bigger effect wearing a smaller
 *     name.
 */
describe('AttackableUnit.cleanse', () => {
  let game: TestGame;
  let victim: Champion;
  let enemy: Champion;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    victim = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    enemy = new Champion({ game, position: createVector(100, 0), teamId: 'red' });
    game.setPlayer(victim);
    indexObjects(game, [victim, enemy]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('takes a stun off, and says it took one', () => {
    victim.addBuff(new Stun(3_000, enemy, victim));
    // Status flags are rebuilt in `update`, not on `addBuff` — the buff is on
    // the unit immediately, the lockout it causes lands on the next frame.
    victim.update();
    expect(victim.canMove, 'the stun never took hold, so the cleanse proves nothing').toBe(false);

    expect(victim.cleanse()).toBe(1);

    victim.update();
    expect(victim.canMove, 'still rooted to the spot after a cleanse').toBe(true);
  });

  it('takes every one of them off at once', () => {
    victim.addBuff(new Stun(3_000, enemy, victim));
    victim.addBuff(new Root(3_000, enemy, victim));
    victim.addBuff(new Silence(3_000, enemy, victim));

    expect(victim.cleanse()).toBe(3);
    expect(victim.buffs.filter(buff => !buff.toRemove)).toHaveLength(0);
  });

  it('leaves a slow alone — it is a stat, not a status', () => {
    // And a cleanse that removed it would be a dispel wearing a cleanse's name.
    victim.addBuff(new Slow(3_000, enemy, victim));
    expect(victim.cleanse()).toBe(0);
    expect(victim.buffs).toHaveLength(1);
  });

  it('leaves a shield alone', () => {
    victim.addBuff(new Shield(3_000, enemy, victim));
    expect(victim.cleanse()).toBe(0);
  });

  it('leaves the unit’s own stasis standing', () => {
    // The failure this rule exists for: `Stasis` locks its owner down with the
    // same `Stunned` flag a real stun uses, but it is self-cast and it is a way
    // *out* of a fight. One item cancelling another is a bug with two buttons.
    victim.addBuff(new Stasis(2_500, victim, victim));
    expect(victim.cleanse()).toBe(0);
    expect(victim.buffs).toHaveLength(1);
  });

  it('does take an enemy’s stun while the unit is in its own stasis', () => {
    victim.addBuff(new Stasis(2_500, victim, victim));
    victim.addBuff(new Stun(3_000, enemy, victim));

    expect(victim.cleanse()).toBe(1);
    expect(victim.buffs.filter(buff => !buff.toRemove)).toHaveLength(1);
  });

  it('answers 0 on a unit with nothing on it, rather than throwing', () => {
    expect(victim.cleanse()).toBe(0);
  });

  it('does nothing to a corpse', () => {
    victim.addBuff(new Stun(3_000, enemy, victim));
    victim.takeDamage(99_999, enemy, 'TRUE');
    // Dying already dropped every buff; the point is that the call is safe.
    expect(() => victim.cleanse()).not.toThrow();
  });
});
