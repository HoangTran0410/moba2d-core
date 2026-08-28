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
 * matching every cross-origin request. It is broader than anything anyone
 * intended, and it identifies the wrong thing — a player may install a pack
 * from anywhere, including a host that also serves something this worker has
 * no business caching. The match is on **base-URL prefix**, which is a rule
 * about the pack rather than about where it happens to live.
 *
 * That distinction used to be even sharper: core and the default pack were
 * served from the *same* origin (`hoangtran99.is-a.dev/moba2d-core/` and
 * `/moba2d-content-riot/`), so "cross-origin" matched neither of them. The
 * pack has since moved to `moba2d-packs.github.io`, which makes it genuinely
 * cross-origin — and changes nothing here, because the rule never depended on
 * the answer.
 *
 * Nothing in this module throws. It is reached from `LoadingScene.boot()`,
 * where a rejection is an unhandled one and the menu never opens, and from a
 * UI that must survive a browser with `CacheStorage` disabled. Every failure
 * is counted and returned.
 */

import { isValidPackBase } from '@/seams/packRoute';

/**
 * Where a pack's bytes live. Versioned in the name so a future change of
 * layout can be a new cache rather than a migration.
 *
 * **Also a literal in `src/sw.ts`.** The worker is a separate TypeScript
 * program (`tsconfig.sw.json`, WebWorker lib) and cannot import from here;
 * `tests/content/packCache.test.ts` asserts the two agree.
 */
export const PACK_CACHE_NAME = 'moba2d-packs-v1';

/** How many files are fetched at once. */
export const PREFETCH_CONCURRENCY = 4;

