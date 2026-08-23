/**
 * Moves every optional content pack out of `packs/`, and back, safely.
 *
 * Extracted from `scripts/verify-without-packs.mjs`, which used to carry
 * this logic inline as its own `depart()`/`restore()`/`cleanup()`. Content-
 * pack-and-repo-split batch 6 task 7's own standalone drill
 * (`verify-pack-standalone.mjs`) needed the identical move — pack core the
 * way it will actually ship, with no optional pack in the tree, before
 * `npm pack` — and hand-rolling a second mover was rejected on sight: this
 * file's own restore/cleanup pair carries a rule that was learned the hard
 * way and must not be re-learned by a second implementation.
 *
 * ## The bug this machinery exists to prevent
 *
 * An earlier version of `cleanup()` printed "left at `<path>`" on a failed
 * restore — telling the reader their content was safe — and then fell
 * through to a recursive delete that removed both the moved pack and its own
 * safety copy. `cleanup()` below refuses to delete anything while `stranded`
 * is non-empty, and even then uses `rmdirSync`, which throws on a non-empty
 * directory rather than trusting a comment above it to keep that true.
 *
 * ## What one call gets
 *
 * `createPackDeparture(root)` returns one `depart()`/`restore()`/`cleanup()`
 * unit, scoped to the optional packs `root` currently has installed
 * (`optionalContentPackages`, not a name typed here — the same derivation
 * `generate-installed-packs.mjs` and `check-chunks.mjs` already read, so a
 * third or fourth pack is swept up the same way `riot` is today). Callers
 * are expected to create exactly one per run: `moved`/`stranded` are private
 * state closed over by the three returned functions, not shared across
 * calls.
 *
 * `depart()` copies every departing pack to a safety directory first, and
 * only then renames it out of `packs/` — a rename that half-completes is
 * recoverable, a process killed between the rename and the restore is not,
 * and the pack is not this module's to lose. `restore()` puts every moved
 * pack back and deletes nothing; a pack it cannot restore lands in
 * `stranded` and stays there. `cleanup()` is the only function that deletes,
 * and only once `stranded` is empty.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { optionalContentPackages } from '../installed-packs.mjs';

export function createPackDeparture(root) {
  const DEPARTING = optionalContentPackages(root).map(pack => pack.name);

  /**
   * Outside the tree, and outside every glob that reads it — `packs/*` in
   * `package.json`'s `workspaces`, `src/**` in `tsconfig.json`, Vitest's own
   * default include. A sibling of the checkout is the cheapest place that is
   * certainly on the same filesystem, so the move is a rename rather than a
   * copy of a few hundred images.
   */
  const departureDir = join(dirname(root), `.${basename(root)}-pack-departure`);

  /**
   * A byte-for-byte copy taken before anything moves, inside the departure
   * directory. Removed by `cleanup()` only once every pack is verifiably
   * back in `packs/`.
   */
  const safetyDir = join(departureDir, '.safety-copy');

  /**
   * Packs that could not be put back. **While this is non-empty nothing is
   * deleted** — see this file's own header for the bug that rule exists for.
   */
  const stranded = [];

  let moved = [];

  function depart() {
    mkdirSync(departureDir, { recursive: true });
    mkdirSync(safetyDir, { recursive: true });
    for (const name of DEPARTING) {
      cpSync(join(root, 'packs', name), join(safetyDir, name), { recursive: true });
    }
    console.log(`safety copy at ${safetyDir}`);
    for (const name of DEPARTING) {
      const from = join(root, 'packs', name);
      const to = join(departureDir, name);
      if (!existsSync(from)) throw new Error(`packs/${name} is not here to move`);
      if (existsSync(to)) {
        throw new Error(`${to} already exists — a previous drill did not restore`);
      }
      renameSync(from, to);
      moved.push(name);
      console.log(`moved packs/${name} -> ${to}`);
    }
  }

  /**
   * Puts every moved pack back, and **removes nothing**. A pack it cannot
   * put back is recorded in `stranded`; `cleanup()` is the only thing that
   * deletes, and it refuses to while that list has anything in it.
   */
  function restore() {
    for (const name of moved) {
      const from = join(departureDir, name);
      const to = join(root, 'packs', name);
      if (!existsSync(from)) {
        console.error(`CANNOT RESTORE packs/${name}: ${from} is gone`);
        stranded.push(name);
        continue;
      }
      if (existsSync(to)) {
        // Something recreated the directory while the pack was away. Keep
        // both rather than clobbering either; a human decides.
        console.error(`CANNOT RESTORE packs/${name}: ${to} exists again`);
        stranded.push(name);
        continue;
      }
      renameSync(from, to);
      console.log(`restored packs/${name}`);
    }
    moved = [];
  }

  /**
   * The only function here that deletes anything, and it deletes only when
   * every pack is demonstrably back in the tree.
   *
   * Two guards, because one of them was the bug. First: `stranded`
   * non-empty means the pack is still out here, so nothing goes — the run
   * says where both copies are and stops. Second: `rmdirSync`, never
   * `rmSync(..., { recursive: true })`. `rmdirSync` fails with `ENOTEMPTY`
   * on a directory that still holds anything, which makes "only if it is
   * empty" a property of the call rather than of a comment above it.
   */
  function cleanup() {
    if (stranded.length) {
      const rule = '!'.repeat(74);
      console.error(`\n${rule}`);
      console.error('THE PACK IS NOT BACK IN THE TREE. Nothing has been deleted.');
      for (const name of stranded) {
        console.error(`  packs/${name} is at   ${join(departureDir, name)}`);
        console.error(`  a second copy is at   ${join(safetyDir, name)}`);
      }
      console.error('');
      console.error('Deal with whatever is sitting at packs/<name> now, then move the first');
      console.error('path back by hand. The second is a byte-for-byte duplicate taken before');
      console.error('anything moved, in case the first is somehow damaged. Delete neither');
      console.error('until `packs/` is right.');
      console.error(`${rule}\n`);
      return;
    }
    // Every pack is back, so the safety copy is now a duplicate of live
    // content and is the one thing left in here.
    rmSync(safetyDir, { recursive: true, force: true });
    try {
      rmdirSync(departureDir);
    } catch (error) {
      console.error(
        `left ${departureDir} in place (${error.code ?? error.message}) — something is in it ` +
          'that this module did not put there; look before you remove it'
      );
    }
  }

  return {
    DEPARTING,
    departureDir,
    safetyDir,
    stranded,
    depart,
    restore,
    cleanup,
    get moved() {
      return moved;
    },
  };
}
