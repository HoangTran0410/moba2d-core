/// <reference lib="webworker" />
/**
 * The game's service worker, hand-written.
 *
 * It used to be generated: `VitePWA`'s `generateSW` read `workbox: {...}` out
 * of `vite.config.ts` and emitted the whole file. That works exactly as long
 * as every URL worth caching is known when the build runs — and spec §6 is
 * the case where it is not. A content pack lives at whatever URL a player
 * typed, so the rule that caches it cannot be a `urlPattern` literal. The
 * alternative inside `generateSW` is a regex broad enough to swallow every
 * cross-origin request the page ever makes, which is a worse thing to own
 * than this file.
 *
 * Everything below the pack section is a line-for-line reproduction of what
 * `generateSW` emitted, read off the built `dist/sw.js` rather than
 * remembered: the precache, `cleanupOutdatedCaches`, the navigation fallback,
 * the Font Awesome rule, and the SKIP_WAITING listener that
 * `src/pwa/updates.ts` talks to. `tests/pwa/serviceWorkerSource.test.ts` is
 * the cheap guard on that list; `npm run e2e:pwa` is the real one.
 *
 * **Route order is the API.** Workbox's router is first-match-wins, so the
 * precache route must be registered before anything that could also claim a
 * precached URL, and the Font Awesome rule before any broader cross-origin
 * rule. Append new routes at the bottom.
 */
import {
  addPlugins,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { isPackRequest, isValidPackBase } from './seams/packRoute';

/**
 * `declare let`, not `declare const`, and typed as a module-scope shadow of
 * the global: `lib.webworker.d.ts` already declares `self` as
 * `WorkerGlobalScope`, which has no `skipWaiting`. This file is a module (it
 * imports), so the declaration shadows rather than conflicts. `__WB_MANIFEST`
 * is the plugin's injection point — a literal the plugin replaces after the
 * bundle is built, which is why it is a property rather than an import.
 */
declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

/**
 * `registerType: 'prompt'` means a new build installs and then waits. The
 * page decides when it takes over — `src/pwa/updates.ts`'s `applyUpdate()`,
 * offered on the menu, which is the one screen where losing the page costs
 * nothing. This listener is the other half of that conversation.
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/**
 * The message type `src/pwa/updates.ts` listens for. One file, one message.
 *
 * There is no denominator on purpose. Workbox downloads only the precache
 * entries whose revision actually changed, and how many that is is not known
 * to this worker without reading `workbox-precaching`'s private cache-key
 * format or keeping a copy of the previous manifest — a percentage built on
 * the *whole* manifest would read "6%" for a deploy that touches four files.
 * A rising count of files is a number the player can trust, and its only job
 * is to show that a wait which can run to twenty seconds is not a hang.
 */
export interface PrecacheProgressMessage {
  type: 'PRECACHE_PROGRESS';
  downloaded: number;
}

let downloaded = 0;

/**
 * Reports each precached file to every page, controlled or not.
 *
 * `includeUncontrolled` matters: this runs in the *installing* worker, which
 * by definition controls nothing yet — the page that wants the number is the
 * one still being served by the old worker.
 */
addPlugins([
  {
    async cacheDidUpdate() {
      downloaded += 1;
      const message: PrecacheProgressMessage = { type: 'PRECACHE_PROGRESS', downloaded };
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clients) client.postMessage(message);
    },
  },
]);

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/** Any navigation is answered by the precached shell — the app is one page. */
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

/**
 * Font Awesome is the one thing still on a CDN, deliberately: a missing icon
 * is a missing icon, not a blank screen. Cached on first sight so the second
 * launch has it offline. An opaque cross-origin response carries status 0,
 * hence the explicit allowance.
 */
