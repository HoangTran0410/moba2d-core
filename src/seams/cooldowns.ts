import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';
import { constantsOf, numericValueOf, parse, propertyValues } from './ast';

/**
 * A tuning ceiling: no spell's numeric cooldown may exceed the match's
 * intended pace. Ten seconds is this game's own arcade boundary; a pack that
 * wants a different pace passes its own `maxMs`.
 *
 * See `tests/seams/exported-seams.test.ts`.
 */
export interface CooldownsOptions extends SeamCheckOptions {
  maxMs?: number;
}

/**
 * Parsed, because the regex this replaced only ever saw a bare number.
 *
 * `/coolDown\s*=\s*([\d_]+)/` matched `coolDown = 12000` and nothing else — so
 * of the 386 cooldowns the three packs set, it read 251 and was blind to
 * **135**, every one of them a named constant (`COOLDOWN_MS`, `R_COOLDOWN_MS`).
 * The ceiling therefore applied to spells that wrote a magic number inline and
 * exempted the ones written the better way, which is precisely backwards.
 *
 * Constants declared in the file are followed, and so is arithmetic on them:
 * `8 * SECOND` is a cooldown, not an unknown.
 */
export const checkCooldowns: SeamCheckOf<CooldownsOptions> = (root, options) => {
  const maxMs = options?.maxMs ?? 10_000;
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    const sourceFile = parse(readSource(root, file), file);
    const constants = constantsOf(sourceFile);
    for (const { expression, line } of propertyValues(sourceFile, 'coolDown')) {
      const milliseconds = numericValueOf(expression, constants);
      if (milliseconds !== null && milliseconds > maxMs) {
        violations.push({
          file,
          message: `coolDown ${milliseconds}ms exceeds ${maxMs}ms (line ${line})`,
        });
      }
    }
  }
  return violations;
};
