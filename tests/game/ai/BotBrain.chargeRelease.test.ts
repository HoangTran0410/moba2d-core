/**
 * How long a bot holds a charge.
 *
 * It was `maxDurationMs / 2` — half, for every charged ability in every pack,
 * with nothing in the file saying why. So a bot threw an 18–48 skillshot at
 * 33 and a 45–75 one at 60, always, and a tap-or-hold ability never tapped.
 *
 * Charging to the top is the better default and it is not a safe blanket
 * rule, which is the whole reason `Spell.aiChargeReleaseAtMs` exists:
 *
 * - a charge that is not `releaseAtMax` is **cancelled** at max
 *   (`SpellRuntime.updateCharge` → `cancelActivation('MAX_DURATION')`), so
 *   holding to the stated number throws the ability away;
 * - and most charges stop paying long before max — one skillshot in the
 *   shipped content maxes range at 1500ms and damage at 1250ms against a
 *   4000ms window, and `advanceCharge` blinds the bot for every one of the
 *   2.5 wasted seconds.
 */
import { describe, expect, it } from 'vitest';
import { CHARGE_CANCEL_MARGIN_MS, chargeReleaseAtMs } from '../../../src/game/ai/BotBrain';
import type Spell from '../../../src/game/gameObject/Spell';

const spellWith = (aiChargeReleaseAtMs?: number): Spell => {
  const cls = class {
    static aiChargeReleaseAtMs = aiChargeReleaseAtMs;
  };
  return new cls() as unknown as Spell;
};

describe('when a bot lets go of a charge', () => {
  it('charges to the top when the runtime fires it there', () => {
    const at = chargeReleaseAtMs(spellWith(), { maxDurationMs: 1_200, releaseAtMax: true });
    expect(at).toBe(1_200);
  });

  it('stops short when the runtime would cancel it there instead', () => {
    // The failure this margin prevents is total: the ability is not weaker,
    // it is gone, and the mana and cooldown go with it.
    const at = chargeReleaseAtMs(spellWith(), { maxDurationMs: 4_000, releaseAtMax: false });
    expect(at).toBe(4_000 - CHARGE_CANCEL_MARGIN_MS);
    expect(at).toBeLessThan(4_000);
  });

  it('lets an ability name the moment it stops improving', () => {
    const at = chargeReleaseAtMs(spellWith(1_500), { maxDurationMs: 4_000, releaseAtMax: false });
    expect(at).toBe(1_500);
  });

  it('clamps a declared moment the runtime would cancel at', () => {
    // The runtime's rule is not a pack's to override. A spell asking to be
    // held to its own `maxDurationMs` is asking to be cancelled, and it gets
    // the safe answer rather than what it asked for.
    const at = chargeReleaseAtMs(spellWith(4_000), { maxDurationMs: 4_000, releaseAtMax: false });
    expect(at).toBe(4_000 - CHARGE_CANCEL_MARGIN_MS);
  });

  it('never asks for a negative hold', () => {
    const at = chargeReleaseAtMs(spellWith(-500), { maxDurationMs: 1_000, releaseAtMax: true });
    expect(at).toBe(0);
  });
});
