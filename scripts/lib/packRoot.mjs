/**
 * `packRootFrom(cwd)` — the "no hardcoded pack name" rule made mechanical.
 *
 * Walks up from `cwd` to the nearest `package.json` that names
 * `@moba2d/core` as a dependency or devDependency — never by counting `..`
 * segments to a fixed depth, and never by looking for a directory called
 * `packs`. `packs/riot/tests/support/packRoot.ts` is the working prior
 * art this is ported from: two of that pack's own tests used to climb a
 * fixed number of `__dirname` levels and land back on a hardcoded
 * `packs/riot` literal, which only ever resolved inside this monorepo's
 * own layout — a genuinely separated pack repository has no `packs/riot`
 * segment anywhere in its checkout, and neither does a copy of one running
 * inside `verify:pack-standalone`'s own hermetic sandbox. Deriving the
 * root instead of climbing to it is what makes `moba2d-pack-add` work
 * identically from a nested directory inside the pack, from the pack's own
 * root, and from a real separated repository — the same anchor this file's
 * own two callers (`pack-add.mjs`, and any future `pack-add`-adjacent
 * tool) all need.
 *
 * Throws rather than silently walking to the filesystem root and stopping
 * there: a caller run somewhere with no such `package.json` above it — most
 * notably core's own repository root, whose `package.json` names itself
 * `@moba2d/core` rather than depending on it — should fail loudly with a
 * next step, not resolve to an unrelated directory that happens to have a
 * `package.json` in it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function packRootFrom(cwd) {
  let dir = resolve(cwd);
  while (true) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        manifest = {};
      }
      if (
        '@moba2d/core' in (manifest.dependencies ?? {}) ||
        '@moba2d/core' in (manifest.devDependencies ?? {})
      ) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `no package.json naming "@moba2d/core" as a dependency was found walking up from ${cwd}.\n\n` +
          '  Run this from inside a pack scaffolded by `moba2d-pack-new`, or add\n' +
          '  "@moba2d/core" to the devDependencies of a package.json above this directory first.\n'
      );
    }
    dir = parent;
  }
}
