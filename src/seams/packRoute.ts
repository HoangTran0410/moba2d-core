/**
 * Which requests belong to an installed pack. **Imported by both the page and
 * the service worker**, which is the only reason it is worth its own file.
 *
 * The rule used to live twice — `packCache.ts` checked a base on the way out,
 * `sw.ts` checked it again on the way in — each with its own copy and a
 * comment explaining that neither could import the other's. That was true of
 * `src/content/`: the worker is a separate TypeScript program
 * (`tsconfig.sw.json`) built against `lib: WebWorker`, where `self` is a
 * `ServiceWorkerGlobalScope`, and the root program's DOM lib is mutually
 * exclusive with it. It was never true of a module that touches neither lib.
 * This one uses `URL` and nothing else, so it sits in both `include` lists and
 * there is one copy of the rule again.
 *
 * ## The manifest is not a pack file
 *
 * The second half of the rule, and the reason the duplication stopped being
 * survivable. The route is `CacheFirst`, and the manifest sits under the
 * pack's own base, so the first fetch populated the cache and every later one
 * was answered from it — for ever. A pack that had been installed once could
 * never see a newer build of itself, and any file the background prefetch
 * happened to miss stayed missing, 404ing against a deploy that keeps exactly
 * one build. The update path did not fail; it did not exist.
 *
 * So the manifest is excluded here, by exact origin+pathname, and the two
 * reads of it are made explicit at their call sites instead: boot reads the
 * pinned copy straight out of `CacheStorage`, and the update check fetches
 * from the network. Neither leaves the choice to a routing strategy.
 */

/**
 * A base worth trusting: an absolute http(s) URL ending in `/`.
 *
 * The slash is load-bearing, because the claim below is a prefix test. Without
 * it a base of `https://h/riot` also claims `https://h/riot-evil/anything` —
 * a pack cache filled from one host and served to a sibling path.
 */
export function isValidPackBase(base: string): boolean {
  if (!base.endsWith('/')) return false;
  try {
    const url = new URL(base);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Whether the worker should answer `url` out of the pack cache.
 *
 * `manifests` are compared on origin + pathname, not on the whole href: the
 * update check fetches the manifest with a cache-busting query, and a query
 * that dodged this exclusion would let the check populate the cache with the
 * very answer it exists to bypass.
 */
export function isPackRequest(
  url: string,
  bases: readonly string[],
  manifests: readonly string[]
): boolean {
  let claimed = false;
  for (const base of bases) {
    if (url.startsWith(base)) {
      claimed = true;
      break;
    }
  }
  if (!claimed) return false;

  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.origin + parsed.pathname;
  } catch {
    return false;
  }
  for (const manifest of manifests) {
    try {
      const parsed = new URL(manifest);
      if (parsed.origin + parsed.pathname === path) return false;
    } catch {
      // A manifest URL that will not parse cannot match anything. It reached
      // the worker over `postMessage` from a hand-editable stored list, so
      // skipping it is the only sane reading — refusing the whole request
      // would turn one bad stored entry into a pack that never caches.
    }
  }
  return true;
}
