import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PackRegistry, qualify } from '@/content/PackRegistry';
import { buildContentApi } from '@/content/ContentApi';
import { installRuntimePack } from '@/content/install';
import AssetManager from '@/managers/AssetManager';
import type { LoadedPack } from '@/content/packSource';

// A real, non-empty spell class rather than `{}` — a fixture with nothing in
// the code half gives a test nothing to observe there, which is exactly how
// "installs both halves" ended up proving only the data half landed.
class Bolt {}

const loaded = (id: string): LoadedPack => ({
  manifest: {
    id,
    version: '1.0.0',
    coreRange: '>=1.0.0',
    name: id,
    entry: 'pack.js',
    assets: 'assets/',
  },
  data: {
    manifest: { id, version: '1.0.0', coreRange: '>=1.0.0' },
    champions: [],
    spellDisplay: {},
  } as unknown as LoadedPack['data'],
  code: () => ({ spells: { bolt: Bolt } }),
  assetManifest: { hero: { kind: 'image', url: 'https://h/p/assets/hero.png', path: 'hero.png' } },
  baseUrl: 'https://h/p/manifest.json',
});

/**
 * A pack shaped the way the real one is: a champion whose slot 0 is a bare
 * `BasicAttack` and whose way home is a bare `Recall`, neither of which the
 * pack supplies. Both live in core, and `writeData` qualifies a bare id
 * against the pack that named it — so this pack asks the registry for
 * `probe:BasicAttack` and `probe:Recall`, and only `install.ts`'s core-spell
 * fold can answer.
 */
const loadedWithCoreSpellReferences = (id: string): LoadedPack => {
  const pack = loaded(id);
  return {
    ...pack,
    data: {
      ...pack.data,
      champions: [
        {
          id: 'Probey',
          name: 'Probey',
          image: null,
          // Not `playable` only so the fixture can stay two abilities long —
          // `validate.ts` requires a portrait and exactly four of them for a
          // playable one, and neither is what this pack is here to exercise.
          playable: false,
          spells: ['BasicAttack', 'bolt'],
          recall: 'Recall',
        },
      ],
    } as unknown as LoadedPack['data'],
  };
};

describe('installRuntimePack', () => {
  let registry: PackRegistry;
  beforeEach(() => {
    registry = new PackRegistry();
  });

  it('installs both halves under the manifest id', () => {
    installRuntimePack(registry, buildContentApi(), loaded('probe'));
    // Data half: PackRegistry exposes no `hasPack`/`packIds` — the only
    // public surface that answers "is this id installed" is `installData`'s
    // own duplicate-install guard, so a second install under the same id
    // throwing (naming that id) is the proof the first one actually landed.
    expect(() => registry.installData(loaded('probe').data)).toThrow(/probe/);
    // Code half: `hasSpell` reads the `sources` map that only
    // `PackRegistry.installCode`'s `writeCode` ever populates — `installData`
    // never touches it. Without this line the test above passes even when
    // `installRuntimePack` never calls `installCode` at all, which is
    // exactly the gap that shipped: the reviewer deleted that call and every
    // assertion here still went green.
    expect(registry.hasSpell(qualify('probe', 'bolt'))).toBe(true);
  });

  it("registers the pack's own asset manifest so its art resolves", () => {
    const spy = vi.spyOn(AssetManager, 'registerPackAssets');
    installRuntimePack(registry, buildContentApi(), loaded('probe'));
    expect(spy).toHaveBeenCalledWith('probe', expect.objectContaining({ hero: expect.anything() }));
    spy.mockRestore();
  });

  it('refuses a second install under an id already taken', () => {
    const api = buildContentApi();
    installRuntimePack(registry, api, loaded('probe'));
    expect(() => installRuntimePack(registry, api, loaded('probe'))).toThrow();
  });

  it('answers hasPack for the id it installed, and not for one it did not', () => {
    expect(registry.hasPack('probe')).toBe(false);
    installRuntimePack(registry, buildContentApi(), loaded('probe'));
    expect(registry.hasPack('probe')).toBe(true);
    expect(registry.hasPack('somebody-else')).toBe(false);
  });

  it("registers nothing when the id is already taken, so a duplicate cannot repoint the pack's art", () => {
    const api = buildContentApi();
    installRuntimePack(registry, api, loaded('probe'));
    const spy = vi.spyOn(AssetManager, 'registerPackAssets');
    expect(() => installRuntimePack(registry, api, loaded('probe'))).toThrow(/already installed/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("folds core's BasicAttack and Recall onto a runtime pack, the way the bundled path does", () => {
    // The critical bug this branch shipped with: the fold was applied only to
    // `packsInInstallOrder[0]`, so a pack that arrived over the network had
    // its code half rejected by `verifyPairing` — one error per champion —
    // while its data half had already landed. The roster grew and every
    // champion in it walked into a match with seven slots of `BasicAttack`.
    installRuntimePack(registry, buildContentApi(), loadedWithCoreSpellReferences('probe'));

    expect(registry.hasPack('probe')).toBe(true);
    expect(registry.hasSpell(qualify('probe', 'BasicAttack'))).toBe(true);
    expect(registry.hasSpell(qualify('probe', 'Recall'))).toBe(true);
    expect(registry.champions().map(champion => champion.id)).toEqual([qualify('probe', 'Probey')]);
  });

  it('leaves no trace when the pack is rejected — not the id, not its art', () => {
    // The secondary damage of the bug above: `installData` then `installCode`
    // is two writes, and the failure landed between them. The id was taken,
    // the champions were written, the asset manifest was registered, and
    // `PackRegistry` has no way to remove any of it.
    const spy = vi.spyOn(AssetManager, 'registerPackAssets');
    const broken = loaded('probe');
    const rejected: LoadedPack = {
      ...broken,
      data: {
        ...broken.data,
        champions: [
          {
            id: 'Probey',
            name: 'Probey',
            image: null,
            playable: false,
            spells: ['bolt', 'NoSuchSpell'],
          },
        ],
      } as unknown as LoadedPack['data'],
    };

    expect(() => installRuntimePack(registry, buildContentApi(), rejected)).toThrow(/NoSuchSpell/);
    expect(registry.hasPack('probe')).toBe(false);
    expect(registry.champions()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
