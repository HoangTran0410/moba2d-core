import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { codeOnly, parsePinnedLine, pinnedLineFor, readSource, walkTsFiles } from './shared';

/**
 * Current health and current mana are resources, not stats. `Stats` exposes
 * them as `Stat` objects so the health bar can read one number, but
 * everything that legitimately moves them writes `baseValue` directly.
 * Nothing moves them through the modifier pipeline — a bonus on `health:` or
 * `mana:` changes the number the bar reads while leaving the pool the game
 * actually spends untouched.
 *
 * Enforced by `moba2d-check-seams`, which every pack runs over its own
 * tree and core runs over its own; the rule itself is unit-tested in
 * `tests/seams/exported-seams.test.ts`. The hand-written scan this
 * comment used to name was deleted once the CLI covered the same
 * population from the side that owns it.
 */
const RESOURCE_AS_STAT = /(?<![A-Za-z])(?:health|mana)\s*:\s*\{/;

export interface StatResourceModifierOptions extends SeamCheckOptions {
  /**
   * Known lines that shape `health:`/`mana:` as a plain object for a reason
   * this rule cannot see — `"<file>:<1-indexed line>:<the line's own code,
   * trimmed>"`, the same shape `manaSpend.ts`'s `pinnedManaLines` uses and
   * checked by the same `pinnedLineFor` (`shared.ts`): the two seams key
   * their violations identically (a line, not a file or a class), so this
   * is the closer template of the three exemption shapes this module's
   * siblings use (`grandfatheredTests`, `noPressOverride`,
   * `grandfatheredFogReads`).
   *
   * Content-pack-extraction batch 6 task 6, fix round 2 of the task's own
   * review: before this field existed, a pack test file constructing a
   * plain `{ mana: {...}, health: { value } }`-shaped stats double — a
   * fixture, never a `Buff`'s bonus config — had no way to satisfy this
   * seam except whole-file `skip`, which also blinds every *other* seam to
   * the same file. `skip` cannot see which seam a file needs exempting
   * from; a per-line field can.
   */
  pinnedResourceLines?: Set<string>;
}

export const checkStatResourceModifier: SeamCheckOf<StatResourceModifierOptions> = (
  root,
  options
) => {
  const pinnedResourceLines = options?.pinnedResourceLines ?? new Set<string>();
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    const lines = readSource(root, file).split('\n');
    lines.forEach((line, index) => {
      const code = codeOnly(line);
      if (!RESOURCE_AS_STAT.test(code)) return;
      // Computed regardless of the exemption: the exemption's own staleness
      // depends on knowing whether it would have mattered.
      const entry = pinnedLineFor(pinnedResourceLines, file, index + 1, line);
      if (entry !== undefined) {
        consumed.add(entry);
      } else {
        violations.push({ file, message: `${index + 1}: ${line.trim()}` });
      }
    });
  }

  for (const entry of pinnedResourceLines) {
    if (consumed.has(entry)) continue;
    violations.push({
      file: entry,
      message:
        parsePinnedLine(entry) === null
          ? 'pinnedResourceLines exemption is not a "<file>:<line>:<code>" entry, so it can never match a line'
          : 'pinnedResourceLines exemption matched no scanned line shaping health:/mana: as a plain stat',
      kind: 'stale-exemption',
    });
  }

  return violations;
};
