import type { SeamCheckOf, SeamCheckOptions, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';
import { constantsOf, numericValueOf, parse, propertyValues } from './ast';

/**
 * A tuning ceiling: no spell's numeric cooldown may exceed the match's
 * intended pace. **Twenty seconds** is this game's own boundary, and the
 * reason is what the game *is*: a practice room. Nobody comes to a phòng tập
 * to stand still for most of a minute waiting for the ability they came to
 * practise, so a cooldown long enough to end the rehearsal is a bug in the
 * rehearsal even when it is faithful to whatever it was modelled on. A pack
 * that wants a different pace passes its own `maxMs`.
 *
 * It was ten, and enforced against 251 of 386 cooldowns — the regex it used
 * could only see a bare number, so every cooldown written as a named constant
 * was exempt. Parsing them all made the real distribution visible for the
 * first time, and twenty is where the line went once it could be drawn
 * honestly.
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
  const maxMs = options?.maxMs ?? 20_000;
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
