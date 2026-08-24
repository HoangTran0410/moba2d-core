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
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

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
    if (typeof base === 'string' && base.length > 0) packBases.push(base);
  }
}

/**
 * Reads the stored list at module scope, so a worker the browser restarted —
 * which does not re-run `activate` — still matches pack requests.
 *
 * There is a race and it is bounded: a fetch that arrives before this
 * resolves does not match, so it goes to the network, which is exactly the
 * behaviour before this feature existed. In practice the first event a
 * restarted worker sees is a navigation, and a pack chunk is asked for
 * seconds later.
 */
const basesLoaded = (async () => {
  try {
    const cache = await caches.open(PACK_CACHE_NAME);
    const stored = await cache.match(PACK_BASES_KEY);
    if (stored) rememberBases(await stored.json());
  } catch {
    // An unreadable list costs offline packs, never the app.
  }
})();

self.addEventListener('install', event => event.waitUntil(basesLoaded));
self.addEventListener('activate', event => event.waitUntil(basesLoaded));

self.addEventListener('message', event => {
  const data = event.data as { type?: string; bases?: unknown } | null;
  if (!data || data.type !== 'PACK_BASES') return;
  rememberBases(data.bases);
  event.waitUntil(
    caches
      .open(PACK_CACHE_NAME)
      .then(cache =>
        cache.put(
          PACK_BASES_KEY,
          new Response(JSON.stringify(packBases), {
            headers: { 'content-type': 'application/json' },
          })
        )
      )
      .catch(() => {})
  );
});

/**
 * `CacheFirst`, and with no `ExpirationPlugin` on purpose. Every file under a
 * base is content-hashed by the pack's own build, so a stale entry is not a
 * thing that can happen — and an entry cap would evict the very chunks the
 * prefetch just spent a megabyte fetching. Removal is the player's, through
 * the packs screen.
 */
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && packBases.some(base => url.href.startsWith(base)),
  new CacheFirst({
    cacheName: PACK_CACHE_NAME,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  })
);
