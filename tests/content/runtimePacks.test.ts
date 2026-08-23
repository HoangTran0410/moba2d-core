import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/content/packSource', () => ({
  PackLoadError: class extends Error {
    stage: string;
    constructor(stage: string, message: string) {
      super(message);
      this.stage = stage;
    }
  },
  fetchPackManifest: vi.fn(),
  loadPackFromManifest: vi.fn(),
}));
vi.mock('@/content/install', () => ({ installRuntimePack: vi.fn() }));
vi.mock('@/content/registry', () => ({
  contentRegistry: vi.fn(() => ({ hasPack: () => false })),
  rebuildContentRegistry: vi.fn(() => ({ hasPack: () => false })),
}));
vi.mock('@/content/ContentApi', () => ({ buildContentApi: vi.fn(() => ({})) }));

import { installRuntimePacks, DEFAULT_PACK_URL } from '@/content/runtimePacks';
import { fetchPackManifest, loadPackFromManifest } from '@/content/packSource';
import { installRuntimePack } from '@/content/install';
import { rebuildContentRegistry } from '@/content/registry';
import {
  readInstalledPacks,
  writeInstalledPacks,
  hasSeededDefaultPack,
  markDefaultPackSeeded,
  PACK_STORE_KEY,
} from '@/content/installedPackStore';

const withStorage = () => {
  const map = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
};

const manifest = {
  id: 'riot',
  version: '1.0.0',
  coreRange: '>=1.0.0',
  name: 'Riot',
  entry: 'pack.js',
  assets: 'assets/',
};