/** What one prefetch did. Every field is a count, so a caller can report it. */
export interface PrefetchReport {
  base: string;
  requested: number;
  added: number;
  skipped: number;
  failed: number;
  /**
   * How many of `failed` answered **404**, rather than failing to answer.
   *
   * The distinction is the whole stale-detection story. A refused connection
   * or a 500 means "try later". A 404 on a path this pack's own manifest
   * listed means the build being installed is no longer on the server — a
   * deploy keeps exactly one build — so this snapshot can never be completed
   * and no amount of retrying will change that. It is the one signal that is
   * evidence rather than inference, and it is what turns "the pack might be
   * out of date" into "the pack is out of date, here is the proof".
   */
  gone: number;
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
 * Tells the service worker which URLs belong to packs, and which one of them
 * it must never answer from cache.
 *
 * Fire-and-forget by design — there is nothing to await and nothing a caller
 * could do about a failure. A page with no worker (dev, or a browser without
 * one) simply has no offline story, which is the same as today.
 */
export function announcePackBases(
  bases: readonly string[],
  manifests: readonly string[] = []
): void {
  try {
    // `[...bases]` is inside the `try` on purpose: `tsconfig.json`'s
    // `strict: false` lets a caller pass `undefined` here and still compile
    // (Task 4's caller does exactly this for a manifest with no `files`),
    // and spreading a non-iterable throws synchronously, before the
    // `navigator` guard below ever runs.
    const message = {
      type: 'PACK_BASES',
      bases: [...bases],
      // The URLs the worker must **not** answer from cache. Sent with the
      // bases rather than as a second message: the two are one rule
      // (`seams/packRoute.ts`), and a worker that received half of it would
      // freeze every manifest until the other half arrived.
      manifests: [...manifests],
    };
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
    // No `navigator`, no worker, a blocked API, or `bases` was not iterable.
    // Costs offline, nothing else.
  }
}

/**
 * How far one pack's prefetch has got — the only thing in the app that can
 * say "a download is running right now".
 *
 * `done` counts files **settled**, not files saved: added, already present,
 * and failed all advance it. A bar that stops two files short of its end
 * because a host 404'd twice is the same illegible state one screen down from
 * the one this record exists to fix, and `PrefetchReport` already carries the
 * breakdown for anyone who needs it.
 */
export interface PackPrefetchProgress {
  base: string;
  /** How many files this run was asked for — the denominator. */
  total: number;
  /** How many of them have settled, whatever the outcome. */
  done: number;
  /** Whether files are still settling. False the moment the run returns. */
  active: boolean;
}

/**
 * **Why an observable record and not a poll.**
 *
 * A prefetch started on one screen has to be legible from another, and the
 * two candidates were: poll `packCacheUsage`/`missingPackFiles` on a timer
 * while a pack looks incomplete, or have the prefetch itself say what it is
 * doing. This is the second.
 *
 * The poll loses twice. It is expensive in exactly the window where it runs —
 * `packCacheUsage` walks the *whole* shared pack cache and reads a header off
 * every entry, per pack, several times a second, competing with the download
 * for the same `CacheStorage` — and it can only ever *infer* the answer: a
 * number that moved means "downloading", a number that did not means either
 * "finished", "stalled" or "the poll landed between two files", and nothing
 * can tell those apart without a timeout that is wrong on some connection.
 *
 * The stated objection to a record is the reload, and it answers itself. The
 * prefetch lives in the page's JS heap; so does this map. A reload destroys
 * both together, so there is no state where bytes are arriving and nothing
 * knows it — and the boot path restarts the prefetch for every installed pack
 * (`runtimePacks.ts`), which rebuilds the record. What genuinely cannot
 * survive a reload is the *denominator* for a pack whose prefetch is not
 * running at all, and that is persisted separately, as
 * `InstalledPackRecord.fileCount`.
 *
 * Module state, deliberately outliving any one call: the screen that reads it
 * is mounted long after the boot that wrote it.
 */
const prefetchProgress = new Map<string, PackPrefetchProgress>();
const progressListeners = new Set<() => void>();

/** What `base`'s prefetch is doing, or `null` if none has ever run this session. */
export function packPrefetchProgress(base: string): PackPrefetchProgress | null {
  const found = prefetchProgress.get(base);
  // A copy, not the live object: a Vue component holding the record itself
  // would be handed mutations it can never see, since nothing here is
  // reactive.
  return found ? { ...found } : null;
}

/**
 * Calls `listener` whenever any pack's progress moves. Returns the unsubscribe.
 *
 * No argument: a listener that wants numbers asks `packPrefetchProgress` for
 * the base it cares about. Four concurrent workers over 592 files is ~600
 * calls spread across the whole download, and the one listener there is
 * writes a ref that Vue coalesces into one render per tick anyway.
 */
export function onPackPrefetchProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** Never lets a listener's throw reach the prefetch — this module does not throw. */
function announceProgress(): void {
  for (const listener of progressListeners) {
    try {
      listener();
    } catch {
      // A broken subscriber costs its own update, not the download.
    }
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
  // `tsconfig.json`'s `strict: false` lets `manifest.files` reach here as
  // `undefined` even though its declared type is `readonly string[]` —
  // `manifest.files` is mandated optional (`packSource.ts`), and a caller
  // passing it straight through compiles clean. `files.length` on that would
  // throw before the first `await`, i.e. reject a promise on the boot path
  // this module's own header promises never throws.
  const list = Array.isArray(files) ? files : [];
  const report: PrefetchReport = {
    base,
    requested: list.length,
    added: 0,
    skipped: 0,
    failed: 0,
    gone: 0,
  };
  // Opened before the first `await`, so a screen that mounts one tick later
  // already sees a run in progress rather than "measuring". A second run for
  // the same base replaces the first's record rather than merging with it:
  // the boot path starts one run per pack and `installPackNow` starts one
  // more only for a pack that was not installed, so two live runs over one
  // base is not a state either caller can produce.
  const live: PackPrefetchProgress = { base, total: list.length, done: 0, active: true };
  prefetchProgress.set(base, live);
  announceProgress();
  const settled = (): void => {
    live.done++;
    announceProgress();
  };
  const finish = (): PrefetchReport => {
    live.done = live.total;
    live.active = false;
    announceProgress();
    return report;
  };

  const cache = await openPackCache();
  if (!cache || !isValidPackBase(base)) {
    report.failed = list.length;
    return finish();
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= list.length) return;
      const relative = list[index];

      // `try`/`finally` around the whole body rather than a `settled()` beside
      // each of the six ways one file can end: `continue` runs the `finally`,
      // so the count cannot drift by someone adding a seventh exit later.
      try {
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
          // `response.type === 'opaque'` cannot actually happen on this path:
          // the fetch above is default `mode: 'cors'`, so a host with no
          // `access-control-allow-origin` fails the fetch itself rather than
          // answering with an opaque response, and an opaque response's own
          // `status` is 0, which already makes `ok` false — so `!response.ok`
          // alone already covers it. Kept as a second, free guard in case this
          // fetch ever gains `mode: 'no-cors'`, not because it fires today.
          if (!response.ok || response.type === 'opaque') {
            report.failed++;
            // Only a 404. A 500 is a host having a bad day and a 0 is an opaque
            // response, and reading either as "this build is gone" would send a
            // player to a re-install that fixes nothing.
            if (response.status === 404) report.gone++;
            continue;
          }
          await cache.put(url, response);
          report.added++;
        } catch {
          report.failed++;
        }
      } finally {
        settled();
      }
    }
  };

  // `allSettled`, not `all`: nothing in `worker` currently throws outside its
  // own two `try` blocks, but `all` rejecting the moment any one of the four
  // workers does would make that an implicit, unenforced part of the "never
  // throws" contract this module's header promises. `allSettled` makes the
  // contract hold structurally instead of by the loop body happening not to
  // have a gap today.
  await Promise.allSettled(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
  return finish();
}

