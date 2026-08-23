import { buildContentApi, type ContentApi } from './ContentApi';
import { installRuntimePack } from './install';
import { fetchPackManifest, loadPackFromManifest, PackLoadError } from './packSource';
import type { PackRegistry } from './PackRegistry';
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
 * the two apart.
 *
 * **The flag is set on a seed that *worked*, never on one that merely
 * happened.** It used to be set either way, reasoned as "a browser with no
 * network must not phone an unreachable host on every launch forever". That
 * is the wrong trade and it was measured to be: `DEFAULT_PACK_URL` answers
 * 404 until the pack repository's own publish workflow has run, so every
 * browser that boots before publication spends its single automatic attempt
 * on a guaranteed failure, `wanted` is permanently `[]` afterwards, and the
 * retry offered on the banner is `location.reload()` — which cannot re-seed,
 * because the flag is already set. One unlucky first launch and that browser
 * never sees the content again. The cost of the other choice is one failed
 * `fetch` per launch on a browser with no packs and no network, which is a
 * few hundred bytes that never leave the machine. The uninstall case the
 * flag exists for is untouched: a successful seed sets it, so a player who
 * removes every pack afterwards is not re-seeded.
 *
 * **A pack whose id is already installed is skipped, not failed.** Both
 * content paths can be live at once until Plan 2 retires core's compile-in
 * step, and the default pack's id (`riot`) is the same id on both. The skip
 * happens after the manifest — cheap JSON, and the only way to learn the id
 * — and before the entry is fetched or any asset manifest is registered:
 * `AssetManager.registerPackAssets` is a bare `Map.set`, so an install that
 * runs it on the way to a duplicate-id throw silently repoints every one of
 * that pack's art keys at the remote host for the rest of the session.
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
  /**
   * The pack is here. `skipped` is set only when it was *already* here under
   * this id and this call did nothing — not a failure (the content the
   * player wanted is installed either way), and deliberately distinguishable
   * so a caller can say which of the two happened.
   */
  | { manifestUrl: string; ok: true; id: string; skipped?: true }
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
  // `anyInstalled` means "the pack is in the registry", which a skip
  // satisfies as much as an install does: the id is present, so the record
  // is worth remembering and — if this was the seeding run — the offer is
  // settled. Only a real failure leaves both undone.
  let anyInstalled = false;

  let api: ContentApi;
  let registry: PackRegistry;
  try {
    api = buildContentApi();
    registry = rebuildContentRegistry();
  } catch (thrown) {
    // The two calls the per-pack `try` below never covered, and the reason
    // this function's "nothing here may throw" was a comment rather than a
    // fact: `LoadingScene.enter()` fires `void this.boot()`, so a throw here
    // became an unhandled rejection and the menu handover never ran.
    return [
      {
        manifestUrl: '',
        ok: false,
        stage: 'registry',
        message: (thrown as Error)?.message ?? String(thrown),
      },
    ];
  }

  for (const manifestUrl of wanted) {
    try {
      const manifest = await fetchPackManifest(manifestUrl);
      // Ahead of `loadPackFromManifest`, so a pack core already has is not
      // re-downloaded, and ahead of any asset registration — see this
      // file's own header.
      if (registry.hasPack(manifest.id)) {
        anyInstalled = true;
        installed.push({ manifestUrl, id: manifest.id, version: manifest.version });
        outcomes.push({ manifestUrl, ok: true, id: manifest.id, skipped: true });
        continue;
      }
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

  // The offer is spent only once it has actually been taken. See this
  // file's own header: marking it on a failed attempt locks a browser out
  // of the default pack permanently, and the retry the banner offers is a
  // reload, which cannot undo it.
  if (seeding && anyInstalled) markDefaultPackSeeded();

  // Only what actually installed is remembered. A URL that failed is not
  // written, so a first run that could not reach the network retries the
  // default next time instead of remembering a pack it never had.
  if (anyInstalled) writeInstalledPacks(installed);
  return outcomes;
}
