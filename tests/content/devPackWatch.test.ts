import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/content/packSource', () => ({ fetchPackManifest: vi.fn() }));

import { startDevPackWatch } from '@/content/devPackWatch';
import { fetchPackManifest } from '@/content/packSource';
import { packProblems, resetPackHealthForTests } from '@/content/packHealth';
import { writeInstalledPacks } from '@/content/installedPackStore';

const withStorage = () => {
  const map = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

const DEV_URL = 'http://localhost:5174/manifest.json';
const PUBLISHED_URL = 'https://packs.example/riot/manifest.json';

const served = (buildId: string) =>
  vi.mocked(fetchPackManifest).mockResolvedValue({
    id: 'my-pack',
    version: '1.0.0',
    coreRange: '*',
    name: 'My Pack',
    entry: 'pack.js',
    assets: 'assets/',
    buildId,
  } as never);

/**
 * The half of the dev-pack rule the author actually sees.
 *
 * Boot stopped pinning a localhost pack, so a rebuild lands on the next
 * reload — but nothing said the reload was worth doing. This watch is that
 * sentence: it polls the author's own machine and says "your build is ready"
 * once, and never touches anybody else's pack.
 */
describe('startDevPackWatch', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    withStorage();
    resetPackHealthForTests();
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('says so once the host serves a build the page did not load', async () => {
    writeInstalledPacks([
      { manifestUrl: DEV_URL, id: 'my-pack', version: '1.0.0', name: 'My Pack', buildId: 'aaaa' },
    ]);
    served('bbbb');

    stop = startDevPackWatch({ intervalMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(packProblems.value).toEqual([
      { id: 'my-pack', name: 'My Pack', manifestUrl: DEV_URL, kind: 'dev-changed' },
    ]);
  });

  it('stays quiet while the host is serving the build already loaded', async () => {
    writeInstalledPacks([
      { manifestUrl: DEV_URL, id: 'my-pack', version: '1.0.0', name: 'My Pack', buildId: 'aaaa' },
    ]);
    served('aaaa');

    stop = startDevPackWatch({ intervalMs: 2_000 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(packProblems.value).toEqual([]);
    expect(fetchPackManifest).toHaveBeenCalled();
  });

  it('stops polling once it has said it, rather than repeating itself', async () => {
    writeInstalledPacks([
      { manifestUrl: DEV_URL, id: 'my-pack', version: '1.0.0', name: 'My Pack', buildId: 'aaaa' },
    ]);
    served('bbbb');

    stop = startDevPackWatch({ intervalMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    const afterFirst = vi.mocked(fetchPackManifest).mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);

    expect(vi.mocked(fetchPackManifest).mock.calls.length).toBe(afterFirst);
    expect(packProblems.value).toHaveLength(1);
  });

  it('never polls a published pack — that is the update check, not this', async () => {
    writeInstalledPacks([
      { manifestUrl: PUBLISHED_URL, id: 'riot', version: '1.0.0', buildId: 'aaaa' },
    ]);
    served('bbbb');

    stop = startDevPackWatch({ intervalMs: 2_000 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchPackManifest).not.toHaveBeenCalled();
    expect(packProblems.value).toEqual([]);
  });

  it('sets no timer at all when nothing is being developed', async () => {
    writeInstalledPacks([
      { manifestUrl: PUBLISHED_URL, id: 'riot', version: '1.0.0', buildId: 'aaaa' },
    ]);

    stop = startDevPackWatch({ intervalMs: 2_000 });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads the host with the cache bypassed, or it would poll its own answer', async () => {
    writeInstalledPacks([
      { manifestUrl: DEV_URL, id: 'my-pack', version: '1.0.0', name: 'My Pack', buildId: 'aaaa' },
    ]);
    served('aaaa');

    stop = startDevPackWatch({ intervalMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetchPackManifest).toHaveBeenCalledWith(DEV_URL, undefined, { bypassCache: true });
  });

  it('is silent when the dev server is down — that is a rebuild, not a fault', async () => {
    writeInstalledPacks([
      { manifestUrl: DEV_URL, id: 'my-pack', version: '1.0.0', name: 'My Pack', buildId: 'aaaa' },
    ]);
    vi.mocked(fetchPackManifest).mockRejectedValue(new Error('connection refused'));

    stop = startDevPackWatch({ intervalMs: 2_000 });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(packProblems.value).toEqual([]);
    // Still watching: the author is mid-build, and the next poll is the one
    // that catches them coming back.
    expect(vi.mocked(fetchPackManifest).mock.calls.length).toBeGreaterThan(1);
  });
});
