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
vi.mock('@/content/packCache', () => ({
  // A real implementation, not a bare `vi.fn()`: the base is what the
  // prefetch tests assert on, and hard-coding it a second time in every test
  // would just be `packBaseFor` copied badly.
  packBaseFor: vi.fn((url: string) => {
    try {
      return new URL('./', url).href;
    } catch {
      return '';
    }
  }),
  announcePackBases: vi.fn(),
  prefetchPackFiles: vi.fn(),
}));

import { installRuntimePacks, installPackNow, DEFAULT_PACK_URL } from '@/content/runtimePacks';
import { fetchPackManifest, loadPackFromManifest } from '@/content/packSource';
import { installRuntimePack } from '@/content/install';
import { contentRegistry, rebuildContentRegistry } from '@/content/registry';
import { announcePackBases, prefetchPackFiles, type PrefetchReport } from '@/content/packCache';
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

/**
 * What a prefetch that never touched the cache looks like. The brief names
 * this constant without defining it — it has to match `PrefetchReport`
 * (`packCache.ts`) field for field, since it stands in for a resolved value
 * `prefetchPackFiles` never actually computed in these tests.
 */
const EMPTY_REPORT: PrefetchReport = { base: '', requested: 0, added: 0, skipped: 0, failed: 0 };

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

