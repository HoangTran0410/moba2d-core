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
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
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
 * `[{ name, target }]`, sorted by name — empty in every ordinary checkout,
 * which is the answer the callers act on.
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
  const scope = join(root, 'node_modules', SCOPE);
  if (!existsSync(scope)) return [];

  const linked = [];
  for (const entry of readdirSync(scope)) {
    if (!entry.startsWith(PACKAGE_PREFIX)) continue;
    const path = join(scope, entry);
    let target;
    try {
      if (!lstatSync(path).isSymbolicLink()) continue;
      target = realpathSync(path);
    } catch {
      // A dangling link is not a pack anyone is developing against — it is a
      // pack that is simply gone, which `packs:check` already reports in its
      // own words.
      continue;
    }
    // Compared on the *resolved* core root: this file is reached through
    // `node_modules/.bin` and through a worktree, and a bare string prefix on
    // an unresolved path answers "inside" wrongly in both.
    const insideCheckout = target === root || target.startsWith(root + sep);
    if (insideCheckout) continue;
    linked.push({ name: entry.slice(PACKAGE_PREFIX.length), target });
  }
  return linked.sort((a, b) => a.name.localeCompare(b.name));
}
