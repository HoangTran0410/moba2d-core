import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBuffDeactivate } from '@/seams/buffDeactivate';

/**
 * The ban, held to every way the language lets you write the banned call.
 *
 * This seam existed as a regex — `/([A-Za-z_$][\w$]*)\s*\??\.deactivate\(\)/g`,
 * run line by line — which requires a bare identifier sitting immediately
 * before the dot. Given six ordinary ways to call `.deactivate()` on a buff,
 * it caught two: a plain call and an optional-chained one. It missed a
 * receiver split across a line break (what a formatter does to a long
 * chain), bracket access, a parenthesised cast, and a receiver that is
 * itself a call — none of which is devious, all of which typecheck, and any
 * of which is the exact bug this seam exists to catch: a buff that never
 * calls `deactivateBuff()` and so never actually ends.
 */
const seamOn = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'seam-buff-deactivate-'));
  writeFileSync(join(dir, 'Subject.ts'), source);
  return checkBuffDeactivate(dir);
};

describe('the buff deactivate ban', () => {
  it('catches every spelling of the call, not just the obvious one', () => {
    const violations = seamOn(`
      export class Subject {
        cast() {
          someBuff.deactivate();
          someBuff
            .deactivate();
          someBuff['deactivate']();
          (someBuff as Buff).deactivate();
          this.getBuff().deactivate();
        }
      }`);
    expect(violations).toHaveLength(5);
  });

  it('leaves a Spell ending its own lifecycle alone', () => {
    // `deactivate()` is declared on `Spell`, and every subclass overriding it
    // calls `super.deactivate()` — that is the method the rule protects, not
    // one it bans. A receiver whose name says it is a spell is the same
    // heuristic the regex used, carried over unchanged.
    const violations = seamOn(`
      export class MySpell extends Spell {
        deactivate(): void {
          super.deactivate();
        }
        cast() {
          this.spellRef.deactivate();
        }
      }`);
    expect(violations).toEqual([]);
  });

  it('is not fooled by a declaration, or by the words in a string or a comment', () => {
    const violations = seamOn(`
      export class Subject {
        // never write someBuff.deactivate();
        deactivate(): void {}
        cast() {
          const doc = "someBuff.deactivate();";
          this.log(doc);
        }
      }`);
    expect(violations).toEqual([]);
  });
});
