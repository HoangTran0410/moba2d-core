import { describe, expect, it } from 'vitest';
import { buildTestApi } from '../../src/testing';
import { loadSpellsForTests, resolveSpellBarrel } from '../../src/testing/spellRegistry';
import { spellClassOfId } from '../../src/game/spellRegistry';
import { buildContentApi } from '../../src/content/ContentApi';
import CastTelegraph from '../../src/game/vfx/CastTelegraph';
import * as CoreSpells from '../../src/game/gameObject/coreSpells/index';

describe('loadSpellsForTests', () => {
  it('registers a barrel handed in by the caller, without naming any pack', () => {
    class Fake {}
    expect(resolveSpellBarrel({ Probe_Q: () => Fake }).Probe_Q).toBe(Fake);

    loadSpellsForTests({ Probe_Q: () => Fake });
    // the registry is src/game/spellRegistry.ts; assert Probe_Q resolves to Fake
    expect(spellClassOfId('Probe_Q')).toBe(Fake);
  });

  it("always registers core's own spells even when no barrel is passed", () => {
    loadSpellsForTests();
    // assert a coreSpells member (BasicAttack) is registered
    expect(spellClassOfId('BasicAttack')).toBe(CoreSpells.BasicAttack);
  });
});

describe('buildTestApi', () => {
  it('swaps one member and leaves the rest of the namespace alone', () => {
    class FakeTelegraph {}
    const api = buildTestApi({ vfx: { CastTelegraph: FakeTelegraph } });
    expect(api.vfx.CastTelegraph).toBe(FakeTelegraph);
    expect(typeof api.vfx.CastBar).toBe('function');
    expect(typeof api.buffs.Slow).toBe('function');
  });

  it('does not mutate the shared api', () => {
    class FakeTelegraph {}
    buildTestApi({ vfx: { CastTelegraph: FakeTelegraph } });
    // assert buildContentApi().vfx.CastTelegraph is still the real one
    expect(buildContentApi().vfx.CastTelegraph).toBe(CastTelegraph);
  });
});
