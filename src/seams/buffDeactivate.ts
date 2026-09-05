import ts from 'typescript';
import type { SeamCheck, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';
import { methodCalls, parse } from './ast';

/**
 * `Buff` has exactly one way to end: `deactivateBuff()`. There is no
 * `Buff.deactivate()` — `deactivate()` is a *`Spell`* method, and `Spell`
 * subclasses call `super.deactivate()` all over a content tree, which is
 * what makes the wrong one so easy to reach for. Both typecheck: the buff
 * arrays a spell walks are loosely typed, so `tsc` never sees the call.
 *
 * See `tests/seams/exported-seams.test.ts` for the shipped
 * examples (a stealth cloak and a self-heal-over-time ultimate).
 */
/**
 * Parsed, not matched. The regex this replaced was
 * `/([A-Za-z_$][\w$]*)\s*\??\.deactivate\(\)/g`, run line by line, and it
 * requires a bare identifier sitting immediately before the dot. Given a
 * handful of ordinary ways to write the same call, it caught two of six:
 *
 *   someBuff.deactivate();                 // caught
 *   someBuff?.deactivate();                // caught
 *   someBuff
 *     .deactivate();                       // missed — no identifier on this line
 *   someBuff['deactivate']();              // missed — bracket access
 *   (someBuff as Buff).deactivate();       // missed — receiver is a cast, not a name
 *   this.getBuff().deactivate();           // missed — receiver is a call, not a name
 *
 * The middle three are not devious: a formatter breaks a long chain across
 * lines on its own, a cast is how a loosely-typed buff array gets narrowed
 * before calling a method on it, and a getter returning a buff is an
 * ordinary thing to write. `methodCalls` sees all six because it is asking
 * "what is the callee's object part," not "what identifier sits before the
 * dot."
 */
const isSpellReceiver = (receiver: ts.Expression, sourceFile: ts.SourceFile): boolean =>
  receiver.kind === ts.SyntaxKind.SuperKeyword || /spell/i.test(receiver.getText(sourceFile));

export const checkBuffDeactivate: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  for (const file of walkTsFiles(root, options)) {
    const sourceFile = parse(readSource(root, file), file);
    for (const call of methodCalls(sourceFile, 'deactivate')) {
      if (!isSpellReceiver(call.receiver, sourceFile)) {
        violations.push({ file, message: `${call.text} (line ${call.line})` });
      }
    }
  }
  return violations;
};
