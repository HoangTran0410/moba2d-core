/**
 * What a bare, unqualified spell id means once more than one pack is installed.
 *
 * `PregameConfig`'s summoner defaults are bare *today* — `summonerD: 'Flash'`
 * — and every loadout saved before content became packs is bare throughout.
 * The rule used to be "a bare id belongs to the first installed pack", full
 * stop, and that held for exactly as long as there was one optional pack to
 * be first.
 *
 * `src/generated/installedPacks.ts` sorts by package name. Install `dota`,
 * `lol` and `naruto` together and `dota` sorts first — while only the League
 * pack ships `Flash`, `Ghost`, `Heal`, `Ignite` and `StealthWard`. Every bare
 * `'Flash'` began resolving to `dota:Flash`, which exists nowhere, and
 * nothing threw: the summoner slot simply came back empty. The rule is now
 * "the first installed pack **that declares it**", with the old answer kept
 * as the fallback so an id nobody declares fails exactly where it used to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/managers/AssetManager', () => ({
  default: {
    get: () => ({ url: '', image: null }),
    getAsset: () => undefined,
    placeholder: () => undefined,
    registerPackAssets: () => undefined,
  },
}));

import { contentRegistry, resetContentRegistryForTests } from '@/content/registry';
import { buildContentApi } from '@/content/ContentApi';
import { BUNDLED_PACK_ID, installRuntimePack } from '@/content/install';
import { qualifySpellId } from '@/game/spellRegistry';
import type { LoadedPack } from '@/content/packSource';

class Bolt {}

/** A pack whose only interesting property is that it declares `ProbeOnly`. */
const probePack = (id: string): LoadedPack =>
  ({
    manifest: { id, version: '1.0.0', coreRange: '>=1.0.0', name: id, entry: 'pack.js', assets: 'assets/' },
    data: {
      manifest: { id, version: '1.0.0', coreRange: '>=1.0.0', assets: 'assets/' },
      champions: [],
      spellDisplay: {
        ProbeOnly: {
          name: 'Probe Only',
          description: '',
          iconKey: 'hero',
          coolDownMs: 1_000,
          manaCost: 10,
          specCoolDownMs: 1_000,
        },
      },
    },
    code: () => ({ spells: { ProbeOnly: Bolt } }),
    assetManifest: {},
    baseUrl: 'https://h/p/manifest.json',
  }) as unknown as LoadedPack;

afterEach(() => {
  resetContentRegistryForTests();
});

describe('a bare spell id', () => {
  it('resolves to the pack that declares it, not merely to the first one', () => {
    const registry = contentRegistry();
    // Installed last, so it is *not* the first pack — which is the whole
    // point: under the old rule this resolved to `${BUNDLED_PACK_ID}:ProbeOnly`.
    installRuntimePack(registry, buildContentApi(registry), probePack('probe'));

    expect(qualifySpellId('ProbeOnly')).toBe('probe:ProbeOnly');
  });

  it('keeps the old answer for an id no pack declares', () => {
    // The fallback matters: a stale saved slot naming a spell that no longer
    // exists must fail the way it always did — as one unresolvable id — not
    // as an unqualified string that later code has no rule for.
    contentRegistry();
    expect(qualifySpellId('NoPackHasThisSpell')).toBe(`${BUNDLED_PACK_ID}:NoPackHasThisSpell`);
  });

  it('leaves an already-qualified id alone', () => {
    contentRegistry();
    expect(qualifySpellId('probe:ProbeOnly')).toBe('probe:ProbeOnly');
  });

  it('notices a pack installed after the first lookup', () => {
    // The cache this resolution now keeps is keyed on the registry's content
    // revision *and* its identity — a runtime install mutates the very
    // instance being read from, so a memo keyed on identity alone would
    // answer from before the install forever. That is the exact bug
    // `preset.runtimePack.test.ts` exists for, one layer down.
    const registry = contentRegistry();
    expect(qualifySpellId('ProbeOnly')).toBe(`${BUNDLED_PACK_ID}:ProbeOnly`);

    installRuntimePack(registry, buildContentApi(registry), probePack('probe'));

    expect(qualifySpellId('ProbeOnly')).toBe('probe:ProbeOnly');
  });
});
