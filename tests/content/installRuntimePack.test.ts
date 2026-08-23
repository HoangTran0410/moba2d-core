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
});