registerRoute(
  /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
  new CacheFirst({
    cacheName: 'cdn-fontawesome',
    plugins: [
      new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 90 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

/* ------------------------------------------------------------------ packs */

/**
 * A content pack's bytes. See `src/content/packCache.ts` for the other half
 * of this — the page fills this cache, and this route is what serves it back
 * with the network off.
 *
 * **The name is a literal here and a constant there**, because this file is
 * its own TypeScript program (`tsconfig.sw.json`) and cannot import from
 * `src/content/`. `tests/content/packCache.test.ts` asserts the two agree.
 */
const PACK_CACHE_NAME = 'lol2d-packs-v1';

/**
 * The base URLs the page has told us belong to packs, and where that list is
 * kept so a restarted worker still knows.
 *
 * A prefix test, not an origin test: in production core and the pack are
 * served from the *same* origin under different paths, so an origin test
 * would claim core's own un-precached requests. And spec §6 rules out the
 * broad shape outright.
 */
const PACK_BASES_KEY = new URL('__lol2d_pack_bases__', self.registration.scope).href;
const packBases: string[] = [];

function rememberBases(bases: unknown): void {
  packBases.length = 0;
  if (!Array.isArray(bases)) return;
  for (const base of bases) {
    if (typeof base === 'string' && isValidPackBase(base)) packBases.push(base);
  }
}

/**
 * The manifest URLs the route must *not* claim — see `seams/packRoute.ts`.
 *
 * Kept beside the bases and persisted with them, because the exclusion is
 * useless if a restarted worker remembers the bases and forgets it: the very
 * next manifest fetch would be answered from cache and the pack would be
 * frozen again, silently, until the next time the worker happened to be told.
 */
const packManifests: string[] = [];

function rememberManifests(manifests: unknown): void {
  packManifests.length = 0;
  if (!Array.isArray(manifests)) return;
  for (const manifest of manifests) {
    if (typeof manifest === 'string' && manifest.length > 0) packManifests.push(manifest);
  }
}

/**
 * Reads the stored list at module scope, so a worker the browser restarted —
 * which does not re-run `activate` — still matches pack requests.
 *
 * There are two races here and only one of them is benign.
 *
 * **Benign: a fetch that arrives before this resolves.** It simply does not
 * match the pack route yet, so it goes to the network — exactly the
 * behaviour before this feature existed. In practice the first event a
 * restarted worker sees is a navigation, and a pack chunk is asked for
 * seconds later, well after `caches.open`/`cache.match` have had time to
 * settle.
 *
 * **Not benign: a `PACK_BASES` message arriving before this resolves.** This
 * is what `controller.postMessage` does when a player installs a pack from
 * the packs screen and the worker has gone idle — the message is what
 * cold-starts it, so the `message` handler can run a full turn before this
 * IIFE has even reached its first `await caches.open`. Without the `announced`
 * guard below, the load would call `rememberBases(stored)` *after* the
 * handler's `rememberBases(data.bases)`, overwriting the just-announced,
 * correct list with the stale persisted one — both in the in-memory
 * `packBases` the route below reads, and, because the handler's own
 * `JSON.stringify(packBases)` used to be evaluated after its own `await
 * caches.open` resolved, potentially in what gets persisted too. `announced`
 * is set synchronously by the handler, before its own first `await`, so this
 * load's `if (!announced)` check — reached only after two of its own `await`s
 * — always sees it in time.
 */
let announced = false;

const basesLoaded = (async () => {
  try {
    const cache = await caches.open(PACK_CACHE_NAME);
    const stored = await cache.match(PACK_BASES_KEY);
    if (!stored) return;
    const parsed = await stored.json();
    // See the comment above: a `PACK_BASES` message may have already landed
    // while the two awaits above were in flight, and its data is strictly
    // fresher than whatever was persisted last session.
    //
    // A bare array is what this key held before manifests joined it. Read as
    // "bases, no exclusions", which is the pre-existing behaviour: the page
    // re-announces both on the very next boot, so the old shape is seen at
    // most once per browser.
    if (announced) return;
    if (Array.isArray(parsed)) {
      rememberBases(parsed);
      return;
    }
    const stored_ = parsed as { bases?: unknown; manifests?: unknown };
    rememberBases(stored_.bases);
    rememberManifests(stored_.manifests);
  } catch {
    // An unreadable list costs offline packs, never the app.
  }
})();

self.addEventListener('install', event => event.waitUntil(basesLoaded));
self.addEventListener('activate', event => event.waitUntil(basesLoaded));

self.addEventListener('message', event => {
  const data = event.data as { type?: string; bases?: unknown; manifests?: unknown } | null;
  if (!data || data.type !== 'PACK_BASES') return;
  // Set before anything else in this handler, synchronously — this is the
  // half of the race `basesLoaded` above reads.
  announced = true;
  rememberBases(data.bases);
  rememberManifests(data.manifests);
  // Snapshotted here, synchronously, rather than inside the `.then` below:
  // `packBases` is module state, and reading it only after `caches.open`
  // resolves would let anything that mutates it in between — a second
  // `PACK_BASES` message, in principle — change what this call ends up
  // persisting out from under it. There is nothing between this line and the
  // `rememberBases` call above that yields, so this is exactly what was just
  // announced.
  const toPersist = JSON.stringify({ bases: packBases, manifests: packManifests });
  event.waitUntil(
    caches
      .open(PACK_CACHE_NAME)
      .then(cache =>
        cache.put(
          PACK_BASES_KEY,
          new Response(toPersist, {
            headers: { 'content-type': 'application/json' },
          })
        )
      )
      .catch(() => {})
  );
});

/**
 * `CacheFirst`, and with no `ExpirationPlugin` on purpose: an entry cap would
 * evict the very chunks the prefetch just spent a megabyte fetching. Removal
 * is the player's, through the packs screen.
 *
 * This comment used to add "every file under a base is content-hashed by the
 * pack's own build, so a stale entry is not a thing that can happen", and
 * that was the error the whole pinning change exists to correct. Two names
 * under a pack's base are *not* content-hashed — `manifest.json` and the
 * entry `pack.js` — and both are the ones that matter. Caching the manifest
 * for ever froze the pack at whatever build was installed first; caching the
 * entry for ever pointed it at a chunk graph the deploy had already deleted.
 *
 * The manifest is excluded from this route entirely. The entry is kept, and
 * is now safe to keep, because `packSource.ts` hangs the build id off its URL
 * — one URL per build, so an old entry and a new manifest can no longer be
 * confused for each other.
 *
 * **`ignoreSearch` is deliberately NOT set here**, and the reasoning is worth
 * keeping because it looks like a bug the other way round. The prefetch walks
 * `manifest.files` and caches the entry as the plain `pack.js` the build
 * emitted, while the game imports `pack.js?b=<buildId>` — so the two never
 * match and the prefetched copy of the entry is dead weight. It reads like the
 * offline case losing the one file the whole pack hangs off.
 *
 * It does not, and `verify-pwa-offline.mjs` was run with the option removed to
 * check rather than to assume: installing a pack *is* fetching its entry, that
 * fetch goes through this very route, and `CacheFirst` stores what it fetched
 * — under the queried URL. So the entry a later offline launch asks for is
 * already there, addressed exactly.
 *
 * And setting it would reopen the bug this whole change exists to close. A
 * browser whose `localStorage` was cleared but whose `CacheStorage` was not
 * has no pin and a stale `pack.js`; boot fetches the current manifest, imports
 * `pack.js?b=<new>`, and `ignoreSearch` would answer that with the *old*
 * entry — an old chunk graph against a new manifest, which is precisely the
 * 404 that started this. The 86 wasted bytes are the cheaper mistake.
 *
 * `ignoreVary: true` because the two sides write and read with different
 * `Request`s: `packCache.ts` calls `cache.put(urlString, …)`,
 * whose implicit `Request` carries no headers, while this route matches
 * against the browser's real request, headers included. Without this, a pack
 * host that sends `Vary: Accept` (or anything else) makes every prefetched
 * entry silently unmatchable — this route falls through to the network,
 * which still works online and is exactly where the feature is meant to
 * matter.
 */
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && isPackRequest(url.href, packBases, packManifests),
  new CacheFirst({
    cacheName: PACK_CACHE_NAME,
    matchOptions: { ignoreVary: true },
    /**
     * `200` alone. Status `0` is an **opaque** response — what a `no-cors`
     * request gets back — and storing one here is a trap with a long fuse:
     * `CacheFirst` would hand that same opaque body to the next reader, and
     * every real consumer of a pack file asks in `cors` mode (p5's `loadImage`
     * opens with a `cors` fetch, `import()` requires CORS, and `packCache`'s
     * prefetch is a plain `fetch`). Handing an opaque response to a `cors`
     * request fails it — so one stray `no-cors` request would poison that URL
     * for the life of the cache, which no reload clears.
     *
     * The stray request is gone too (`AssetManager.decodeImageElement` and
     * every `<img>` that can show pack art now set `crossorigin`), and this is
     * the half that keeps it gone: with `0` accepted, the next one silently
     * rebuilds the bug; with it refused, the worst case is a file that is
     * fetched again rather than one that can never be read.
     */
    plugins: [new CacheableResponsePlugin({ statuses: [200] })],
  })
);
