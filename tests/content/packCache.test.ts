import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_CACHE_NAME,
  announcePackBases,
  forgetPack,
  packBaseFor,
  packCacheUsage,
  prefetchPackFiles,
  missingPackFiles,
  onPackPrefetchProgress,
  packPrefetchProgress,
  pinPackManifest,
  readPinnedManifest,
} from '@/content/packCache';
import { stripComments } from '@/seams/importScan';

/**
 * A `CacheStorage` small enough to assert against. `caches` does not exist in
 * a Node test run, and the parts of it this module uses are four methods.
 *
 * `keys()` yields `{ url }` objects (the real `Cache.keys()` returns
 * `Request`s, and this module only ever reads `.url` off them), but a key
 * handed to `match`/`put`/`delete` can be either that object or a plain
 * string URL — `keyUrl` resolves both the same way so every method agrees on
 * what "the same entry" means.
 */
function fakeCaches() {
  const store = new Map<string, Response>();
  const keyUrl = (key: string | { url: string }): string =>
    typeof key === 'string' ? key : key.url;
  const cache = {
    match: vi.fn(async (key: string | { url: string }) => store.get(keyUrl(key))),
    put: vi.fn(async (key: string | { url: string }, value: Response) => {
      store.set(keyUrl(key), value);
    }),
    delete: vi.fn(async (key: string | { url: string }) => store.delete(keyUrl(key))),
    keys: vi.fn(async () => [...store.keys()].map(url => ({ url }))),
  };
  return { store, cache, open: vi.fn(async () => cache) };
}

const BASE = 'https://packs.example/riot/';

let caches: ReturnType<typeof fakeCaches>;

