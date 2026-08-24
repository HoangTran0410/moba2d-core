/**
 * The installed app's update channel.
 *
 * A service worker gives the game two things it did not have: it opens with no
 * network, and it can tell the player a newer build exists. The second is only
 * useful because of the first — a cached app will happily serve last month's
 * build forever, and without a prompt the player has no way to know and no
 * gesture that would fix it. "Hard refresh" is not an answer on a phone.
 *
 * `registerType: 'prompt'` in `vite.config.ts` is what makes this a decision
 * rather than an event: the new worker installs and then *waits*. Nothing
 * reloads until `applyUpdate()` is called, because a reload mid-match is worse
 * than a stale build. `MenuScene.vue` puts that choice on the menu, which
 * is the one screen where losing the page costs nothing.
 *
 * Deliberately a plain module with a Vue `ref`, not a component or a composable:
 * registration happens once for the whole page, well before any scene mounts,
 * and every scene that comes and goes has to read the *same* answer. See the
 * `<script setup>` note in CLAUDE.md for why that cannot live in a component.
 *
 * **Why `updateReady` alone used to take 10-20 seconds to light up.** The
 * browser's own registration check is fast — `navigator.serviceWorker.register()`
 * fetches `sw.js` and byte-compares it essentially immediately, measured under
 * a second. What actually takes the time is what happens *after* a difference
 * is found: `workbox-precaching` downloads every changed precache entry one at
 * a time, deliberately serial —
 * https://github.com/GoogleChrome/workbox/issues/2528 — and only fires the
 * `installed`/"waiting" transition `updateReady` waits for once every last one
 * has landed. A real deploy here commonly touches a few dozen files (every
 * per-champion `spell-*.js` chunk imports the shared `game` chunk by its
 * hashed filename, so *any* change under `src/game/` changes that filename and
 * cascades into invalidating every spell chunk's own hash, even when no spell
 * itself changed a line — see the report). Measured against a real two-commit
 * gap (65 changed files, ~1.2MB) on a throttled connection: ~19.4 seconds from
 * reopening the app to `updateReady` — squarely in the reported range, and
 * long after a player already pressed Play.
 *
 * `updateDownloading` is the fast half fixing that: `updatefound` on the
 * registration — the same signal that starts the slow download above — fires
 * within about a second of opening the app, well before the download
 * finishes. It cannot safely stand in for `updateReady` (pressing "cập nhật"
 * on a build that has not finished downloading has nothing to skip-wait to),
 * but it can tell the player "an update exists and is on its way" as soon as
 * that is actually known, instead of only once it is fully ready.
 */
import { ref } from 'vue';

/** A newer build is installed and waiting for permission to take over. */
export const updateReady = ref(false);

/**
 * A newer build has been detected on the server and is downloading in the
 * background — set from `updatefound`, well before `updateReady`. See the
 * header comment above for why the two are seconds apart rather than the
 * same event twice.
 */
export const updateDownloading = ref(false);

/**
 * The player pressed "cập nhật" while the new build was still downloading.
 *
 * This is what makes the *fast* signal actionable. `updateReady` cannot come
 * early — pressing it skip-waits to a worker, and until the precache download
 * finishes there is no waiting worker to skip to — so the old menu showed a
 * dead "đang tải…" line for the ~19 seconds between the two and only then
 * offered a button. The player has usually pressed Play by then, and a reload
 * mid-match is exactly what `registerType: 'prompt'` exists to avoid.
 *
 * So the press is allowed to arrive first and wait for the build instead of
 * the other way round: `requestUpdate` sets this, and `onNeedRefresh` applies
 * the moment the worker is actually ready. The player presses once, at second
 * one, and can walk away.
 */
export const updateQueued = ref(false);

/**
 * How many files the incoming build has cached so far.
 *
 * A count, not a percentage — see `PrecacheProgressMessage` in `src/sw.ts` for
 * why there is no honest denominator to divide by. Its whole job is to prove a
 * wait that can run to twenty seconds is not a hang: a spinner that never
 * moves and a number that climbs read completely differently on a phone.
 */
