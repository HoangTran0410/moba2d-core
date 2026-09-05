import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCastSpecFrozen } from '@/seams/castSpecFrozen';

/**
 * The ban, held to every way the language lets you read live state inside a
 * `castSpec` getter.
 *
 * This seam used to find the getter's own body with a regex opener
 * (`/get castSpec\([^)]*\)[^{]*\{/`, `.exec`'d — first match only) plus
 * hand-rolled brace counting, then scan that text with `/\bthis\.(\w+)/g`.
 * Given ordinary ways to spell the same read, or to hide a second spell's
 * getter in the same file, it missed all of them:
 *
 *   - `this['shotsRemaining']` — bracket access
 *   - `this\n  .shotsRemaining` — a line break between `this` and the dot
 *   - `this?.shotsRemaining` — optional chaining
 *   - `const { shotsRemaining } = this;` — a destructured read never puts
 *     the substring `this.shotsRemaining` in the source at all
 *   - a second class's `get castSpec()` in the same file — `.exec` only
 *     ever returns the first match
 *   - a `castSpec` returning `{ name: "}", ... }` — the brace counter has
 *     no idea a `}` can sit inside a string, and truncates the body before
 *     ever reaching the real read
 */
const seamOn = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'seam-castspec-frozen-'));
  writeFileSync(join(dir, 'Subject.ts'), source);
  return checkCastSpecFrozen(dir);
};

describe('the castSpec-frozen ban', () => {
  it('catches every spelling of a live-state read', () => {
    const cases = [
      `class Bracket { get castSpec() { return { d: this['shotsRemaining'] }; } }`,
      `class LineBreak { get castSpec() { return { d: this\n.shotsRemaining }; } }`,
      `class OptChain { get castSpec() { return { d: this?.shotsRemaining }; } }`,
      `class Destructure {
         get castSpec() {
           const { shotsRemaining } = this;
           return { d: shotsRemaining };
         }
       }`,
    ];
    for (const source of cases) {
      expect(seamOn(source).map(v => v.message)).toEqual(['this.shotsRemaining']);
    }
  });

  it('catches a second castSpec getter in the same file, not just the first', () => {
    const violations = seamOn(`
      class First {
        get castSpec() { return { cooldown: { durationMs: this.coolDown } }; }
      }
      class Second {
        get castSpec() { return { cooldown: { durationMs: this.shotsRemaining } }; }
      }`);
    expect(violations.map(v => v.message)).toEqual(['this.shotsRemaining']);
  });

  it('is not thrown off the rest of the getter by a brace sitting inside a string', () => {
    const violations = seamOn(`
      class Subject {
        get castSpec() {
          const marker = "}";
          return { cooldown: { durationMs: this.shotsRemaining } };
        }
      }`);
    expect(violations.map(v => v.message)).toEqual(['this.shotsRemaining']);
  });

  it('leaves constant fields, a plain method named castSpec, and a nested function alone', () => {
    const violations = seamOn(`
      class Subject {
        // never read this.shotsRemaining here
        castSpec() { return this.shotsRemaining; } // not a getter — not the rule's shape
        get castSpec() {
          const doc = "this.shotsRemaining";
          function helper() { return this.shotsRemaining; } // a different \`this\`
          return { cooldown: { durationMs: this.coolDown }, owner: this.owner };
        }
      }`);
    expect(violations).toEqual([]);
  });

  it('honours the grandfathered list, keyed by file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam-castspec-frozen-'));
    writeFileSync(
      join(dir, 'Bad.ts'),
      `class S { get castSpec() { return { d: this.shotsRemaining }; } }\n`
    );
    expect(checkCastSpecFrozen(dir).map(v => v.file)).toEqual(['Bad.ts']);
    expect(
      checkCastSpecFrozen(dir, { grandfathered: new Set(['Bad.ts']) }).map(v => v.file)
    ).toEqual([]);
  });
});