beforeEach(() => {
  caches = fakeCaches();
  (globalThis as Record<string, unknown>).caches = caches;
  (globalThis as Record<string, unknown>).fetch = vi.fn(
    async () => new Response('x', { status: 200, headers: { 'content-length': '100' } })
  );
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).caches;
  delete (globalThis as Record<string, unknown>).fetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('packBaseFor', () => {
  it("is the manifest's own directory", () => {
    expect(packBaseFor('https://packs.example/riot/manifest.json')).toBe(BASE);
  });

  it('keeps the trailing slash so a prefix test cannot match a sibling', () => {
    // Without it, base `https://h/riot` matches `https://h/riot-evil/x.js`.
    expect(packBaseFor('https://h/riot/manifest.json').endsWith('/')).toBe(true);
  });

  it('answers empty for something that is not a URL, rather than throwing', () => {
    expect(packBaseFor('not a url')).toBe('');
  });
});

describe('prefetchPackFiles', () => {
  it('fetches and stores each file under the base', async () => {
    const report = await prefetchPackFiles(BASE, ['pack.js', 'chunks/a.js']);
    expect(report.added).toBe(2);
    expect(caches.store.has(`${BASE}pack.js`)).toBe(true);
    expect(caches.store.has(`${BASE}chunks/a.js`)).toBe(true);
  });

  it('skips a file the cache already holds', async () => {
    caches.store.set(`${BASE}pack.js`, new Response('cached'));
    const report = await prefetchPackFiles(BASE, ['pack.js', 'chunks/a.js']);
    expect(report.skipped).toBe(1);
    expect(report.added).toBe(1);
  });

  it('counts a dead file instead of rejecting', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const report = await prefetchPackFiles(BASE, ['gone.js']);
    expect(report.failed).toBe(1);
    expect(report.added).toBe(0);
  });

  it('refuses a path that escapes the base', async () => {
    // `new URL('../../evil.js', base)` is a perfectly valid resolve, and a
    // hostile manifest is exactly where it would come from. The whole point
    // of the base is that the worker will later serve anything under it.
    const report = await prefetchPackFiles(BASE, ['../../evil.js']);
    expect(report.failed).toBe(1);
    expect(caches.store.size).toBe(0);
  });

  it('rejects a base with no trailing slash, closing a sibling-directory gap the escape guard alone misses', async () => {
    // Without the slash, `new URL('../riot-evil/x.js', 'https://h/riot')`
    // resolves to `https://h/riot-evil/x.js` — a different directory that
    // still passes `url.startsWith(base)`, because `'https://h/riot'` is a
    // plain string prefix of it. Requiring the slash on `base` is what
    // closes this; without that requirement this call adds one entry
    // instead of failing one.
    const report = await prefetchPackFiles('https://h/riot', ['../riot-evil/x.js']);
    expect(report.failed).toBe(1);
    expect(caches.store.size).toBe(0);
  });

  it('rejects a base whose protocol is not http(s)', async () => {
    const report = await prefetchPackFiles('file:///riot/', ['pack.js']);
    expect(report.failed).toBe(1);
    expect(caches.store.size).toBe(0);
  });

  it('does not throw when files is not actually an array, despite its declared type', async () => {
    // `manifest.files` is mandated optional (`packSource.ts`) and
    // `tsconfig.json`'s `strict: false` lets `undefined` reach a parameter
    // typed `readonly string[]` without a compile error — Task 4's own call
    // site passes `manifest.files` straight through. `files.length` on that
    // throws synchronously, before the first `await`, which on the boot
    // path this runs behind (`void this.boot()`) is an unhandled rejection,
    // not a caught error.
    const report = await prefetchPackFiles(BASE, undefined as unknown as readonly string[]);
    expect(report.requested).toBe(0);
    expect(report.added).toBe(0);
    expect(report.failed).toBe(0);
  });

  it('drains a longer list across every worker, not just the first PREFETCH_CONCURRENCY', async () => {
    // Every case above uses two files against `PREFETCH_CONCURRENCY = 4`, so
    // no worker's loop ever claims a second index. Ten files is the smallest
    // case where the handoff — a worker finishing one file and going back
    // for the next unclaimed index — actually runs.
    const files = Array.from({ length: 10 }, (_, i) => `chunk-${i}.js`);
    const report = await prefetchPackFiles(BASE, files);
    expect(report.added).toBe(10);
    const fetchMock = (globalThis as Record<string, unknown>).fetch as ReturnType<typeof vi.fn>;
    const calledUrls = fetchMock.mock.calls.map(call => call[0] as string);
    expect(new Set(calledUrls).size).toBe(10);
    for (const file of files) {
      expect(calledUrls).toContain(`${BASE}${file}`);
    }
  });

  it('keeps requested equal to added + skipped + failed on a mixed outcome', async () => {
    caches.store.set(`${BASE}already.js`, new Response('cached'));
    (globalThis as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
      if (url.endsWith('gone.js')) throw new TypeError('Failed to fetch');
      return new Response('x', { status: 200, headers: { 'content-length': '100' } });
    });
    const report = await prefetchPackFiles(BASE, ['already.js', 'gone.js', 'new.js']);
    expect(report.requested).toBe(3);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.added).toBe(1);
    // The invariant `packCacheUsage.test.ts:105` used to check nothing
    // about: a caller that only reads `added` cannot tell "0 added because
    // nothing was requested" from "0 added because 590 files silently went
    // nowhere".
    expect(report.added + report.skipped + report.failed).toBe(report.requested);
  });

  it('does not throw when there is no CacheStorage at all', async () => {
    delete (globalThis as Record<string, unknown>).caches;
    const report = await prefetchPackFiles(BASE, ['pack.js']);
    expect(report.added).toBe(0);
    expect(report.added + report.skipped + report.failed).toBe(report.requested);
  });
});

describe('packCacheUsage', () => {
  it('counts only entries under the base', async () => {
    caches.store.set(`${BASE}pack.js`, new Response('x', { headers: { 'content-length': '100' } }));
    caches.store.set('https://other.example/x.js', new Response('y'));
    const usage = await packCacheUsage(BASE);
    expect(usage.entries).toBe(1);
    expect(usage.bytes).toBe(100);
  });
});

describe('forgetPack', () => {
  it('deletes every entry under the base and nothing else', async () => {
    caches.store.set(`${BASE}pack.js`, new Response('x'));
    caches.store.set(`${BASE}chunks/a.js`, new Response('x'));
    caches.store.set('https://other.example/x.js', new Response('y'));
    const removed = await forgetPack(BASE);
    expect(removed).toBe(2);
    expect(caches.store.has('https://other.example/x.js')).toBe(true);
  });
});

