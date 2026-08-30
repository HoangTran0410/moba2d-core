import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every kind of body the wall sweep can reach, and every kind it deliberately
 * does not.
 *
 * `TerrainMap.pushOutOfWalls` is the only thing that enforces walls on a body
 * that was *moved rather than walked* — a dash, a hook, a knock-back and the
 * minimap's teleport all write `position` and hand the result over. Whether a
 * body ever reaches it is decided by two queries in `TerrainMap.update`, and
 * for a long time those were champions and lane minions. Monsters were in
 * neither, so a camp kicked into a rock stood in it for the rest of the match,
 * and nothing anywhere said so — not a type error, not a test, not a log.
 *
 * That is a **class** of bug, not one bug: it recurs the next time somebody
 * adds a body type. So this counts the bodies rather than the fix. A new
 * `class Whatever extends AttackableUnit` fails here until it is either
 * covered by the sweep or written into `EXEMPT` with a reason.
 *
 * It says nothing about whether the *push* is correct — `WallPushOut.test.ts`
 * owns that — only about who is offered to it.
 */

const ROOT = resolve(__dirname, '../../..');

/** Where a body class can live. Both directories are scanned whole. */
const BODY_DIRS = ['src/game/gameObject/attackableUnits', 'src/game/gameObject/structures'];

/**
 * The three roots `TerrainMap.update` sweeps. Anything that is one of these,
 * however deep the chain, comes back out of a wall.
 */
const SWEPT = ['Champion', 'Minion', 'Monster'];

/**
 * Bodies the sweep is right to skip, and why. Being on this list is a claim,
 * so each one states the reason it cannot strand.
 */
const EXEMPT: Record<string, string> = {
  // The base itself. Nothing in a match is one — every body is a subclass, and
  // each of those answers for itself below.
  AttackableUnit: 'abstract base, never instantiated in a match',
  // Placed by the map, `isImmovable`, and never displaced by anything. One
  // inside a wall is a map that drew it there — the editor's problem
  // (`mapRules.js`), not a body that got stuck.
  Turret: 'anchored map furniture — nothing can move it',
  Fountain: 'anchored map furniture — nothing can move it',
};

interface Body {
  file: string;
  name: string;
  parent: string;
}

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
};

/** Every `class X extends Y` under the body directories. */
const bodies = (): Body[] => {
  const found: Body[] = [];
  for (const dir of BODY_DIRS) {
    for (const file of sourceFiles(resolve(ROOT, dir))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^\s*(?:export\s+default\s+)?class\s+(\w+)\s+extends\s+(\w+)/gm)) {
        found.push({ file: relative(ROOT, file), name: match[1], parent: match[2] });
      }
    }
  }
  return found;
};

/** Walks `extends` upward until it reaches a swept root, or runs out. */
const isSwept = (name: string, all: Body[], seen = new Set<string>()): boolean => {
  if (SWEPT.includes(name)) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const body = all.find(entry => entry.name === name);
  return body ? isSwept(body.parent, all, seen) : false;
};

describe('the wall sweep', () => {
  it('finds the body classes it claims to count', () => {
    // A scan that silently matched nothing would make the case below pass
    // while checking no body at all.
    const names = bodies().map(body => body.name);
    expect(names).toContain('Champion');
    expect(names).toContain('Minion');
    expect(names).toContain('Monster');
    expect(names).toContain('Pet');
    expect(names.length).toBeGreaterThanOrEqual(6);
    // Core's own bodies only. A pack may ship a subclass of one of these, and
    // it is covered for the same reason `Pet` is — `instanceof` reaches it
    // without anybody listing it — so there is nothing here for a pack to add.
    expect(names).toContain('Turret');
  });

  it('covers every body that is not explicitly exempt', () => {
    const all = bodies();
    const stranded = all
      .filter(body => !isSwept(body.name, all) && !(body.name in EXEMPT))
      .map(body => `${body.file}: ${body.name} extends ${body.parent}`);

    expect(stranded).toEqual([]);
  });

  /**
   * `Pet extends Champion` is the one worth naming: it is the case the report
   * asked about by name ("ví dụ mắt, pet"), and it is covered for free —
   * `PredefinedFilters.type` is an `instanceof`, so the champion query catches
   * every subclass without listing one of them.
   */
  it('catches subclasses through instanceof, not by listing them', () => {
    const all = bodies();
    for (const name of ['Pet', 'AIChampion', 'DummyChampion']) {
      expect(all.some(body => body.name === name), `${name} is gone`).toBe(true);
      expect(isSwept(name, all), `${name} is not reached by the sweep`).toBe(true);
    }
  });

  it('still names those three roots in the pass that runs it', () => {
    // The other half: the list above is only true while `update` sweeps what
    // this file says it sweeps. Comments stripped — this file's own prose
    // names all three.
    const update = readFileSync(
      resolve(ROOT, 'src/game/gameObject/map/TerrainMap.ts'),
      'utf8'
    )
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ');

    expect(update).toContain('PredefinedFilters.type(Champion)');
    expect(update).toContain('PredefinedFilters.includeTypes([Minion, Monster])');
  });
});
