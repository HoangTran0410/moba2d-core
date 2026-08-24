import { buildContentApi, type ContentApi } from './ContentApi';
import { installRuntimePack } from './install';
import {
  announcePackBases,
  packBaseFor,
  prefetchPackFiles,
  type PrefetchReport,
} from './packCache';
import {
  fetchPackManifest,
  loadPackFromManifest,
  PackLoadError,
  resolvePackIcon,
  type RuntimePackManifest,
} from './packSource';
import type { PackRegistry } from './PackRegistry';
import { contentRegistry, rebuildContentRegistry } from './registry';
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
 * **There are two writers of the installed list, and both have to mark this
 * flag.** This function is one; `installPackNow()` below — the packs
 * screen's "install by URL" path — is the other, and it marks the flag on
 * its own successful, non-skipped install for the same reason: a player who
 * installs a pack by hand has made their own choice, spending the automatic
 * offer just as surely as a seed landing would have. Leaving `installPackNow`
 * out reopens exactly the hole this section describes — a browser whose
 * first boot could not reach `DEFAULT_PACK_URL` installs one by URL instead,
 * later removes it, and the next boot re-seeds a default the player never
 * asked for, because nothing ever told the flag the offer was spent.
 *
 * **A pack whose id is already installed is skipped, not failed.** Both
 * content paths can be live at once until Plan 2 retires core's compile-in
 * step, and the default pack's id (`riot`) is the same id on both. The skip
 * happens after the manifest — cheap JSON, and the only way to learn the id
 * — and before the entry is fetched or any asset manifest is registered:
 * `AssetManager.registerPackAssets` is a bare `Map.set`, so an install that
 * runs it on the way to a duplicate-id throw silently repoints every one of
 * that pack's art keys at the remote host for the rest of the session.
 *
 * **The offline prefetch is fire-and-forget, on purpose.** The real pack is
 * 4.7MB, and this function's `await` is the statement standing between the
 * player and the menu — `LoadingScene.enter()` fires `void this.boot()`, so
 * anything that rejects above the handover is an unhandled rejection and the
 * menu never opens, and anything merely slow is the same dead screen with
 * extra steps. `installRuntimePacks()` announces the installed bases (a
 * chunk fetched mid-match is cached by the worker's own route too, so the
 * announce always happens) and then starts the prefetch without awaiting it,
 * catching whatever it throws so a slow or failing cache never becomes the
 * player's problem. `window.__lol2dPackPrefetch` is where that background
 * work reports in, once it is actually done — see this file's own export.
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
  | { manifestUrl: string; ok: true; id: string; skipped?: true; icon?: string }
  | { manifestUrl: string; ok: false; stage: string; message: string };

/**
 * One stored record, from a manifest and where it came from.
 *
 * Three call sites write the installed list — two in `installRuntimePacks`
 * and one in `installPackNow` — and they all go through here so a field
 * added to `InstalledPackRecord` cannot land in two of them and be missing
 * from the third. `icon` is `undefined` for a manifest that declared none,
 * and `JSON.stringify` drops the key entirely, which is what the store's own
 * defensive read expects.
 */