describe('announcePackBases', () => {
  it('posts to the controlling worker', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: { postMessage }, ready: Promise.resolve({ active: null }) },
    });
    announcePackBases([BASE]);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'PACK_BASES',
      bases: [BASE],
      manifests: [],
    });
  });

  /**
   * The exclusion travels with the bases, not as a second message. They are
   * one rule (`seams/packRoute.ts`), and a worker holding half of it answers
   * every manifest from cache — which is the frozen-pack bug the exclusion
   * exists to end.
   */
  it('carries the manifest exclusions in the same message', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: { postMessage }, ready: Promise.resolve({ active: null }) },
    });
    announcePackBases([BASE], [`${BASE}manifest.json`]);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'PACK_BASES',
      bases: [BASE],
      manifests: [`${BASE}manifest.json`],
    });
  });

  it('is a no-op with no service worker, rather than a throw on the boot path', () => {
    expect(() => announcePackBases([BASE])).not.toThrow();
  });

  it('does not throw when bases is not actually iterable, despite its declared type', () => {
    // Mirrors `prefetchPackFiles`'s own guard: `[...bases]` throws
    // synchronously on a non-iterable, and this function is fire-and-forget
    // from the boot path, so that throw would surface as a page-breaking
    // exception rather than a caught error.
    expect(() => announcePackBases(undefined as unknown as readonly string[])).not.toThrow();
  });
});

describe('the cache name', () => {
  it('matches the literal the worker uses', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // Comments stripped before matching — see `@/seams/importScan` — so a
    // doc comment that happens to quote the literal (this file's own header
    // does, for instance) cannot pass this in place of the real declaration.
    const sw = stripComments(readFileSync(join(__dirname, '../../src/sw.ts'), 'utf8'));
    // The worker is a separate TypeScript program (`tsconfig.sw.json`) and
    // cannot import from `src/content/`. Two literals, one meaning — a
    // mismatch is a cache the page fills and the worker never reads, which is
    // silent and offline-only.
    expect(sw).toContain(`'${PACK_CACHE_NAME}'`);
  });
});

/**
 * Boot must not ask the network what a pack is.
 *
 * It used to: `runtimePacks.ts` called `fetchPackManifest` on every launch and
 * let the worker's `CacheFirst` route decide where the answer came from. That
 * is how the manifest ended up frozen — the strategy was making a decision
 * nobody had stated. The manifest is out of that route now, so the two reads
 * become explicit: this pair is the pinned one, and the update check fetches.
 */
describe('the pinned manifest', () => {
  const MANIFEST_URL = `${BASE}manifest.json`;

  it('reads back exactly what was pinned', async () => {
    await pinPackManifest(MANIFEST_URL, '{"id":"riot","buildId":"abc"}');
    expect(await readPinnedManifest(MANIFEST_URL)).toBe('{"id":"riot","buildId":"abc"}');
  });

  it('answers null for a pack that was never pinned', async () => {
    expect(await readPinnedManifest(MANIFEST_URL)).toBeNull();
  });

  it('replaces the pin rather than accumulating copies', async () => {
    await pinPackManifest(MANIFEST_URL, '{"buildId":"one"}');
    await pinPackManifest(MANIFEST_URL, '{"buildId":"two"}');
    expect(await readPinnedManifest(MANIFEST_URL)).toBe('{"buildId":"two"}');
    expect(caches.store.size).toBe(1);
  });

  it('survives a browser with no CacheStorage, rather than throwing on boot', async () => {
    delete (globalThis as Record<string, unknown>).caches;
    await expect(pinPackManifest(MANIFEST_URL, '{}')).resolves.toBe(false);
    await expect(readPinnedManifest(MANIFEST_URL)).resolves.toBeNull();
  });

  /** `forgetPack` empties by base prefix, and the pin lives under that base. */
  it('goes when the pack is removed', async () => {
    await pinPackManifest(MANIFEST_URL, '{}');
    await forgetPack(BASE);
    expect(await readPinnedManifest(MANIFEST_URL)).toBeNull();
  });
});

/**
 * What is still missing from a pinned install, so the next boot can finish
 * what the first one started.
 *
 * Derived from the cache rather than stored in `localStorage`: the store's own
 * contract is "a few hundred bytes", and 592 file names is not that. One
 * `keys()` walk answers it exactly, and it cannot drift from the truth the way
 * a stored list would.
 */
describe('missingPackFiles', () => {
  it('names the files that are not in the cache', async () => {
    await (await caches.open()).put(`${BASE}a.js`, new Response('x'));
    expect(await missingPackFiles(BASE, ['a.js', 'b.js', 'c.js'])).toEqual(['b.js', 'c.js']);
  });

  it('is empty for a complete install', async () => {
    await (await caches.open()).put(`${BASE}a.js`, new Response('x'));
    expect(await missingPackFiles(BASE, ['a.js'])).toEqual([]);
  });

  it('treats a file that escapes the base as missing, never as cached', async () => {
    // Same guard the prefetch applies on the way in: a manifest is a
    // stranger's file, and `../` is an ordinary resolve.
    expect(await missingPackFiles(BASE, ['../elsewhere.js'])).toEqual(['../elsewhere.js']);
  });

  it('reports everything missing when there is no CacheStorage at all', async () => {
    delete (globalThis as Record<string, unknown>).caches;
    expect(await missingPackFiles(BASE, ['a.js'])).toEqual(['a.js']);
  });
});

