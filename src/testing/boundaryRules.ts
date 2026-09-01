import { describe, expect, it } from 'vitest';
import { checkPackCoreBoundary } from '@/seams/packCoreBoundary';
import { scannedSeamFiles } from '@/seams/index';

/**
 * `@moba2d/core/testing/boundary` — "this pack reaches core only through the
 * api", asserted by the pack's own test suite.
 *
 * ## Why it is here and not in each pack
 *
 * The *rule* has always been core's: `src/seams/packCoreBoundary.ts`, run by
 * `moba2d-check-seams`. What was in a pack was a ten-line caller, in one pack,
 * which meant the other pack's `npm test` said nothing about the rule at all —
 * the same shape `testing/items` and `testing/maps` were extracted for, and for
 * the same reason: a rule that is a fact about *core* belongs where core keeps
 * it, or the packs drift apart on it one copy at a time.
 *
 * ## Why a pack's test suite runs it when `check-seams` already does
 *
 * Because of the one thing TypeScript structurally cannot do here.
 *
 * A pack's `tsconfig.json` has to publish core's own `@/*` alias: core ships as
 * *unbundled source*, and each of its exported entry points imports its
 * neighbours that way — seventy-two such imports in `ContentApi.ts` alone. But
 * `paths` is a program-wide mapping with no notion of which file is asking, so
 * an alias that must resolve for core's files resolves for the pack's too.
 * Measured, not reasoned about: with
 * `import BuffAddType from '@/game/enums/BuffAddType'` planted in a spell, the
 * pack's `npm run typecheck` exits 0 and the editor underlines nothing.
 *
 * `check-seams` catches it. But that is not the command anyone runs while
 * writing a spell, so the first anyone hears of the rule is the gate — and the
 * fix is at the top of a file they finished with an hour ago. `npm test` is the
 * command, so `npm test` should say it.
 */

export interface CoreBoundaryFixture {
  /**
   * The pack's own root — the directory its `package.json` sits in, which is
   * the scope the rule is about. `resolve(__dirname, '..')` from a test in
   * `tests/`.
   */
  packRoot: string;
  /**
   * Fewest `.ts` files that must be found, below which the suite is treated as
   * looking at the wrong directory. A scan that walks nothing passes every rule
   * it has; this is the guard that keeps "clean" from meaning "empty".
   */
  minimumFiles?: number;
  /** A name for the suite, so a repository with several packs says which one. */
  label?: string;
}

/**
 * Registers the shared suite. Call it at the top level of the pack's own
 * boundary test.
 */
export function describeCoreBoundary(fixture: CoreBoundaryFixture): void {
  const { packRoot, minimumFiles = 20, label } = fixture;

  describe(label ? `${label}: how this pack reaches core` : 'how this pack reaches core', () => {
    it('found files to check, or every rule below is vacuous', () => {
      // Counted through the seam machinery's own walker, never a hand-rolled
      // one. A plain recursive walk of a pack root descends the
      // `@moba2d/core` <-> pack workspace symlink loop until the path is too
      // long for `stat`; `walkTsFiles` skips `node_modules` and does not follow
      // a symlinked directory, which is the reason it exists.
      expect(scannedSeamFiles(packRoot).length).toBeGreaterThanOrEqual(minimumFiles);
    });

    it('names no core internal — the api and core’s declared subpaths, nothing else', () => {
      const report = checkPackCoreBoundary(packRoot)
        .map(violation => `${violation.file}: ${violation.message}`)
        .join('\n');
      expect(report, report).toBe('');
    });
  });
}