function recordFor(manifestUrl: string, manifest: RuntimePackManifest): InstalledPackRecord {
  return {
    manifestUrl,
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    icon: resolvePackIcon(manifest, manifestUrl),
  };
}

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
  // Every base worth announcing to the worker, and every file list worth
  // prefetching — filled in beside `installed.push(...)` in both loop
  // branches below, because a pack core already has under its id is still a
  // pack whose bytes are worth caching, same as one this call just fetched.
  const bases: string[] = [];
  const toPrefetch: { base: string; files: string[] }[] = [];

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

  // Both loop branches below need to register a pack's base and its files
  // for prefetch — a pack core already has under its id (the skip branch)
  // is still a pack whose bytes are worth caching, same as one this call
  // just fetched (the install branch), so this is the one copy of that
  // logic. A closure over `bases`/`toPrefetch` rather than a function
  // returning them: both accumulate across every pack in `wanted`, not
  // just the one call.
  const registerForCaching = (manifestUrl: string, manifest: RuntimePackManifest): void => {
    const base = packBaseFor(manifestUrl);
    if (!base) return;
    bases.push(base);
    if (manifest.files && manifest.files.length > 0)
      toPrefetch.push({ base, files: manifest.files });
  };

  for (const manifestUrl of wanted) {
    try {
      const manifest = await fetchPackManifest(manifestUrl);
      // Ahead of `loadPackFromManifest`, so a pack core already has is not
      // re-downloaded, and ahead of any asset registration — see this
      // file's own header.
      if (registry.hasPack(manifest.id)) {
        anyInstalled = true;
        installed.push(recordFor(manifestUrl, manifest));
        outcomes.push({ manifestUrl, ok: true, id: manifest.id, skipped: true });
        registerForCaching(manifestUrl, manifest);
        continue;
      }
      const pack = await loadPackFromManifest(manifest, manifestUrl);
      installRuntimePack(registry, api, pack);
      anyInstalled = true;
      installed.push(recordFor(manifestUrl, manifest));
      outcomes.push({ manifestUrl, ok: true, id: manifest.id });
      registerForCaching(manifestUrl, manifest);
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

  // The worker needs the bases whether or not anything is prefetched: a chunk
  // fetched mid-match is cached by that route too, which is what makes the
  // prefetch a completeness measure rather than the only path.
  //
  // Always announced, including an empty list: a player who removes their
  // only pack must clear the worker's memory of it too, or `packBases` in
  // `src/sw.ts` holds a base forever — harmless today (`forgetPack` already
  // emptied the cache entries, so the route falls through to the network),
  // but it widens Important 1's stale-persisted-list window from "bounded by
  // this boot" to "unbounded", since nothing ever tells the worker the list
  // shrank.
  announcePackBases(bases);

  // **Not awaited, deliberately.** This is 4.7MB on the real pack, and the
  // menu handover is the statement after the caller's `await` on this
  // function. Spec §6: "trả sau lưng người chơi thay vì trước mặt". The
  // `catch` is what keeps a rejected prefetch from becoming an unhandled
  // rejection on the boot path — `prefetchPackFiles` counts its own failures
  // and should never reject, and this is the belt that makes that a fact
  // rather than a comment.
  //
  // **`allSettled`, not `all`.** `prefetchPackFiles` made this exact switch
  // one task ago, for its own internal fan-out, on the same reasoning that
  // applies here one level up: `all` rejecting the instant any one pack's
  // promise does would drop every OTHER pack's already-settled report along
  // with it, not just the failing one's — silently, since the whole point of
  // this being fire-and-forget is that nothing is watching. A rejection
  // should never happen (that is what the `prefetchPackFiles` contract
  // promises), so a settled report is synthesized for it rather than
  // omitted: "one report per requested pack" stays true for whatever reads
  // `window.__lol2dPackPrefetch`, and the synthesized report's own numbers
  // say plainly that nothing made it in.
  if (toPrefetch.length > 0) {
    void Promise.allSettled(toPrefetch.map(pack => prefetchPackFiles(pack.base, pack.files)))
      .then(settled => {
        // A plain loop, not `.filter`/`.map`+cast: `Array.prototype.filter`
        // is polyfilled in this project and cannot narrow a type, and this
        // walk needs the matching `toPrefetch[i]` for a rejected entry
        // anyway.
        const reports: PrefetchReport[] = [];
        for (let i = 0; i < settled.length; i++) {
          const outcome = settled[i];
          if (outcome.status === 'fulfilled') {
            reports.push(outcome.value);
            continue;
          }
          const pack = toPrefetch[i];
          reports.push({
            base: pack.base,
            requested: pack.files.length,
            added: 0,
            skipped: 0,
            failed: pack.files.length,
          });
        }
        publishPrefetchReports(reports);
      })
      .catch(thrown => console.error('[packs] prefetch threw', thrown));
  }

  return outcomes;
}

/**
 * Installs one pack into the live registry, without a reload — spec §5.2.
 *
 * Takes the manifest rather than fetching it, because the caller has already
 * fetched it: spec §3 splits the fetch from the import precisely so a player
 * can be shown the origin in between, and a function that did both would put
 * that screen back inside the same call it exists to interrupt.
 *
 * Everything after this point is what `installRuntimePacks` does per pack,
 * minus the loop: the same duplicate-id skip, the same registry, the same
 * store write, the same base announcement and prefetch — and, on a real
 * (non-skipped) install, the same `markDefaultPackSeeded()` this file's own
 * header explains under "two writers of the installed list".
 */
export async function installPackNow(
  manifestUrl: string,
  manifest: RuntimePackManifest
): Promise<PackInstallOutcome> {
  try {
    const registry = contentRegistry();
    if (registry.hasPack(manifest.id)) {
      return { manifestUrl, ok: true, id: manifest.id, skipped: true };
    }
    const pack = await loadPackFromManifest(manifest, manifestUrl);
    installRuntimePack(registry, buildContentApi(), pack);

    const stored = readInstalledPacks();
    // A plain loop, not `.filter` — see CLAUDE.md.
    const next: InstalledPackRecord[] = [];
    for (const record of stored) {
      if (record.manifestUrl !== manifestUrl) next.push(record);
    }
    next.push(recordFor(manifestUrl, manifest));
    writeInstalledPacks(next);
    // The player has just made their own choice of pack, by URL — the
    // automatic offer this flag guards is spent either way. Without this,
    // a browser whose first boot could not reach `DEFAULT_PACK_URL` (the
    // flag stays `false` — see this file's own header) installs a pack by
    // hand, later removes it, and the next boot re-seeds a default the
    // player never asked for: `installRuntimePacks()` sees an empty stored
    // list and an unset flag and reads that exactly like a browser that has
    // never run this game. See `installedPackStore.ts`'s own header —
    // "Seeding the default on both makes an uninstall impossible to keep."
    // `installRuntimePacks()` is the other writer of the installed list and
    // marks this same flag on its own successful seed; this is the second.
    markDefaultPackSeeded();

    const base = packBaseFor(manifestUrl);
    if (base) {
      // Every base, not just this one: the message replaces the worker's whole
      // list, so sending one would drop the packs installed at boot.
      const bases: string[] = [];
      for (const record of next) {
        const recordBase = packBaseFor(record.manifestUrl);
        if (recordBase) bases.push(recordBase);
      }
      announcePackBases(bases);
      if (manifest.files && manifest.files.length > 0) {
        void prefetchPackFiles(base, manifest.files).catch(() => {});
      }
    }
    return { manifestUrl, ok: true, id: manifest.id, icon: resolvePackIcon(manifest, manifestUrl) };
  } catch (thrown) {
    const error = thrown as PackLoadError;
    return { manifestUrl, ok: false, stage: error.stage ?? 'import', message: error.message };
  }
}

/**
 * What the background prefetch did, on a global.
 *
 * Same reasoning as `packBanner.ts`'s `__lol2dPackInstall`, and the same bill
 * already paid once: an install whose only voice was `console.warn` reported
 * itself green through a Playwright run that had no way to hear it. An
 * offline check in particular cannot be written at all without a signal for
 * "the prefetch has finished" — the alternative is a sleep, which is a check
 * that passes on a slow machine by accident.
 */
const PACK_PREFETCH_GLOBAL = '__lol2dPackPrefetch';

function publishPrefetchReports(reports: PrefetchReport[]): void {
  (globalThis as Record<string, unknown>)[PACK_PREFETCH_GLOBAL] = reports;
}
