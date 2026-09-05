import type { SeamCheck, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';
import { parse, propertyWrites } from './ast';

/**
 * Nobody may assign `onUpdate` onto a `Dash` (or any buff that implements its
 * own). `Buff.update()` calls `this.onUpdate()`, and `Dash` implements the
 * movement in `Dash.prototype.onUpdate`; an instance assignment shadows the
 * prototype, so what looks like a per-frame callback silently deletes the
 * step towards the destination. Use `onDashUpdate`, which the base calls.
 *
 * See `tests/game/spells/dash-onupdate-seam.test.ts` for the shipped
 * examples (three separate dash spells across three champions) and the behavioural half that proves
 * `onDashUpdate` still moves the champion.
 */
/**
 * Parsed, not matched. The regex this replaced was `/\b\w+\.onUpdate\s*=/g`,
 * and given four ways to write the banned assignment it caught **one**:
 *
 *   dash['onUpdate'] = () => {};          // missed — bracket access
 *   Object.assign(dash, { onUpdate });    // missed — never an `=` at all
 *   dash                                  // missed — the newline broke `\b\w+\.`
 *     .onUpdate = () => {};
 *   target.onUpdate = () => {};           // caught
 *
 * Only the last is what anyone would type on purpose; the third is what a
 * formatter does to a long line, and the second is an ordinary idiom. A ban
 * three quarters of the language can walk around is a ban that reads as
 * enforced and is not — which for this rule means a champion that stands
 * perfectly still while its spell runs, the exact bug three shipped spells
 * had. `propertyWrites` sees all four because it is looking at the tree.
 */
export const checkDashOnUpdate: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const writes = propertyWrites(parse(readSource(root, file), file), 'onUpdate');
    if (writes.length > 0) {
      violations.push({
        file,
        message: writes.map(write => `${write.text} (line ${write.line})`).join(', '),
      });
    }
  }
  return violations;
};
