import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vfxIssues } from '@/testing/vfxRules';

/**
 * `damage-in-draw`, the rule a real regression asked for.
 *
 * `ObjectManager` brackets `update`, `onAdded` and `onRemoved` in the object's
 * own attribution and brackets `draw` in nothing, so a hit dealt from a render
 * pass is not ability damage to `abilityPowerScales()` and the caster's whole
 * `Stats.abilityPower` disappears from it — silently, with the tooltip still
 * promising the amplified figure. `draw` is also skipped for anything
 * off-screen, so the hit lands only when somebody is looking at it.
 *
 * Driven against files on disk rather than strings, because that is what
 * `vfxIssues` reads and the directory walk is half of what could be wrong.
 */
const dir = mkdtempSync(join(tmpdir(), 'vfx-rules-'));
const write = (name: string, source: string): void => writeFileSync(join(dir, name), source);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const flagged = (name: string): boolean =>
  vfxIssues(dir).some(issue => issue.file === name && issue.rule === 'damage-in-draw');

describe('damage-in-draw', () => {
  it('flags a hit dealt from a render pass', () => {
    write('Bad.ts', `export class Bad {\n  draw(): void {\n    this.target.takeDamage(10, this.owner);\n  }\n}\n`);
    expect(flagged('Bad.ts')).toBe(true);
  });

  it('finds it however deep inside `draw` it is nested', () => {
    // The reason this walks braces instead of matching a line: the call is
    // routinely several blocks down from the method it belongs to.
    write(
      'Nested.ts',
      `export class Nested {\n  draw(): void {\n    push();\n    for (const unit of this.caught) {\n      if (unit.isDead) continue;\n      unit.takeHeal(5, this.owner);\n    }\n    pop();\n  }\n}\n`
    );
    expect(flagged('Nested.ts')).toBe(true);
  });

  it('leaves the same call in `update` alone, which is where it belongs', () => {
    write('Good.ts', `export class Good {\n  update(): void {\n    this.target.takeDamage(10, this.owner);\n  }\n\n  draw(): void {\n    circle(0, 0, 4);\n  }\n}\n`);
    expect(flagged('Good.ts')).toBe(false);
  });

  it('and does not follow a call that merely sits after `draw` in the file', () => {
    // The brace walk has to end where the method does; a scan that ran to the
    // end of the file would flag every effect that draws and then bites.
    write(
      'After.ts',
      `export class After {\n  draw(): void {\n    circle(0, 0, 4);\n  }\n\n  private bite(): void {\n    this.target.takeDamage(10, this.owner);\n  }\n}\n`
    );
    expect(flagged('After.ts')).toBe(false);
  });

  it('ignores a comment that only talks about the rule', () => {
    write('Talks.ts', `export class Talks {\n  // draw() must never call takeDamage(...)\n  draw(): void {\n    circle(0, 0, 4);\n  }\n}\n`);
    expect(flagged('Talks.ts')).toBe(false);
  });
});
