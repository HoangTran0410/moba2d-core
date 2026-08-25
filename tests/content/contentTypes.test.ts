import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '../../', path), 'utf8');

// Same stripper `tests/content/packBoundary.test.ts` uses, and for the same
// reason: matching `\bName\b` against the raw file would let a type named
// only in a comment (a doc-comment mentioning it, a commented-out re-export)
// count as "re-exported" when nothing actually is. Not vacuous today, but it
// is the exact shape of false pass every other source scan in this repo is
// careful to avoid.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('src/content/types.ts', () => {
  it('re-exports every type src/game/spell/runtime/types.ts declares', () => {
    const runtime = read('src/game/spell/runtime/types.ts');
    const declared = [...runtime.matchAll(/^export (?:interface|type) (\w+)/gm)].map(m => m[1]);

    expect(declared.length).toBeGreaterThan(10);

    const barrel = stripComments(read('src/content/types.ts'));
    const missing = declared.filter(name => !new RegExp(`\\b${name}\\b`).test(barrel));
    expect(missing, 'a pack cannot import these — add them to the barrel').toEqual([]);
  });
});

/**
 * A pack can name the instance type of anything `api` hands it, without
 * deriving it.
 *
 * Before this, every pack file that wanted to write `target: AttackableUnit`
 * opened with its own
 *
 *     type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
 *
 * because the door published the *constructor* and nothing else. Measured on
 * `moba2d-content-riot` once the dead ones were removed: 221 such lines still
 * being read, spelling out 18 distinct types — 120 of them `AttackableUnit`.
 * That is one incantation every pack author has to invent independently, and
 * the cost is not the line count, it is that the shape of it teaches a
 * newcomer that naming a core type is supposed to be hard.
 *
 * The published types are written as `InstanceType<ContentApi[...]>` in the
 * barrel too, deliberately: derived from the same interface a pack would have
 * derived them from, so they cannot say something `api` does not. A
 * re-export straight off `@/game/...` would be a second declaration of the
 * same thing, free to drift the day `ContentApi` narrows a member.
 *
 * `buffs` is the group this pins, because it is the one that grows — a new
 * buff class lands in `BUFFS` and a pack cannot name it until it lands here
 * too. Lowercase keys are functions (`createReveal`), not classes.
 */
describe('src/content/types.ts publishes instance types', () => {
  const classNames = (block: string): string[] =>
    [...block.matchAll(/^\s{2}([A-Z]\w*),?$/gm)].map(m => m[1]);

  it('names every buff class BUFFS carries', () => {
    const api = read('src/content/ContentApi.ts');
    const block = /const BUFFS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(api);
    expect(block, 'BUFFS moved — this scan has nothing to read').not.toBeNull();

    const buffs = classNames(block![1]);
    expect(buffs.length).toBeGreaterThan(20);
    expect(buffs).toContain('Slow');

    const barrel = stripComments(read('src/content/types.ts'));
    const missing = buffs.filter(name => !new RegExp(`^export type ${name} =`, 'm').test(barrel));
    expect(missing, 'a pack has to hand-derive these — publish them').toEqual([]);
  });

  it('names the units, spell classes and helpers a pack builds against', () => {
    const barrel = stripComments(read('src/content/types.ts'));
    const missing = [
      'AttackableUnit',
      'Champion',
      'Monster',
      'Pet',
      'StatsModifier',
      'Spell',
      'SpellObject',
      'MissileSpellObject',
      'AreaSpellObject',
      'BeamSpellObject',
      'HomingMissileSpellObject',
      'AoePulse',
      'ParticleSystem',
      'TrailSystem',
      'CombatText',
      'Circle',
      'Rectangle',
    ].filter(name => !new RegExp(`^export type ${name} =`, 'm').test(barrel));

    expect(missing).toEqual([]);
  });

  it('derives them from ContentApi rather than re-exporting core internals', () => {
    const barrel = stripComments(read('src/content/types.ts'));
    const derived = [...barrel.matchAll(/^export type (\w+) = InstanceType<([^;]+)>;$/gm)];
    expect(derived.length).toBeGreaterThan(30);
    for (const [, name, source] of derived) {
      expect(source, `${name} must come off ContentApi`).toMatch(/^ContentApi\[/);
    }
  });
});
