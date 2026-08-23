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
  contentRegistry: vi.fn(() => ({})),
  rebuildContentRegistry: vi.fn(() => ({})),
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
    // The offer is spent once it has been made, win or lose — see
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

  it('marks the default pack seeded even when the fetch fails, so it is not retried forever', async () => {
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest).mockRejectedValue(new PackLoadError('fetch', 'offline'));
    expect(hasSeededDefaultPack()).toBe(false);

    await installRuntimePacks();

    expect(hasSeededDefaultPack()).toBe(true);
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
