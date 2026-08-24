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

  it('does not throw when there is no CacheStorage at all', async () => {
    delete (globalThis as Record<string, unknown>).caches;
    await expect(prefetchPackFiles(BASE, ['pack.js'])).resolves.toMatchObject({ added: 0 });
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
