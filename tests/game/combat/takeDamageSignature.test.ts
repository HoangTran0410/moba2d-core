import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * An override of `takeDamage` has to take everything `takeDamage` takes.
 *
 * ## The bug this is the guard for
 *
 * TypeScript lets a method override declare **fewer** parameters than the one
 * it replaces — a two-argument function is assignable to a four-argument
 * signature, and correctly so in general. It is not correct here, because the
 * dropped parameters are not decoration: `type` decides whether armour or
 * magic resist is applied, and it *defaults to `MAGIC`*.
 *
 * So `takeDamage(damage, attacker)` calling `super.takeDamage(damage, attacker)`
 * compiles, runs, and silently re-defaults every typed hit that reaches it.
 * All four subclasses that override this had exactly that shape — `Minion`,
 * `Monster`, `AIChampion`, `Turret` — so a basic attack against a *bot* was
 * mitigated by magic resist while the same swing against a human was mitigated
 * by armour. Player and bot obeyed different rules, and nothing in the
 * toolchain could say so.
 *
 * ## Why a source scan and not a behavioural test
 *
 * There is a behavioural test beside this one (`damageTypeReachesTheBody`) and
 * it covers today's four. This covers the *fifth*: a new
 * `class Whatever extends AttackableUnit` that overrides `takeDamage` is
 * exactly as free to truncate it, and the failure is invisible in play — a few
 * percent of mitigation, on one body type, in the direction nobody measures.
 * The same reasoning as `wallSweepCoverage.test.ts`: count the class, not the
 * instance.
 */

const SRC = join(process.cwd(), 'src');

/**
 * The five parameters the base declares, in order. `presentation` is the
 * fifth: presentation-only (the crit flag `presentHit` draws), but dropping
 * it is the same bug in a different coat — a bot's crit would land with the
 * multiplier and *look* like an ordinary hit, on that body type only.
 */
const REQUIRED = ['damage', 'attacker', 'type', 'source', 'presentation'];

const sourceFiles = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.ts$/.test(entry)) found.push(full);
  }
  return found;
};

/** Every `takeDamage(...)` *declaration*, with the file it is in. */
const declarations = (): { file: string; params: string }[] => {
  const found: { file: string; params: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^\s*(?:override\s+)?takeDamage\(([^)]*)\)/gms)) {
      found.push({ file: relative(SRC, file).split('\\').join('/'), params: match[1] });
    }
  }
  return found;
};

describe('every takeDamage', () => {
  it('is checking a real population, not an empty one', () => {
    // The base plus its overrides. If this scan ever matches one thing, the
    // assertion below is about the base and nothing else.
    expect(declarations().length).toBeGreaterThan(3);
  });

  it('declares all five parameters, so none of them can be dropped', () => {
    const truncated = declarations()
      .filter(({ params }) => REQUIRED.some(name => !params.includes(name)))
      .map(({ file, params }) => `${file}: takeDamage(${params.replace(/\s+/g, ' ').trim()})`);

    expect(
      truncated,
      'an override that omits `type` re-defaults it to MAGIC — armour stops applying:\n  ' +
        truncated.join('\n  ')
    ).toEqual([]);
  });

  it('hands all five on to super, rather than declaring them and dropping them', () => {
    // Declaring `type` and then calling `super.takeDamage(damage, attacker)`
    // is the same bug with the evidence removed.
    const dropped: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const call of source.matchAll(/super\.takeDamage\(([^)]*)\)/g)) {
        const args = call[1].replace(/\s+/g, ' ').trim();
        if (args.split(',').length < REQUIRED.length) {
          dropped.push(`${relative(SRC, file).split('\\').join('/')}: super.takeDamage(${args})`);
        }
      }
    }
    expect(dropped, `these forward fewer arguments than they were given:\n  ${dropped.join('\n  ')}`).toEqual([]);
  });
});
