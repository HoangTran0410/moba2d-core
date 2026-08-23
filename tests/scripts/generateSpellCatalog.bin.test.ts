import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(root, 'node_modules/.bin/moba2d-generate-spell-catalog');

/**
 * `scripts/generate-spell-catalog.mjs`'s self-invoke guard used to compare
 * `process.argv[1]` against `import.meta.url` with a bare `resolve()`. That
 * comparison silently fails when the file is reached through the
 * npm-managed `node_modules/.bin/` symlink `package.json`'s `bin` field
 * creates: Node resolves `import.meta.url` (this file's `scriptPath`) to
 * the symlink's real target, but leaves `process.argv[1]` as the symlink
 * path itself, so the two never compare equal — the CLI block silently
 * never runs, and the process exits 0 having done nothing. Confirmed by
 * hand against `scripts/check-seams.mjs`'s own bin (`moba2d-check-seams`),
 * which still uses the bare comparison and reproduces exactly this: no
 * output, exit 0, on a real target.
 *
 * A plain function import (`tests/scripts/generateSpellCatalog.tree.test.ts`)
 * cannot see this class of bug — it never goes through the bin symlink at
 * all. Only running the actual installed bin as a subprocess can, so that
 * is what this file does.
 */
describe('moba2d-generate-spell-catalog bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  /**
   * `--tree=does-not-exist` with no `--root` is the fast, discriminating
   * case: that branch reports and sets `process.exitCode = 1` before ever
   * booting the Vite server `generateSpellCatalog` needs, so this proves
   * the CLI block actually executed without paying for a real catalogue
   * build. The silent-no-op bug exits 0 on every input, including this one
   * — it can't fake a report it never reads the arguments to produce.
   *
   * Content-pack-extraction batch 6 task 9 removed the "unknown spell tree"
   * message this test used to assert on: it named the tree against a
   * `PACK_SPELL_TREES` table this file no longer has, since a named tree's
   * shape now lives beside it in its own `catalog.config.mjs` (see that
   * script's header, "Fix round 2") rather than in a registry here. There
   * is nothing left to be "unknown" against — a `--tree=` with no `--root`
   * still fails fast, on the same missing-argument message any tree name
   * gets, `does-not-exist` included.
   */
  it('reports a missing --root when invoked through its bin symlink, proving the CLI block ran', () => {
    const result = spawnSync(bin, ['--check', '--tree=does-not-exist'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--root=<path>/);
  });

  /**
   * The brief's other stated requirement for this CLI ("errors with a
   * message naming the missing file when `--tree` is passed without one")
   * had no covering test: the case above never reaches
   * `existsSync(configPath)` at all, since it fails earlier on the missing
   * `--root`. This is the branch that does — `--root` names a real,
   * existing, but empty directory, so the script gets all the way to
   * looking for `catalog.config.mjs` there and finds nothing. A typo in
   * `CATALOG_CONFIG_FILENAME` would pass every other test in this suite
   * (`generateSpellCatalog.siblingRepo.test.ts` only ever points `--root`
   * at a directory that *does* have the file) and only this one would
   * catch it.
   */
  it('reports a missing catalog.config.mjs, naming the exact path, when --root has none', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'lol2d-no-catalog-config-'));
    try {
      const result = spawnSync(bin, ['--check', '--tree=riot', `--root=${emptyRoot}`], {
        cwd: root,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      // Not a bare `toContain(join(emptyRoot, 'catalog.config.mjs'))`: that
      // substring is also present inside a *longer*, wrong filename (a
      // `CATALOG_CONFIG_FILENAME` typo'd to `catalog.config.mjss` still
      // "contains" the correct name), which is exactly the failure mode
      // this test exists to catch — proven by planting that typo, seeing
      // this assertion alone stay green, tightening it to the path
      // immediately followed by the message's own next token, and seeing
      // the typo fail here again. Pinning the boundary this way is what
      // makes the check exact rather than a prefix match.
      expect(result.stderr).toContain(`${join(emptyRoot, 'catalog.config.mjs')} —`);
      // The message names the *file it's missing*, never the pack that was
      // asking for it — content-pack-extraction batch 6 task 9's own point,
      // and the bug its first draft actually shipped (fixed before commit).
      expect(result.stderr).not.toMatch(/packs\/riot/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
