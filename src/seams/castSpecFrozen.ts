import type ts from 'typescript';
import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { exemptionFor, readSource, walkTsFiles } from './shared';
import { getAccessorsNamed, parse, thisPropertyReads } from './ast';

/**
 * `castSpec` is read once, on the first cast, and never again — `Spell.runtime`
 * is a lazy getter that freezes whatever `castSpec` returned on the opening
 * press. A getter that computes any of it from live state therefore describes
 * the spell as it was on the opening press, for the rest of the match.
 *
 * See `tests/seams/exported-seams.test.ts` for the worked example
 * (a four-round recast ultimate computing its recast cooldown from `shotsRemaining`).
 */
export interface CastSpecFrozenOptions extends SeamCheckOptions {
  /**
   * Spells known to still read live state — debt, not permission. An entry
   * names a file: either its path relative to the scanned root, or its bare
   * basename, which matches at any depth (`exemptionFor` in `shared.ts` —
   * one keying rule for every exemption set in this module since fix round
   * 4, after a nested file made a live entry report as stale).
   */
  grandfathered?: Set<string>;
}

/**
 * Fields that genuinely do not change over a spell's life, so reading them in
 * the getter says the same thing on every read.
 */
const CONSTANT_FIELDS = new Set([
  'coolDown',
  'owner',
  'game',
  'image',
  'range',
  'manaCost',
  'healthCost',
  'targetingMode',
  'name',
]);

/**
 * Parsed, not matched. This used to find the getter's own body with a
 * regex opener plus hand-rolled brace counting, then scan that text with
 * `/\bthis\.(\w+)/g`. Both steps were text, and both had a hole:
 *
 *   class First extends Spell {
 *     get castSpec() { return { cooldown: { durationMs: this.coolDown } }; }
 *   }
 *   class Second extends Spell {
 *     get castSpec() { return { cooldown: { durationMs: this.shotsRemaining } }; }
 *   }
 *
 * The opener regex is `.exec`'d once, so only `First`'s getter was ever
 * found — `Second`'s live read was invisible however carefully the *inner*
 * regex was written, because the outer step never handed it that text.
 * Even granted the right getter, the brace counter has no idea a `{` or `}`
 * can sit inside a string: a `castSpec` returning `{ name: "}", ... }`
 * closes the counted body on the character inside the quotes, and whatever
 * came after — including the live-state read this rule exists to catch —
 * was silently never scanned. And the inner regex itself missed bracket
 * access (`this['shotsRemaining']`), a line break or `?.` between `this`
 * and the dot, and a destructured `const { shotsRemaining } = this;`, which
 * never puts the substring `this.shotsRemaining` in the source at all.
 *
 * `getAccessorsNamed` finds every `castSpec` getter in the file by walking
 * the tree, not the first one a regex happens to match, and
 * `thisPropertyReads` sees all four spellings of a read because it asks
 * what a node's object part is, the same question `propertyWrites` and
 * `methodCalls` ask for an assignment and a call.
 */
function liveStateReadsOf(sourceFile: ts.SourceFile): string[] {
  const seen = new Set<string>();
  for (const accessor of getAccessorsNamed(sourceFile, 'castSpec')) {
    if (!accessor.body) continue;
    for (const field of thisPropertyReads(accessor.body)) {
      if (!CONSTANT_FIELDS.has(field)) seen.add(field);
    }
  }
  return [...seen].sort().map(field => `this.${field}`);
}

export const checkCastSpecFrozen: SeamCheckOf<CastSpecFrozenOptions> = (root, options) => {
  const grandfathered = options?.grandfathered ?? new Set<string>();
  // Which declared `grandfathered` entries actually suppressed a real
  // would-be violation this run — the rest are stale (fix round 3).
  const consumed = new Set<string>();
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    // Computed regardless of the exemption, unlike the old `if
    // (grandfathered.has(file)) continue;` short-circuit — the exemption's
    // own staleness depends on knowing whether it would have mattered.
    const reads = liveStateReadsOf(parse(readSource(root, file), file));
    if (reads.length === 0) continue;

    const exemption = exemptionFor(grandfathered, file);
    if (exemption !== undefined) {
      consumed.add(exemption);
    } else {
      violations.push({ file, message: reads.join(', ') });
    }
  }

  for (const entry of grandfathered) {
    if (!consumed.has(entry)) {
      violations.push({
        file: entry,
        // Says only what the scan actually observed. The previous wording
        // named three causes ("no longer reads live state, has no castSpec
        // getter, or does not exist") and fix round 4's reproduction hit a
        // case where all three were false — the file existed, had a getter
        // and read live state, and the entry was mis-keyed. A message that
        // lists causes it has not checked sends the reader hunting.
        message: 'grandfathered exemption matched no scanned file whose castSpec reads live state',
        kind: 'stale-exemption',
      });
    }
  }

  return violations;
};
