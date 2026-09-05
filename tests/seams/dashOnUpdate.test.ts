import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDashOnUpdate } from '@/seams/dashOnUpdate';

/**
 * The ban, held to every way the language lets you write the banned thing.
 *
 * This seam existed as a regex — `/\b\w+\.onUpdate\s*=/g` — and given the four
 * spellings below it caught exactly one. That is the failure mode a source scan
 * has and a parser does not: a rule that reads as enforced, passes every run,
 * and is walked around by a line break. What it costs when it is missed is a
 * champion standing perfectly still while its spell runs, which is the bug
 * three shipped spells had and the reason the seam is here.
 *
 * The evasions are not devious. `Object.assign` is an ordinary idiom, and the
 * two-line property access is what a formatter does to a long line.
 */
const seamOn = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'seam-dash-'));
  writeFileSync(join(dir, 'Subject.ts'), source);
  return checkDashOnUpdate(dir);
};

describe('the dash onUpdate ban', () => {
  it('catches every spelling of the assignment, not just the obvious one', () => {
    const violations = seamOn(`
      export class Subject {
        cast() {
          const dash = new Dash(1000, this.owner, this.owner);
          dash['onUpdate'] = () => {};
          Object.assign(dash, { onUpdate: () => {} });
          dash
            .onUpdate = () => {};
          const target = dash;
          target.onUpdate = () => {};
        }
      }`);
    expect(violations).toHaveLength(1);
    // Four writes on one file, each with the line that did it.
    expect(violations[0].message.match(/line \d+/g) ?? []).toHaveLength(4);
  });

  it('leaves the base class alone, which has to declare the method', () => {
    // `Dash` implements the movement *in* `onUpdate`; a declaration is what the
    // rule protects, so banning it would ban the thing being protected.
    const violations = seamOn(`
      export default class Dash extends Buff {
        onUpdate(): void {
          this.step();
        }
        onDashUpdate?(): void {}
      }`);
    expect(violations).toEqual([]);
  });

  it('is not fooled by the words appearing in a string or a comment', () => {
    const violations = seamOn(`
      export class Subject {
        cast() {
          // never write dash.onUpdate = () => {}
          const doc = "dash.onUpdate = () => {}";
          this.log(doc);
        }
      }`);
    expect(violations).toEqual([]);
  });
});
