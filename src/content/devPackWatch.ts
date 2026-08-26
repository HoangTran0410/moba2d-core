import { isDevPackUrl } from './devPack';
import { readInstalledPacks } from './installedPackStore';
import { notePackProblem } from './packHealth';
import { fetchPackManifest } from './packSource';

/**
 * Telling a pack author that the build they just made is ready.
 *
 * `devPack.ts` stopped core from pinning or caching a pack served from
 * loopback, which is what makes a rebuild land on the next reload. This is the
 * other half: nothing said the reload was worth doing, so the author was left
 * alt-tabbing back to a page that looks exactly as it did before and guessing
 * whether their build had finished.
 *
 * **A poll, not a socket.** The obvious alternative is for the dev server to
 * push an event, and it is the wrong shape: it invents a protocol between core
 * and one particular server, and it stops working the moment the author serves
 * their `dist/` through a tunnel, a different static server, or a preview
 * deploy. Polling a manifest asks the same question of any host at all, and it
 * is a JSON file on the author's own machine — the cost is not worth
 * measuring.
 *
 * **It says it once.** Once the notice is up, the answer does not change until
 * the page reloads, and a watch that kept re-reporting would only be able to
 * make the same banner reappear after the author dismissed it.
 *
 * Its failure mode is silence, the same as `checkPackUpdates`: a dev server
 * that does not answer is an author mid-rebuild, not a broken pack, and the
 * next poll is the one that catches them coming back.
 */

/** Long enough to be free, short enough that a rebuild feels answered. */
const DEFAULT_INTERVAL_MS = 2_000;

interface Watched {
  readonly manifestUrl: string;
  readonly id: string;
  readonly name: string;
  /** The build this page actually loaded, written by boot's own install. */
  readonly buildId: string;
}

/**
 * Starts watching every dev pack this page booted with. Returns the stop
 * function; call it to end the watch early.
 *
 * Reads the installed list once, on purpose. The question is "has the host
 * moved away from what *this page* loaded", and that answer is fixed the
 * moment the page finished booting — re-reading the list would only pick up
 * records this same watch is about to make stale.
 */
export function startDevPackWatch(options: { intervalMs?: number } = {}): () => void {
  const pending: Watched[] = [];
  for (const record of readInstalledPacks()) {
    if (!isDevPackUrl(record.manifestUrl)) continue;
    // No build id, nothing to compare. A pack whose manifest declares none
    // cannot be told apart across rebuilds by anything core can see, and
    // saying "it changed" on every poll would be a guess.
    if (!record.buildId) continue;
    pending.push({
      manifestUrl: record.manifestUrl,
      id: record.id,
      name: record.name || record.id,
      buildId: record.buildId,
    });
  }
  // No timer at all in the ordinary case — a player with published packs pays
  // nothing for a feature aimed at the person writing one.
  if (pending.length === 0) return () => {};

  const timer = setInterval(() => {
    void poll();
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);

  const stop = (): void => clearInterval(timer);

  async function poll(): Promise<void> {
    for (const watched of [...pending]) {
      let fresh;
      try {
        // `bypassCache` for the reason the update check gives at its own call:
        // a read whose entire job is to notice a change must not be answered
        // out of the cache it is checking.
        fresh = await fetchPackManifest(watched.manifestUrl, undefined, { bypassCache: true });
      } catch {
        continue;
      }
      if (!fresh.buildId || fresh.buildId === watched.buildId) continue;
      notePackProblem({
        id: watched.id,
        name: fresh.name || watched.name,
        manifestUrl: watched.manifestUrl,
        kind: 'dev-changed',
      });
      pending.splice(pending.indexOf(watched), 1);
    }
    if (pending.length === 0) stop();
  }

  return stop;
}
