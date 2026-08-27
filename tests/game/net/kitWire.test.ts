import { beforeAll, describe, expect, it } from 'vitest';
import { loadSpells, spellClassOfId } from '../../../src/game/spellRegistry';
import { asKitPlan, planFromPreset } from '../../../src/game/net/kitWire';
import {
  DEFAULT_CHAMPION_ATTACK,
  DEFAULT_CHAMPION_DEFENCE,
} from '../../../src/game/gameObject/attackableUnits/Champion';

/**
 * The kit-change wire (`net/kitWire.ts`): an applied preset (classes) has to
 * come back as the plan it was built from (ids), or a đổi tướng crosses the
 * LAN as a different champion than the one the player picked. Real reference-
 * pack spells, loaded through the real registry — the reverse lookup under
 * test is exactly the one production runs.
 */

let veraQ: unknown;
let veraW: unknown;

beforeAll(async () => {
  // Fully qualified on purpose: a bare id qualifies against the *first
  // installed* pack (`BUNDLED_PACK_ID`), which in a dev-linked checkout is
  // not the reference pack, and an unknown id is silently skipped by design.
  await loadSpells(['reference:Vera_Q', 'reference:Vera_W']);
  veraQ = spellClassOfId('reference:Vera_Q');
  veraW = spellClassOfId('reference:Vera_W');
  if (!veraQ || !veraW) throw new Error('reference pack spells did not load');
});

describe('planFromPreset', () => {
  it('recovers the catalogue ids of real loaded classes', () => {
    const plan = planFromPreset({
      name: 'Vera',
      avatar: 'champ_vera',
      attack: DEFAULT_CHAMPION_ATTACK,
      defence: DEFAULT_CHAMPION_DEFENCE,
      spells: [veraQ, veraW] as never[],
      passive: veraW as never,
    });

    // Written out by hand: the registry stores the reference pack's spells
    // under its qualified ids, and the wire has to carry those — a bare id
    // would resolve, but the *format* is the thing being pinned.
    expect(plan.spellIds).toEqual(['reference:Vera_Q', 'reference:Vera_W']);
    expect(plan.passiveId).toBe('reference:Vera_W');
    expect(plan.name).toBe('Vera');
    expect(plan.avatar).toBe('champ_vera');
    expect(plan.attack).toBe(DEFAULT_CHAMPION_ATTACK);
  });

  it('falls back to the basic attack for a class the catalogue does not name', () => {
    class NotASpell {}
    const plan = planFromPreset({
      name: 'X',
      spells: [NotASpell] as never[],
    });
    expect(plan.spellIds).toEqual(['BasicAttack']);
    expect(plan.passiveId).toBeUndefined();
    // Absent tunings fall to the engine defaults rather than to undefined —
    // the receiving `presetFromPlan` hands them straight to a Champion.
    expect(plan.attack).toBe(DEFAULT_CHAMPION_ATTACK);
    expect(plan.defence).toBe(DEFAULT_CHAMPION_DEFENCE);
  });
});

describe('asKitPlan', () => {
  const valid = {
    name: 'Vera',
    avatar: '',
    attack: { ...DEFAULT_CHAMPION_ATTACK },
    defence: { ...DEFAULT_CHAMPION_DEFENCE },
    spellIds: ['BasicAttack', 'reference:Vera_Q'],
  };

  it('accepts a plan that survived JSON, with and without a passive', () => {
    expect(asKitPlan(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
    const withPassive = { ...valid, passiveId: 'reference:Vera_W' };
    expect(asKitPlan(JSON.parse(JSON.stringify(withPassive)))).toEqual(withPassive);
  });

  it('answers null for malformed wire data, never a throw', () => {
    expect(asKitPlan(null)).toBeNull();
    expect(asKitPlan('Vera')).toBeNull();
    expect(asKitPlan({})).toBeNull();
    expect(asKitPlan({ ...valid, name: 7 })).toBeNull();
    expect(asKitPlan({ ...valid, attack: 'strong' })).toBeNull();
    expect(asKitPlan({ ...valid, spellIds: [] })).toBeNull();
    expect(asKitPlan({ ...valid, spellIds: ['BasicAttack', 42] })).toBeNull();
    expect(asKitPlan({ ...valid, passiveId: 42 })).toBeNull();
  });
});
