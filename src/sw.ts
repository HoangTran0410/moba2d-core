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