export const updateDownloadedCount = ref(0);

/** The app has been cached and will now open without a network. */
export const offlineReady = ref(false);

/** Set by `registerServiceWorker`; null until then, and on browsers without one. */
let applyWaitingUpdate: ((reload?: boolean) => Promise<void>) | null = null;

/**
 * How often to ask the server whether a newer build exists.
 *
 * The browser checks on its own when the page loads and roughly daily after
 * that, which for a game someone leaves open in a tab means "never". One
 * conditional request for a file of a few kilobytes is cheap enough that the
 * interval is set by how stale a build may be, not by cost.
 *
 * **The interval is the fallback, not the mechanism.** What actually catches a
 * deploy is `checkOnReturn` below: a player who comes back to the tab, or whose
 * phone reconnects, is checked within a second. A timer alone cannot do that —
 * a backgrounded tab's timers are throttled to minutes or stopped outright.
 */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * The shortest gap between two checks, whatever asks for them.
 *
 * `visibilitychange` fires on every tab switch and `online` can flap on a
 * moving phone, so without this a player alt-tabbing repeatedly would send a
 * request per switch. A minute is well under any interval a human would
 * notice and well over any burst.
 */
export const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000;

/** Just enough of a `ServiceWorkerRegistration` to ask it for an update. */
interface UpdatableRegistration {
  update(): Promise<unknown>;
}

/**
 * A throttled "check now", for the signals that mean *the player came back*.
 *
 * Offline, `update()` rejects; that is the expected case for an installed app
 * and says nothing worth reporting, so the rejection is swallowed here rather
 * than at each call site.
 */
export function createUpdateChecker(
  registration: UpdatableRegistration,
  now: () => number = () => Date.now()
): () => void {
  // Not `0`: with a fake clock starting at zero that would suppress the very
  // first check, which is the one that matters most.
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last < UPDATE_CHECK_MIN_GAP_MS) return;
    last = at;
    registration.update().catch(() => {});
  };
}

/**
 * How long `updateDownloading` is allowed to stay lit without the install it
 * is reporting on ever reaching `installed` or `redundant`.
 *
 * Nothing about the real update is gated on this — `updateReady` still
 * follows the worker's own state regardless. This only stops the "đang tải
 * bản cập nhật" message from hanging on screen forever if a connection
 * stalls mid-download without the browser ever declaring the attempt
 * `redundant` itself.
 */
export const UPDATE_DOWNLOAD_STALL_MS = 2 * 60 * 1000;

/**
 * A minimal shape for the installing worker: just enough to watch it finish,
 * so this can be exercised in Vitest with a plain fake instead of a real
 * `ServiceWorker` (which, like the rest of this module's browser API surface,
 * does not exist in a Node test run).
 */
