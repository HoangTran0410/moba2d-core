import { buildContentApi } from './ContentApi';
import { installRuntimePack } from './install';
import { fetchPackManifest, loadPackFromManifest, PackLoadError } from './packSource';
import { rebuildContentRegistry } from './registry';
import {
  readInstalledPacks,
  writeInstalledPacks,
  hasSeededDefaultPack,
  markDefaultPackSeeded,
  type InstalledPackRecord,
} from './installedPackStore';

/**
 * Installing every remembered pack, once, during the loading screen.
 *
 * **Nothing here may throw.** The game is already playable when this runs —
 * `main.ts` installed core and the reference pack synchronously before
 * `LoadingScene` ever mounted — so every failure below costs the player
 * content they can retry for, and none of it may cost them the menu. That
 * is why the return is a list of outcomes rather than a promise that
 * rejects: the caller reports what failed and carries on.
 *
 * One pack's failure does not stop the next. A player with two packs and one
 * dead host should lose one roster, not both.
 *
 * **The registry is rebuilt exactly once, before the loop, not once per
 * pack.** Rebuilding inside the loop (the shape this function started as)
 * discards and reinstalls the *whole* registry — core, the reference pack
 * and every runtime pack installed so far in this same call — on every
 * iteration, which is O(n^2) in the pack count and, worse, throws away a
 * pack installed two iterations ago the instant the *next* one rebuilds. One
 * rebuild up front is enough: `installRuntimePack` only needs a registry
 * that already reflects the bundled packs, and every runtime pack after that
 * installs directly into the same instance.
 *
 * **An empty stored list seeds the default only once, ever — not once per
 * empty list.** `readInstalledPacks()` returning `[]` means two different
 * things: a browser that has never run this game, and a browser whose
 * player has removed every pack. Seeding the default on both makes an
 * uninstall impossible to keep — the very next boot would just bring it
 * back. `installedPackStore.ts`'s `hasSeededDefaultPack()` is what tells
 * the two apart, and `markDefaultPackSeeded()` is called once a seeding
 * *attempt* has been made, whether or not it actually installed anything.
 * That last part is deliberate: the alternative is a browser with no
 * network phoning an unreachable host on every single launch forever, and
 * a player who *wants* the default pack after a failed first attempt has
 * Plan 2's management screen to press "add the official pack" on
 * purpose — a retry loop no one asked for is not a substitute for that
 * button.
 */

/**
 * Where the game's own content comes from when a player has never installed
 * anything. Seeded into the stored list on first run, after which it is an
 * ordinary entry the player can remove.
 *
 * **`hoangtran99.is-a.dev`, not the `hoangtran0410.github.io` alias for the
 * same repository.** The `github.io` form was the original choice, on the
 * reasoning that the name survives a future custom-domain change — true,
 * and the wrong thing to optimise for: measured with `curl -sI`, that form
 * 301-redirects to `http://hoangtran99.is-a.dev/...` (a downgrade to plain
 * HTTP) and the redirect response itself carries no
 * `access-control-allow-origin` header. A browser `fetch()` requires *every*
 * hop in a cross-origin redirect chain to carry CORS headers, not just the
 * final one, so the `github.io` form cannot ever succeed from a page — not
 * "not published yet", structurally broken. The `is-a.dev` host, fetched
 * directly, answers `200`/`404` with `access-control-allow-origin: *`, the
 * same as any other path on it. If this ever needs to move again, measure
 * the redirect chain with `curl -sI` first — a name that "should" be more
 * stable is not a reason to reopen this.
 */
export const DEFAULT_PACK_URL = 'https://hoangtran99.is-a.dev/moba2d-content-riot/manifest.json';

export type PackInstallOutcome =
  | { manifestUrl: string; ok: true; id: string }
  | { manifestUrl: string; ok: false; stage: string; message: string };

export async function installRuntimePacks(): Promise<PackInstallOutcome[]> {
  const stored = readInstalledPacks();

  // Seeding the default is a one-time offer, not "whatever the list is
  // empty this boot": a list that is empty *because a real list already
  // exists and the player cleared it* must stay empty. See this file's own
  // header for the full reasoning.
  let seeding = false;
  let wanted: string[];
  if (stored.length > 0) {
    wanted = stored.map(record => record.manifestUrl);
  } else if (!hasSeededDefaultPack()) {
    wanted = [DEFAULT_PACK_URL];
    seeding = true;
  } else {
    wanted = [];
  }

  const outcomes: PackInstallOutcome[] = [];
  const installed: InstalledPackRecord[] = [];
  const api = buildContentApi();
  const registry = rebuildContentRegistry();
  let anyInstalled = false;

  for (const manifestUrl of wanted) {
    try {
      const manifest = await fetchPackManifest(manifestUrl);
      const pack = await loadPackFromManifest(manifest, manifestUrl);
      installRuntimePack(registry, api, pack);
      anyInstalled = true;
      installed.push({ manifestUrl, id: manifest.id, version: manifest.version });
      outcomes.push({ manifestUrl, ok: true, id: manifest.id });
    } catch (thrown) {
      const error = thrown as PackLoadError;
      outcomes.push({
        manifestUrl,
        ok: false,
        stage: error.stage ?? 'import',
        message: error.message,
      });
    }
  }

  // The offer is marked spent whether or not it landed — a failed attempt
  // must not retry forever, only once more per this file's own header.
  if (seeding) markDefaultPackSeeded();

  // Only what actually installed is remembered. A URL that failed is not
  // written, so a first run that could not reach the network retries the
  // default next time instead of remembering a pack it never had.
  if (anyInstalled) writeInstalledPacks(installed);
  return outcomes;
}
