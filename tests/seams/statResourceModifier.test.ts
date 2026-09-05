import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStatResourceModifier } from '@/seams/statResourceModifier';

/**
 * The ban, held to every way the language lets you shape `health:`/`mana:`
 * as an object.
 *
 * This seam existed as a regex — `/(?<![A-Za-z])(?:health|mana)\s*:\s*\{/`,
 * tested against each line on its own — which needs the property name,
 * only whitespace, a colon, only whitespace, and `{`, all on the same line.
 * Given four ordinary ways to write the same bonus config, it caught one:
 * a quoted key, a computed key, a cast on the value, and the name split
 * from the rest by a line break were all invisible to it.
 */
const seamOn = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'seam-stat-resource-modifier-'));
  writeFileSync(join(dir, 'Subject.ts'), source);
  return checkStatResourceModifier(dir);
};

describe('the health/mana-as-stat ban', () => {
  it('catches every spelling of the shape', () => {
    expect(seamOn(`const bonuses = { health: { baseBonus: 50 } };\n`)).toHaveLength(1);
    expect(seamOn(`const bonuses = { "health": { baseBonus: 50 } };\n`)).toHaveLength(1);
    expect(seamOn(`const bonuses = { ['health']: { baseBonus: 50 } };\n`)).toHaveLength(1);
    expect(seamOn(`const bonuses = { health: ({ baseBonus: 50 } as any) };\n`)).toHaveLength(1);
    expect(
      seamOn(`const bonuses = {\n  health\n    : { baseBonus: 50 },\n};\n`)
    ).toHaveLength(1);
  });

  it('leaves maxHealth, a plain number, and a shorthand reference alone', () => {
    // `maxHealth`/`maxMana` are the legitimate Stats this rule protects, a
    // number is not a modifier-pipeline object, and `{ health }` is a
    // reference to something already computed, not a value being shaped.
    const violations = seamOn(`
      const good = { maxHealth: { baseBonus: 50 }, maxMana: { baseBonus: 50 } };
      const plain = { health: 100 };
      const health = getHealthStat();
      const shorthand = { health };
    `);
    expect(violations).toEqual([]);
  });

  it('is not fooled by a class field of the same name, or by the words in a string or a comment', () => {
    const violations = seamOn(`
      // never write { health: { baseBonus: 50 } }
      class Stats {
        health: Stat = new Stat(100);
      }
      const doc = "const bonuses = { health: { baseBonus: 50 } };";
    `);
    expect(violations).toEqual([]);
  });

  it('dedupes two resource properties on the same line to one violation, and honours a pinned line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam-stat-resource-modifier-'));
    writeFileSync(
      join(dir, 'Unit.ts'),
      `const unit = {\n` +
        `stats: { mana: { value: 100 }, health: { value: 100 } },\n` +
        `other: { mana: { value: 200 }, health: { value: 200 } },\n` +
        `};\n`
    );

    expect(checkStatResourceModifier(dir).map(v => v.message)).toEqual([
      '2: stats: { mana: { value: 100 }, health: { value: 100 } },',
      '3: other: { mana: { value: 200 }, health: { value: 200 } },',
    ]);

    const pinned = checkStatResourceModifier(dir, {
      pinnedResourceLines: new Set([
        'Unit.ts:x1:stats: { mana: { value: 100 }, health: { value: 100 } },',
      ]),
    });
    expect(pinned).toEqual([
      expect.objectContaining({
        message: '3: other: { mana: { value: 200 }, health: { value: 200 } },',
      }),
    ]);
  });

  it('reports a pinned line that no longer shapes a resource as a stat as stale', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seam-stat-resource-modifier-'));
    writeFileSync(join(dir, 'Unit.ts'), `const nothing = 1;\n`);

    const result = checkStatResourceModifier(dir, {
      pinnedResourceLines: new Set(['Unit.ts:x1:health: { value: 100 },']),
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'stale-exemption',
        file: 'Unit.ts:x1:health: { value: 100 },',
      }),
    ]);
  });
});
