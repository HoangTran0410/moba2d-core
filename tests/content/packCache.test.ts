import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_CACHE_NAME,
  announcePackBases,
  forgetPack,
  packBaseFor,
  packCacheUsage,
  prefetchPackFiles,
} from '@/content/packCache';

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
    expect(postMessage).toHaveBeenCalledWith({ type: 'PACK_BASES', bases: [BASE] });
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
    const sw = readFileSync(join(__dirname, '../../src/sw.ts'), 'utf8');
    // The worker is a separate TypeScript program (`tsconfig.sw.json`) and
    // cannot import from `src/content/`. Two literals, one meaning — a
    // mismatch is a cache the page fills and the worker never reads, which is
    // silent and offline-only.
    expect(sw).toContain(`'${PACK_CACHE_NAME}'`);
  });
});
