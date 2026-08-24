/**
 * The page's half of the pack cache. The worker's half is `src/sw.ts`.
 *
 * The split is the design: **the page decides what is a pack file, the worker
 * only serves.** The page is the side that knows — it fetched the manifest,
 * resolved the base, and holds the installed list — and the worker is the
 * side that has to answer a request with the network off. Sending the bases
 * one way, in one message, is the whole protocol.
 *
 * The rejected alternative is the one spec §6 names: a `CacheFirst` rule
 * matching every cross-origin request. Beyond being broader than anything
 * anyone intended, it is not even correct here — core and the pack are served
 * from the *same origin* in production
 * (`hoangtran99.is-a.dev/moba2d-core/` and `/moba2d-content-riot/`), so
 * "cross-origin" identifies neither. The match is on base-URL prefix.
 *
 * Nothing in this module throws. It is reached from `LoadingScene.boot()`,
 * where a rejection is an unhandled one and the menu never opens, and from a
 * UI that must survive a browser with `CacheStorage` disabled. Every failure
 * is counted and returned.
 */

/**
 * Where a pack's bytes live. Versioned in the name so a future change of
 * layout can be a new cache rather than a migration.
 *
 * **Also a literal in `src/sw.ts`.** The worker is a separate TypeScript
 * program (`tsconfig.sw.json`, WebWorker lib) and cannot import from here;
 * `tests/content/packCache.test.ts` asserts the two agree.
 */
export const PACK_CACHE_NAME = 'lol2d-packs-v1';

/** How many files are fetched at once. */
export const PREFETCH_CONCURRENCY = 4;

/** What one prefetch did. Every field is a count, so a caller can report it. */
export interface PrefetchReport {
  base: string;
  requested: number;
  added: number;
  skipped: number;
  failed: number;
}

/**
 * A pack's base URL: the directory its manifest sits in, trailing slash kept.
 *
 * The slash is load-bearing. The worker's route is a prefix test, so a base of
 * `https://host/riot` would also claim `https://host/riot-anything/`.
 *
 * Answers `''` for anything that is not an absolute URL, rather than throwing:
 * this is called with whatever was in `localStorage`.
 */
export function packBaseFor(manifestUrl: string): string {
  try {
    return new URL('./', manifestUrl).href;
  } catch {
    return '';
  }
}

/**
 * Tells the service worker which base URLs belong to packs.
 *
 * Fire-and-forget by design — there is nothing to await and nothing a caller
 * could do about a failure. A page with no worker (dev, or a browser without
 * one) simply has no offline story, which is the same as today.
 */
export function announcePackBases(bases: readonly string[]): void {
  const message = { type: 'PACK_BASES', bases: [...bases] };
  try {
    const container = navigator?.serviceWorker;
    if (!container) return;
    if (container.controller) {
      container.controller.postMessage(message);
      return;
    }
    // No controller yet — first load, before the worker has taken over. The
    // registration's active worker still receives messages, and this is the
    // launch where a first install most needs them.
    void container.ready
      .then(registration => registration.active?.postMessage(message))
      .catch(() => {});
  } catch {
    // No `navigator`, no worker, a blocked API. Costs offline, nothing else.
  }
}

/** `caches.open(PACK_CACHE_NAME)`, or null wherever `CacheStorage` is not a thing. */
async function openPackCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(PACK_CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * Pulls every file a pack declared into the cache, in the background.
 *
 * The point is the *unplayed* champion. What a match fetches on its own is the
 * champion the player already picked; the other 237 chunks have never been
 * requested, so they have never been cached, so the first offline match can
 * only field what has already been played. Spec §6 calls that the hole that
 * the 17x saving from code-splitting opens, and this is the price paid behind
 * the player's back rather than in front of them.
 *
 * Deliberately not `cache.addAll`: that is all-or-nothing, and one 404 in 590
 * files would discard the other 589.
 */
export async function prefetchPackFiles(
  base: string,
  files: readonly string[]
): Promise<PrefetchReport> {
  const report: PrefetchReport = {
    base,
    requested: files.length,
    added: 0,
    skipped: 0,
    failed: 0,
  };
  const cache = await openPackCache();
  if (!cache || !base) {
    report.failed = files.length;
    return report;
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= files.length) return;
      const relative = files[index];

      let url: string;
      try {
        url = new URL(relative, base).href;
      } catch {
        report.failed++;
        continue;
      }
      // A manifest is a stranger's file, and `new URL('../../x', base)` is a
      // perfectly ordinary resolve. The base is what the worker will later
      // serve from cache without asking anything else, so nothing outside it
      // is allowed in.
      if (!url.startsWith(base)) {
        report.failed++;
        continue;
      }

      try {
        if (await cache.match(url)) {
          report.skipped++;
          continue;
        }
        const response = await fetch(url, { credentials: 'omit' });
        // An opaque response cannot be `put` (it throws), and would be
        // useless anyway — the pack hosts send `access-control-allow-origin`,
        // so anything opaque here is a misconfigured host worth counting.
        if (!response.ok || response.type === 'opaque') {
          report.failed++;
          continue;
        }
        await cache.put(url, response);
        report.added++;
      } catch {
        report.failed++;
      }
    }
  };

  await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
  return report;
}

/**
 * How much of the cache one pack occupies — the "dung lượng" column of spec
 * §7's list.
 *
 * Read off `content-length` rather than by reading each body: 590 entries
 * decoded to blobs is real work for a number rendered in megabytes. A host
 * that omits the header contributes 0, so this is a floor, and the screen
 * says so.
 */
export async function packCacheUsage(base: string): Promise<{ entries: number; bytes: number }> {
  const cache = await openPackCache();
  if (!cache || !base) return { entries: 0, bytes: 0 };
  let entries = 0;
  let bytes = 0;
  try {
    for (const request of await cache.keys()) {
      if (!request.url.startsWith(base)) continue;
      entries++;
      const response = await cache.match(request);
      const length = Number(response?.headers.get('content-length') ?? 0);
      if (Number.isFinite(length)) bytes += length;
    }
  } catch {
    // A partial count is still worth showing.
  }
  return { entries, bytes };
}

/** Drops every cached byte of one pack. Returns how many entries went. */
export async function forgetPack(base: string): Promise<number> {
  const cache = await openPackCache();
  if (!cache || !base) return 0;
  let removed = 0;
  try {
    for (const request of await cache.keys()) {
      if (!request.url.startsWith(base)) continue;
      if (await cache.delete(request)) removed++;
    }
  } catch {
    // Nothing to do about it; the store is the player's disk.
  }
  return removed;
}