describe('the offline prefetch', () => {
  // A sibling of `describe('installRuntimePacks', ...)` above, not nested in
  // it — its `beforeEach`/`afterEach` are scoped to that block alone, so the
  // storage and mock setup has to be re-stated here rather than inherited.
  const PACK_URL = 'https://packs.example/riot/manifest.json';
  const PACK_BASE = 'https://packs.example/riot/';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rebuildContentRegistry).mockReturnValue({ hasPack: () => false } as never);
    vi.mocked(prefetchPackFiles).mockResolvedValue(EMPTY_REPORT);
    withStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
    // Minor 6: two tests in this block now write `__lol2dPackPrefetch`
    // (this one and 'publishes what the prefetch actually did...') and one
    // waits on its value with `vi.waitFor` — leaving a previous test's
    // publish in place is an ordering hazard, not hygiene, since a later
    // test's own `vi.waitFor` could observe a stale value and pass for the
    // wrong reason.
    delete (globalThis as Record<string, unknown>).__lol2dPackPrefetch;
  });

  /** One stored pack whose manifest is reachable at `PACK_URL`/`PACK_BASE`. */
  const seedInstalledPack = (files?: string[]) => {
    writeInstalledPacks([{ manifestUrl: PACK_URL, id: 'riot', version: '1.0.0' }]);
    const seeded = { ...manifest, files };
    vi.mocked(fetchPackManifest).mockResolvedValue(seeded);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest: seeded } as never);
  };

  it("announces every installed pack's base to the worker", async () => {
    seedInstalledPack(['pack.js']);

    await installRuntimePacks();

    expect(announcePackBases).toHaveBeenCalledWith([PACK_BASE]);
  });

  it('prefetches the files the manifest listed', async () => {
    seedInstalledPack(['pack.js']);

    await installRuntimePacks();

    expect(prefetchPackFiles).toHaveBeenCalledWith(PACK_BASE, ['pack.js']);
  });

  it('does not prefetch a pack that listed nothing', async () => {
    seedInstalledPack(undefined);

    await installRuntimePacks();

    expect(prefetchPackFiles).not.toHaveBeenCalled();
  });

  it('does not prefetch a pack that failed to install', async () => {
    writeInstalledPacks([{ manifestUrl: PACK_URL, id: 'riot', version: '1.0.0' }]);
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(fetchPackManifest).mockRejectedValue(new PackLoadError('fetch', 'offline'));

    await installRuntimePacks();

    expect(prefetchPackFiles).not.toHaveBeenCalled();
  });

  it("announces a skipped pack's base too — its bytes are still worth caching", async () => {
    // The duplicate-id skip branch is not the install branch, and both
    // report to `installed.push(...)` — this is the other one.
    vi.mocked(rebuildContentRegistry).mockReturnValue({
      hasPack: (id: string) => id === 'riot',
    } as never);
    seedInstalledPack(['pack.js']);

    await installRuntimePacks();

    expect(announcePackBases).toHaveBeenCalledWith([PACK_BASE]);
    expect(prefetchPackFiles).toHaveBeenCalledWith(PACK_BASE, ['pack.js']);
  });

  it('resolves before the prefetch does — the menu does not wait for 4.7MB', async () => {
    // The one that matters. `prefetchPackFiles` is made to hang; the whole
    // point is that `installRuntimePacks()` still resolves.
    seedInstalledPack(['pack.js']);
    let release: () => void = () => {};
    vi.mocked(prefetchPackFiles).mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve(EMPTY_REPORT);
        })
    );

    await expect(installRuntimePacks()).resolves.toBeInstanceOf(Array);

    release();
  });

  it('a prefetch that rejects does not become an unhandled rejection, and its report is synthesized', async () => {
    seedInstalledPack(['pack.js']);
    vi.mocked(prefetchPackFiles).mockRejectedValue(new Error('disk full'));

    await expect(installRuntimePacks()).resolves.toBeInstanceOf(Array);
    // and nothing thrown out of band — the suite fails on one if it happens

    // Beyond "it resolves" (true under the old `Promise.all` too, since
    // nothing here awaits the fire-and-forget chain), this exercises the
    // synthesized-report branch in `runtimePacks.ts` — nothing else in this
    // suite does. `vi.waitFor` because `installRuntimePacks()` resolving
    // does not mean the background `.then` has run yet.
    await vi.waitFor(() => {
      expect((globalThis as Record<string, unknown>).__lol2dPackPrefetch).toEqual([
        { base: PACK_BASE, requested: 1, added: 0, skipped: 0, failed: 1 },
      ]);
    });
  });

  it('publishes what the prefetch actually did, once every pack has settled', async () => {
    // The deliverable itself: everything above this test only checks that
    // `prefetchPackFiles`/`announcePackBases` were *called* right, never
    // that the background chain's own write lands with the right shape.
    // `installRuntimePacks()` resolving does not mean the fire-and-forget
    // `.then` has run yet — `vi.waitFor` is what waits for that without a
    // sleep.
    seedInstalledPack(['pack.js']);
    const report: PrefetchReport = {
      base: PACK_BASE,
      requested: 1,
      added: 1,
      skipped: 0,
      failed: 0,
    };
    vi.mocked(prefetchPackFiles).mockResolvedValue(report);

    await installRuntimePacks();

    await vi.waitFor(() => {
      expect((globalThis as Record<string, unknown>).__lol2dPackPrefetch).toEqual([report]);
    });
  });

  it('still announces (an empty list) when the only pack cannot resolve to a base, but never prefetches it', async () => {
    // `packBaseFor` answers `''` for a stored `manifestUrl` that is relative
    // or malformed rather than throwing (see `packCache.ts`); both branches
    // guard on that before pushing anything, and this is what exercises the
    // guard instead of leaving it implied by the mock never returning ''.
    //
    // The announce itself is unconditional (Minor 7: dropping every pack
    // must clear the worker's memory too, and an unreachable base is the
    // same "nothing to serve" fact from the worker's point of view), so this
    // is `toHaveBeenCalledWith([])`, not `not.toHaveBeenCalled()`.
    writeInstalledPacks([{ manifestUrl: 'not-a-real-url', id: 'riot', version: '1.0.0' }]);
    const seeded = { ...manifest, files: ['pack.js'] };
    vi.mocked(fetchPackManifest).mockResolvedValue(seeded);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest: seeded } as never);

    await expect(installRuntimePacks()).resolves.toBeInstanceOf(Array);

    expect(announcePackBases).toHaveBeenCalledWith([]);
    expect(prefetchPackFiles).not.toHaveBeenCalled();
  });

  it('announces an empty list when nothing is installed at all, so a fresh removal reload clears the worker', async () => {
    // The exact case Minor 7 names: a player removes their only pack, which
    // writes an empty stored list and reloads. `installRuntimePacks()` on
    // that reload has nothing to seed (the flag is already set) and nothing
    // to install — `bases` never leaves its initial `[]` — and the worker
    // must still hear about it, or `packBases` in `src/sw.ts` holds the
    // removed pack's base forever.
    markDefaultPackSeeded();

    await installRuntimePacks();

    expect(announcePackBases).toHaveBeenCalledWith([]);
  });
});