describe('installRuntimePacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` clears recorded calls, not implementations — so a test
    // that gives `rebuildContentRegistry` a registry of its own would leak it
    // into every test after it. Re-stated here rather than reached for with
    // `resetAllMocks`, which would also wipe the factories in the `vi.mock`
    // calls above.
    vi.mocked(rebuildContentRegistry).mockReturnValue({ hasPack: () => false } as never);
    withStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('seeds the default pack on a first run with nothing stored', async () => {
    expect(hasSeededDefaultPack()).toBe(false);
    vi.mocked(fetchPackManifest).mockResolvedValue(manifest);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    const outcomes = await installRuntimePacks();

    expect(fetchPackManifest).toHaveBeenCalledWith(DEFAULT_PACK_URL);
    expect(outcomes).toEqual([{ manifestUrl: DEFAULT_PACK_URL, ok: true, id: 'riot' }]);
    expect(readInstalledPacks()).toEqual([
      { manifestUrl: DEFAULT_PACK_URL, id: 'riot', version: '1.0.0' },
    ]);
    // The offer is spent only once it has actually been taken — see
    // `runtimePacks.ts`'s own header.
    expect(hasSeededDefaultPack()).toBe(true);
  });

  it('does not seed the default once the flag says it already offered it, even with nothing stored', async () => {
    // The situation the flag exists for: an old browser whose player
    // removed every pack looks identical, from the list alone, to a
    // browser that has never run this game. Only the flag tells them apart.
    markDefaultPackSeeded();

    const outcomes = await installRuntimePacks();

    expect(fetchPackManifest).not.toHaveBeenCalled();
    expect(loadPackFromManifest).not.toHaveBeenCalled();
    expect(installRuntimePack).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
    expect(readInstalledPacks()).toEqual([]);
  });

  it('leaves the offer unspent when the seeding attempt fails, so the next boot retries it', async () => {
    // The reversal the whole-branch review forced, and it was right:
    // `DEFAULT_PACK_URL` answers 404 until the pack repository publishes, so
    // marking the flag on a failed attempt locks every browser that booted
    // before publication out of the content permanently — and the retry the
    // banner offers is `location.reload()`, which re-runs this same code and
    // finds the flag already set.
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest).mockRejectedValue(new PackLoadError('fetch', 'offline'));
    expect(hasSeededDefaultPack()).toBe(false);

    await installRuntimePacks();

    expect(hasSeededDefaultPack()).toBe(false);
  });

  it('tries the default again on the next boot after a failed seeding attempt', async () => {
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest).mockRejectedValue(new PackLoadError('fetch', '404'));

    await installRuntimePacks();
    await installRuntimePacks();

    expect(fetchPackManifest).toHaveBeenCalledTimes(2);
    expect(fetchPackManifest).toHaveBeenNthCalledWith(2, DEFAULT_PACK_URL);
  });

  it('skips a pack whose id is already installed, without fetching its entry', async () => {
    // Both content paths are live until Plan 2 retires core's compile-in
    // step, and they answer to the same id. The skip has to happen before
    // `loadPackFromManifest` (or the pack is downloaded for nothing) and
    // before `installRuntimePack` (whose asset registration is a bare
    // `Map.set` that would repoint the local pack's art at the remote host).
    vi.mocked(rebuildContentRegistry).mockReturnValue({
      hasPack: (id: string) => id === 'riot',
    } as never);
    vi.mocked(fetchPackManifest).mockResolvedValue(manifest);

    const outcomes = await installRuntimePacks();

    expect(loadPackFromManifest).not.toHaveBeenCalled();
    expect(installRuntimePack).not.toHaveBeenCalled();
    expect(outcomes).toEqual([
      { manifestUrl: DEFAULT_PACK_URL, ok: true, id: 'riot', skipped: true },
    ]);
  });

  it('counts a skip as content the player has, not as a failure', async () => {
    vi.mocked(rebuildContentRegistry).mockReturnValue({
      hasPack: (id: string) => id === 'riot',
    } as never);
    vi.mocked(fetchPackManifest).mockResolvedValue(manifest);

    const outcomes = await installRuntimePacks();

    expect(outcomes[0]).toMatchObject({ ok: true, skipped: true });
    // The id is present, so the one-time offer is settled and the list is
    // worth remembering — the next boot re-reads it and skips again cheaply,
    // and installs for real once the compile-in step is gone.
    expect(hasSeededDefaultPack()).toBe(true);
    expect(readInstalledPacks()).toEqual([
      { manifestUrl: DEFAULT_PACK_URL, id: 'riot', version: '1.0.0' },
    ]);
  });

  it('answers with an outcome instead of rejecting when the registry itself throws', async () => {
    // `buildContentApi()` and `rebuildContentRegistry()` sit outside the
    // per-pack `try`, and `LoadingScene.enter()` calls `boot()` as
    // `void this.boot()` — so a throw here used to be an unhandled rejection
    // and the menu handover never ran. "Nothing here may throw" was a
    // comment enforced by nothing; this is the enforcement.
    vi.mocked(rebuildContentRegistry).mockImplementation(() => {
      throw new Error('registry exploded');
    });

    const outcomes = await installRuntimePacks();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[0]).toMatchObject({ stage: 'registry', message: 'registry exploded' });
  });

  it('reports a failure instead of throwing, and stores nothing', async () => {
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest).mockRejectedValue(new PackLoadError('fetch', 'offline'));

    const outcomes = await installRuntimePacks();

    expect(outcomes).toEqual([
      { manifestUrl: DEFAULT_PACK_URL, ok: false, stage: 'fetch', message: 'offline' },
    ]);
    expect(installRuntimePack).not.toHaveBeenCalled();
    expect(readInstalledPacks()).toEqual([]);
  });

  it('does not re-seed the default once a list exists', async () => {
    writeInstalledPacks([
      { manifestUrl: 'https://other/manifest.json', id: 'other', version: '2.0.0' },
    ]);
    vi.mocked(fetchPackManifest).mockResolvedValue({ ...manifest, id: 'other', version: '2.0.0' });
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    await installRuntimePacks();

    expect(fetchPackManifest).toHaveBeenCalledTimes(1);
    expect(fetchPackManifest).toHaveBeenCalledWith('https://other/manifest.json');
  });

  it('keeps going after one pack fails, so a bad entry cannot hide a good one', async () => {
    writeInstalledPacks([
      { manifestUrl: 'https://bad/manifest.json', id: 'bad', version: '1.0.0' },
      { manifestUrl: 'https://good/manifest.json', id: 'good', version: '1.0.0' },
    ]);
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest)
      .mockRejectedValueOnce(new PackLoadError('fetch', 'gone'))
      .mockResolvedValueOnce({ ...manifest, id: 'good' });
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    const outcomes = await installRuntimePacks();

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[1].ok).toBe(true);
    expect(localStorage.getItem(PACK_STORE_KEY)).toContain('good');
  });

  it('rebuilds the content registry exactly once, not once per pack', async () => {
    writeInstalledPacks([
      { manifestUrl: 'https://a/manifest.json', id: 'a', version: '1.0.0' },
      { manifestUrl: 'https://b/manifest.json', id: 'b', version: '1.0.0' },
    ]);
    vi.mocked(fetchPackManifest)
      .mockResolvedValueOnce({ ...manifest, id: 'a' })
      .mockResolvedValueOnce({ ...manifest, id: 'b' });
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    await installRuntimePacks();

    expect(rebuildContentRegistry).toHaveBeenCalledTimes(1);
  });
});