/**
 * A 404 and a dropped connection are not the same news.
 *
 * A dropped connection means "try later". A 404 on a file this pack's own
 * manifest listed means the build being installed no longer exists on the
 * server — the deploy keeps exactly one build — so this snapshot can never be
 * completed and the only way forward is a newer manifest. That is evidence,
 * not a guess, and it is the strongest stale signal available.
 */
describe('prefetch tells a 404 from a network failure', () => {
  it('counts a 404 as gone', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(
      async () => new Response('', { status: 404 })
    );
    const report = await prefetchPackFiles(BASE, ['a.js']);
    expect(report.gone).toBe(1);
    expect(report.failed).toBe(1);
  });

  it('does not count a refused connection as gone', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const report = await prefetchPackFiles(BASE, ['a.js']);
    expect(report.gone).toBe(0);
    expect(report.failed).toBe(1);
  });

  it('does not count a 500 as gone either', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(
      async () => new Response('', { status: 500 })
    );
    const report = await prefetchPackFiles(BASE, ['a.js']);
    expect(report.gone).toBe(0);
    expect(report.failed).toBe(1);
  });
});

/**
 * A download nobody can see is the bug this covers.
 *
 * `prefetchPackFiles` used to report only at the end, as a `PrefetchReport` —
 * so a screen drawn while 4.7MB was still arriving had no way to say so, and
 * the packs screen showed whatever happened to be in the cache at the instant
 * it measured, with no denominator. The live record is the fix, and these
 * tests pin the two facts a UI actually reads off it: `active` is true only
 * while files are still settling, and `done` never stops short of `total`.
 *
 * Each case uses a base of its own — the registry is module state on purpose
 * (see `packCache.ts`), so it deliberately outlives one call.
 */
describe('prefetch progress', () => {
  it('has nothing to say about a base no prefetch ever touched', () => {
    expect(packPrefetchProgress('https://packs.example/never/')).toBeNull();
  });

  it('reports the run as active with a rising count, then finished', async () => {
    const base = 'https://packs.example/rising/';
    const seen: { done: number; total: number; active: boolean }[] = [];
    const stop = onPackPrefetchProgress(() => {
      const now = packPrefetchProgress(base);
      if (now) seen.push({ done: now.done, total: now.total, active: now.active });
    });

    await prefetchPackFiles(base, ['a.js', 'b.js', 'c.js']);
    stop();

    const midRun = seen.find(entry => entry.active && entry.done > 0 && entry.done < entry.total);
    expect(midRun, 'no listener call ever saw a run in progress').toBeTruthy();

    const finished = packPrefetchProgress(base);
    expect(finished?.total).toBe(3);
    expect(finished?.done).toBe(3);
    expect(finished?.active).toBe(false);
  });

  it('finishes the record even when every file fails', async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const base = 'https://packs.example/dead/';
    await prefetchPackFiles(base, ['a.js', 'b.js']);
    const finished = packPrefetchProgress(base);
    // The count is "files settled", not "files saved" — a stalled bar that
    // never reaches its end is the same illegible state, one screen down.
    expect(finished).toEqual({ base, total: 2, done: 2, active: false });
  });

  it('finishes the record when there is no CacheStorage to write to', async () => {
    delete (globalThis as Record<string, unknown>).caches;
    const base = 'https://packs.example/nocache/';
    await prefetchPackFiles(base, ['a.js']);
    expect(packPrefetchProgress(base)?.active).toBe(false);
  });

  it('unsubscribing actually stops the calls', async () => {
    let calls = 0;
    const stop = onPackPrefetchProgress(() => {
      calls++;
    });
    stop();
    await prefetchPackFiles('https://packs.example/quiet/', ['a.js']);
    expect(calls).toBe(0);
  });

  it('forgetting a pack forgets its progress too', async () => {
    const base = 'https://packs.example/removed/';
    await prefetchPackFiles(base, ['a.js']);
    expect(packPrefetchProgress(base)).not.toBeNull();
    await forgetPack(base);
    expect(packPrefetchProgress(base)).toBeNull();
  });
});
