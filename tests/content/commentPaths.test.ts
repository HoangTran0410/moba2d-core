import { readFileSync, readdirSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A path this repository names in prose has to be a path this repository has.
 *
 * ## The gap this closes
 *
 * Comments here carry a great deal of load — cross-references above all, in the
 * form "see `src/game/config/mapTuning.ts`". Nothing checked them. Code that
 * names a module that moved fails to compile; a *comment* that names one keeps
 * reading perfectly and sends the next person to a file that is not there, and
 * nobody finds out until somebody follows it.
 *
 * That is not hypothetical and it was not rare. When this test was written the
 * repository held **49** dead repo-rooted references, and their shape was
 * exactly what you would predict: a script cited by the name it had before it
 * was renamed (it is `scripts/pack-manifest.mjs` now), a dozen paths under a
 * `tests/packs/riot/` tree that had left for a repository of its own, and a
 * map-geometry module from before the map became data in a pack. Every one of
 * those files was moved by somebody who updated the imports — the compiler
 * made them — and not the prose, because nothing did.
 *
 * Their old spellings are deliberately not quoted here: this file is scanned
 * by the rule it defines, so naming a dead path would fail the suite it lives
 * in. That is the rule working, and it is also the reason for the convention
 * below.
 *
 * ## What it checks, and what it deliberately does not
 *
 * Only a backticked path that **starts with a directory this repository owns**
 * — `src/`, `tests/`, `scripts/`, `styles/`, `public/`. That is the subset
 * where a dangling reference is unambiguously wrong rather than a judgement
 * call, and the narrowness is the point: a check with false positives is a
 * check somebody turns off.
 *
 * So all of these stay legal, and none of them is a claim about this tree:
 *
 *   - a bare filename — `` `Wallet.ts` `` — which reads as "the module called
 *     that", not as a location;
 *   - a build artifact — `` `dist/manifest.json` ``, `` `pack.js` `` — which
 *     exists only after a build;
 *   - a file in a *pack's* repository, which must then be written so a reader
 *     can tell: `` `lol/tests/maps/Lanes.test.ts` ``, not `` `tests/maps/…` ``,
 *     because the second sends somebody hunting through core's own `tests/`.
 *     Fixing those for this check also fixes them for the reader, which is the
 *     sign the rule is aimed at the right thing.
 *
 * The one thing it cannot check is the half that matters most: whether the
 * *sentence* is still true. `EconomyTuning` carried a paragraph explaining why
 * the sell refund could not be a map's setting, naming a constraint that had
 * not existed for three days — every path in it resolved. This catches the
 * mechanical rot; the rest is still on whoever is reading.
 */

const ROOT = resolve(__dirname, '../..');

/** The directories this repository owns, and therefore answers for. */
const OWNED = /^(?:src|tests|scripts|styles|public)\//;

/** A backticked path with a file extension — the shape a cross-reference takes. */
const REFERENCE = /`([A-Za-z0-9_./-]+\.(?:ts|vue|mjs|js|css|json))`/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|vue|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = (): string[] =>
  ['src', 'tests', 'scripts', 'public/map-editor/js'].flatMap(dir =>
    sourceFiles(resolve(ROOT, dir))
  );

describe('every path this repository names in prose', () => {
  it('finds the trees it claims to scan', () => {
    // A walk that silently returned nothing would make every assertion below
    // pass while checking not one reference.
    const scanned = files();
    expect(scanned.length).toBeGreaterThan(400);
    for (const root of ['/src/', '/tests/', '/scripts/', '/public/']) {
      expect(
        scanned.some(file => file.includes(root)),
        `${root} contributed no files`
      ).toBe(true);
    }
  });

  it('points at a file that is actually there', () => {
    const dangling: string[] = [];

    for (const file of files()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(REFERENCE)) {
        const reference = match[1];
        if (!OWNED.test(reference) || reference.includes('*')) continue;
        if (existsSync(resolve(ROOT, reference))) continue;
        dangling.push(`${relative(ROOT, file)} -> ${reference}`);
      }
    }

    expect(dangling).toEqual([]);
  });

  it('is checking a real population, not an empty one', () => {
    // The guard against the regex quietly matching nothing after an edit —
    // which would leave the assertion above green and meaningless.
    let seen = 0;
    for (const file of files()) {
      for (const match of readFileSync(file, 'utf8').matchAll(REFERENCE)) {
        if (OWNED.test(match[1])) seen++;
      }
    }
    expect(seen).toBeGreaterThan(300);
  });
});
