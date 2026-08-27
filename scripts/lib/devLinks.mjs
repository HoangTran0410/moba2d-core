/**
 * Which content packs are linked into this checkout **from outside it**.
 *
 * The one question `npm run pack:link` makes answerable, and the one thing
 * that must never reach a commit. Linking rewrites
 * `src/generated/installedPacks.ts` — a tracked file — to import a package
 * that exists only on the machine that ran the link. Committed by accident,
 * the next person to clone core gets `TS2307: Cannot find module
 * '@moba2d/content-lol/pack'` about a package they have never heard of.
 *
 * ## Why "outside", and not a list of names
 *
 * `node_modules/@moba2d/content-reference` is a symlink too — npm's own
 * workspace link, into `packs/reference` inside this repository. That one is
 * an ordinary committed fact about the checkout. The difference is not the
 * name (a name list got the reference pack right by luck and would get the
 * next in-tree pack wrong) and not "is it a symlink": it is **where the link
 * points**. Inside the checkout is repository state; outside it is one
 * person's working state.
 *
 * Sync, and dependency-free, because both callers need it that way:
 * `vitest.config.ts` reads it while building a config object, and
 * `scripts/pack-link.mjs --check` is the first thing `npm run verify` runs.
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const SCOPE = '@moba2d';
const PACKAGE_PREFIX = 'content-';

/** The real path, or the path as given when it does not exist yet. */
const realpathOr = path => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * `[{ name, target, missing }]`, sorted by name — empty in every ordinary
 * checkout, which is the answer the callers act on. `missing` is a link whose
 * target is gone; `target` is then where it *meant* to point.
 *
 * ## A dangling link is still a link, and it used to be reported as nothing
 *
 * This function skipped one, on the reasoning that a pack whose directory is
 * gone is not a pack anyone is developing against. That is true and beside the
 * point: the link is still there, `src/generated/installedPacks.ts` still names
 * the package, and nothing can resolve it. Met in practice by renaming a
 * sibling checkout — `moba2d-content-riot` to `lol` — after which:
 *
 *   - `links:check` printed *"links ok: no pack is linked for development"*,
 *     which is the one line in the whole gate whose job is to notice;
 *   - `packs:check`, one step later in `verify`, did stop the run — but with
 *     *"installed packs are [reference]. Run `npm run packs:generate`"*, whose
 *     advice silently **drops** the pack rather than saying a directory moved;
 *   - and running `npx vitest` directly, which has no gate in front of it,
 *     failed every single test file to collect with `Failed to load url
 *     @moba2d/content-lol/pack`.
 *
 * Three answers, none of them "your link points at a directory that no longer
 * exists". Reporting it is what lets `pack-link.mjs --check` say that, and what
 * lets `pack:unlink -- --all` clean it up — it could not, because `--all` asks
 * this same function what to unlink.
 */
export function devLinkedPacks(coreRoot) {
  // `realpathSync` on the root as well as on the link, or the comparison
  // below is answered by an alias rather than by a location. macOS is where
  // this shows up first and hardest: `/var` is itself a symlink to
  // `/private/var`, so a checkout under a temporary directory resolves its
  // *links* to `/private/var/...` while the root stays `/var/...`, and every
  // in-tree link reads as "outside the checkout". A worktree, a home
  // directory behind an automounter, and a `~/Code` symlinked onto another
  // volume all do the same thing more quietly.
  const root = realpathOr(resolve(coreRoot));
  // The same root *unresolved*, and it earns its place on the dangling path
  // only. A live link's target comes back from `realpathSync` and is directly
  // comparable to `root`; a dangling one cannot be resolved at all — there is
  // nothing on disk to resolve — so it keeps whatever spelling it was written
  // with, and on macOS that is `/var/…` against a root of `/private/var/…`.
  // Comparing both spellings is what keeps a broken *in-tree* link (a deleted
  // `packs/…`) from being reported as somebody's dev link. Found by a test
  // that asserted exactly that and got the dangling link back.
  const rootAsGiven = resolve(coreRoot);
  const scope = join(root, 'node_modules', SCOPE);
  if (!existsSync(scope)) return [];

  const linked = [];
  for (const entry of readdirSync(scope)) {
    if (!entry.startsWith(PACKAGE_PREFIX)) continue;
    const path = join(scope, entry);
    let target;
    let missing = false;
    try {
      if (!lstatSync(path).isSymbolicLink()) continue;
    } catch {
      // Vanished between the readdir and the stat. Nothing to report.
      continue;
    }
    try {
      target = realpathSync(path);
    } catch {
      // Dangling — see the header. `readlinkSync` gives the link's own text,
      // which npm writes *relative* for its workspace links, so it is resolved
      // against the directory holding the link rather than the cwd.
      try {
        target = resolve(scope, readlinkSync(path));
        missing = true;
      } catch {
        continue;
      }
    }
    // Compared on the *resolved* core root: this file is reached through
    // `node_modules/.bin` and through a worktree, and a bare string prefix on
    // an unresolved path answers "inside" wrongly in both.
    //
    // Applied to a dangling link too, and deliberately: a broken link pointing
    // *inside* the checkout is a repository problem (a deleted `packs/…`), not
    // one person's working state, and it is not this function's question.
    const insideCheckout = [root, rootAsGiven].some(
      base => target === base || target.startsWith(base + sep)
    );
    if (insideCheckout) continue;
    linked.push({ name: entry.slice(PACKAGE_PREFIX.length), target, missing });
  }
  return linked.sort((a, b) => a.name.localeCompare(b.name));
}