describe('installPackNow', () => {
  // A sibling of the two `describe` blocks above, not nested — same reason
  // `describe('the offline prefetch', ...)` isn't nested either: its own
  // `beforeEach`/`afterEach` scope the storage and mock resets to this block
  // alone.
  const packUrl = 'https://packs.example/riot/manifest.json';
  const packBase = 'https://packs.example/riot/';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(contentRegistry).mockReturnValue({ hasPack: () => false } as never);
    withStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('installs into the existing (live) registry, not a rebuilt one', async () => {
    const registry = { hasPack: () => false };
    vi.mocked(contentRegistry).mockReturnValue(registry as never);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    const outcome = await installPackNow(packUrl, manifest);

    expect(outcome).toEqual({ manifestUrl: packUrl, ok: true, id: 'riot' });
    expect(installRuntimePack).toHaveBeenCalledWith(registry, expect.anything(), { manifest });
    // The whole reason `installPackNow` exists rather than reusing
    // `installRuntimePacks`'s own path: a rebuild would discard and
    // reinstall core, the reference pack and every already-installed
    // runtime pack for no gain — see `runtimePacks.ts`'s own doc comment.
    expect(rebuildContentRegistry).not.toHaveBeenCalled();
  });

  it('skips a pack whose id is already installed, without fetching its entry', async () => {
    vi.mocked(contentRegistry).mockReturnValue({ hasPack: (id: string) => id === 'riot' } as never);

    const outcome = await installPackNow(packUrl, manifest);

    expect(outcome).toEqual({ manifestUrl: packUrl, ok: true, id: 'riot', skipped: true });
    expect(loadPackFromManifest).not.toHaveBeenCalled();
    expect(installRuntimePack).not.toHaveBeenCalled();
  });

  it('appends to the store without duplicating an existing URL', async () => {
    writeInstalledPacks([
      { manifestUrl: 'https://other/manifest.json', id: 'other', version: '1.0.0' },
      { manifestUrl: packUrl, id: 'riot', version: '0.9.0' },
    ]);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    await installPackNow(packUrl, { ...manifest, version: '2.0.0' });

    expect(readInstalledPacks()).toEqual([
      { manifestUrl: 'https://other/manifest.json', id: 'other', version: '1.0.0' },
      { manifestUrl: packUrl, id: 'riot', version: '2.0.0' },
    ]);
  });

  it('announces every installed base, not only the one just installed', async () => {
    writeInstalledPacks([{ manifestUrl: 'https://a/manifest.json', id: 'a', version: '1.0.0' }]);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    await installPackNow(packUrl, manifest);

    expect(announcePackBases).toHaveBeenCalledWith(['https://a/', packBase]);
  });

  it('comes back ok: false with the stage, instead of throwing, when loadPackFromManifest rejects', async () => {
    const { PackLoadError } = await import('@/content/packSource');
    vi.mocked(loadPackFromManifest).mockRejectedValue(new PackLoadError('import', 'boom'));

    await expect(installPackNow(packUrl, manifest)).resolves.toEqual({
      manifestUrl: packUrl,
      ok: false,
      stage: 'import',
      message: 'boom',
    });
    expect(installRuntimePack).not.toHaveBeenCalled();
    expect(readInstalledPacks()).toEqual([]);
    // Important 2's failure-path guard: a fetch that never landed must not
    // spend the automatic offer either — same reasoning `installRuntimePacks`
    // already applies to its own seeding attempt.
    expect(hasSeededDefaultPack()).toBe(false);
  });

  it('spends the default-seed offer on a successful, non-skipped install', async () => {
    // Important 2: `markDefaultPackSeeded()` used to be written from exactly
    // one place, `installRuntimePacks`'s own seeding run. A browser whose
    // first boot could not reach `DEFAULT_PACK_URL` (flag stays `false` —
    // see this file's own header) could install a pack by hand through this
    // function, remove it later, and have the very next boot re-seed a
    // default it never asked for — `installRuntimePacks()` cannot tell that
    // apart from a browser that has never run the game at all.
    expect(hasSeededDefaultPack()).toBe(false);
    vi.mocked(loadPackFromManifest).mockResolvedValue({ manifest } as never);

    await installPackNow(packUrl, manifest);

    expect(hasSeededDefaultPack()).toBe(true);
  });

  it('does not spend the offer on a skipped install — nothing changed for it to settle', async () => {
    vi.mocked(contentRegistry).mockReturnValue({ hasPack: (id: string) => id === 'riot' } as never);

    const outcome = await installPackNow(packUrl, manifest);

    expect(outcome).toMatchObject({ ok: true, skipped: true });
    expect(hasSeededDefaultPack()).toBe(false);
  });
});