/**
 * How much of the cache one pack occupies — the "dung lượng" column of spec
 * §7's list.
 *
 * Read off `content-length` rather than by reading each body: 590 entries
 * decoded to blobs is real work for a number rendered in megabytes. A host
 * that omits the header contributes 0, so this is a floor, not an exact
 * size. **The screen only marks it approximate** (`PacksScene.vue`'s `~`
 * prefix on the megabyte figure, from its own `formatApproxMB` — see that
 * function's own comment) rather than explaining why: a `~` in front of a
 * number a player is not trying to audit is the right amount of honesty for
 * a screen whose whole reason to exist is the origin above it, not this
 * figure.
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
  // The bytes and the story about the bytes go together. Removal reloads the
  // page today (`PacksScene.vue`), so this is belt rather than braces — but a
  // record left behind would describe a pack that no longer exists, and the
  // next thing to call this without reloading would inherit that silently.
  if (prefetchProgress.delete(base)) announceProgress();
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

/**
 * Writes a pack's manifest into the pack cache, under its own URL.
 *
 * **This is what makes boot network-free.** The manifest is excluded from the
 * worker's `CacheFirst` route (`seams/packRoute.ts`), so it is no longer
 * cached as a side effect of being fetched — which is the point: the strategy
 * used to decide where the manifest came from, and it decided "cache, for
 * ever". Pinning is now a deliberate act at install time, and reading the pin
 * is a deliberate act at boot.
 *
 * Answers whether it landed. Never throws: this runs on the boot path, where
 * a rejection is an unhandled one and the menu never opens.
 */
export async function pinPackManifest(manifestUrl: string, body: string): Promise<boolean> {
  const cache = await openPackCache();
  if (!cache || !manifestUrl) return false;
  try {
    await cache.put(
      manifestUrl,
      new Response(body, { headers: { 'content-type': 'application/json' } })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The pinned manifest's body, or `null` if this pack has none.
 *
 * `null` is not an error — a pack installed before pinning existed has no pin,
 * and the caller falls back to the network exactly as it always did.
 */
export async function readPinnedManifest(manifestUrl: string): Promise<string | null> {
  const cache = await openPackCache();
  if (!cache || !manifestUrl) return null;
  try {
    const stored = await cache.match(manifestUrl);
    if (!stored) return null;
    return await stored.text();
  } catch {
    return null;
  }
}

/**
 * Which of `files` are not in the cache yet — what a resumed prefetch has left
 * to do.
 *
 * Derived from one `keys()` walk rather than remembered in `localStorage`.
 * That store's own contract is "a few hundred bytes, because `LoadingScene`
 * reads it synchronously", and 592 file names is not that; and a stored list
 * can drift from what the cache actually holds, while this cannot.
 *
 * A path that escapes the base is reported missing rather than skipped. It can
 * never be cached — the prefetch refuses to write it, for the reason
 * `prefetchPackFiles` gives — so calling it present would make an install look
 * complete that never can be.
 */
export async function missingPackFiles(base: string, files: readonly string[]): Promise<string[]> {
  const list = Array.isArray(files) ? files : [];
  const cache = await openPackCache();
  if (!cache || !isValidPackBase(base)) return [...list];

  let held: Set<string>;
  try {
    held = new Set((await cache.keys()).map(request => request.url));
  } catch {
    return [...list];
  }

  // A plain loop, not `.filter`: `Array.prototype.filter` is polyfilled in
  // this project and cannot narrow (CLAUDE.md), and this needs the original
  // relative path in the answer rather than the resolved URL it tests.
  const missing: string[] = [];
  for (const relative of list) {
    let url: string;
    try {
      url = new URL(relative, base).href;
    } catch {
      missing.push(relative);
      continue;
    }
    if (!url.startsWith(base) || !held.has(url)) missing.push(relative);
  }
  return missing;
}