interface InstallingWorkerLike {
  readonly state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/**
 * Lights `updateDownloading` for as long as `installing` is still installing,
 * and turns it back off the moment that worker either finishes
 * (`installed`/`redundant`) or `UPDATE_DOWNLOAD_STALL_MS` gives up on it.
 *
 * Split out from `registerServiceWorker` because it is the one piece of this
 * file with real branching to get right, and — unlike the registration call
 * around it — needs nothing from `virtual:pwa-register` to test.
 */
export function trackDownloadingUpdate(
  installing: InstallingWorkerLike,
  setTimeoutFn: typeof setTimeout = setTimeout,
  clearTimeoutFn: typeof clearTimeout = clearTimeout
): void {
  updateDownloading.value = true;
  // A fresh attempt counts from zero, or a retry after a `redundant` one
  // resumes from a number that belonged to a download that no longer exists.
  updateDownloadedCount.value = 0;
  const giveUp = setTimeoutFn(() => {
    updateDownloading.value = false;
    updateQueued.value = false;
  }, UPDATE_DOWNLOAD_STALL_MS);
  installing.addEventListener('statechange', () => {
    if (installing.state === 'installed' || installing.state === 'redundant') {
      clearTimeoutFn(giveUp);
      updateDownloading.value = false;
      // `installed` hands over to `onNeedRefresh`, which is what honours a
      // queued press. `redundant` means this attempt died — drop the press
      // with it rather than leave "sẽ tự cập nhật" on screen waiting for a
      // build that is never coming.
      if (installing.state === 'redundant') updateQueued.value = false;
    }
  });
}

/**
 * Registers the worker and starts the update poll.
 *
 * Safe to call anywhere — it no-ops in a browser without service workers, on
 * `http://` origins other than localhost (where they are forbidden outright),
 * and in dev, where `devOptions.enabled` is false and the virtual module
 * registers nothing.
 */
export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  // Dynamic, and the string is deliberately not extracted to a constant: this
  // is a Vite virtual module, resolved at build time, and it does not exist in
  // a plain Node/Vitest run. Importing it at module scope would take the whole
  // HUD's test suite down with it.
  const { registerSW } = await import('virtual:pwa-register');

  // The installing worker reports each file it caches — see `addPlugins` in
  // `src/sw.ts`. Registered before `registerSW` so an install already under
  // way from a previous page load is not counted from halfway.
  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data as { type?: string; downloaded?: number } | null;
    if (data?.type === 'PRECACHE_PROGRESS' && typeof data.downloaded === 'number') {
      updateDownloadedCount.value = data.downloaded;
    }
  });

  applyWaitingUpdate = registerSW({
    onNeedRefresh() {
      updateReady.value = true;
      updateDownloading.value = false;
      // The player already pressed, seconds ago, while this was downloading.
      if (updateQueued.value) void applyUpdate();
    },
    onOfflineReady() {
      offlineReady.value = true;
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;

      // `updatefound` is the fast signal — see the header comment. Only
      // worth surfacing as "an update exists" when something is already
      // controlling the page: a bare `installing` worker with no controller
      // is the very first install, which is `onOfflineReady`'s story, not an
      // update to anything the player has already opened.
      const watchInstallingWorker = (): void => {
        const installing = registration.installing;
        if (!installing || !navigator.serviceWorker.controller) return;
        trackDownloadingUpdate(installing);
      };
      // The install this very `register()` call kicked off can already be
      // under way by the time this callback runs, so check once immediately
      // in addition to listening for the next one.
      registration.addEventListener('updatefound', watchInstallingWorker);
      watchInstallingWorker();

      // The three moments worth asking, cheapest first. A timer alone misses
      // every one of them: a backgrounded tab's timers are throttled to
      // minutes or stopped, so the player who closed the game on Friday and
      // opened it on Monday is caught by `visibilitychange`, not by this
      // interval — and the one whose train came out of a tunnel is caught by
      // `online`. All three go through the same throttle.
      const check = createUpdateChecker(registration);
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
    },
  });
}

/**
 * What the menu's button calls: update now if there is something to update to,
 * otherwise remember the press and update the moment there is.
 *
 * The whole point of the second branch is that the button can be offered on
 * the *fast* signal (`updateDownloading`, about a second) instead of the slow
 * one (`updateReady`, about twenty). See `updateQueued`.
 */
export async function requestUpdate(): Promise<void> {
  if (updateReady.value) {
    await applyUpdate();
    return;
  }
  updateQueued.value = true;
}

/**
 * Hands over to the waiting build and reloads.
 *
 * The reload is the worker's, not ours: `registerSW`'s callback posts
 * SKIP_WAITING and reloads once the new worker has actually taken control, so
 * the page that comes back is the new one rather than the old one served from
 * a cache mid-swap.
 */
export async function applyUpdate(): Promise<void> {
  updateReady.value = false;
  updateQueued.value = false;
  await applyWaitingUpdate?.(true);
}
