import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No lesson lives only in the file that is always loaded.
 *
 * `CLAUDE.md`'s trap list is a *summary*; `docs/TRAPS.md` is where the
 * reasoning lives, and it is the one somebody opens when they need to
 * understand rather than avoid. The short list being always-loaded makes it
 * the cheap place to add a lesson to and the easy place to forget to carry
 * one over — so the deep file quietly became the *smaller* of the two on two
 * subjects, and nothing said so.
 *
 * ## Why identifiers, and not headings
 *
 * The first attempt at this compared the two files' bullet headings and
 * reported seven divergences. Five of them were false: the trap was there,
 * worded differently. Prose is the wrong thing to diff — the same lesson is
 * meant to read differently in a one-line summary and in a paragraph of
 * reasoning, and a check that forbids that would push both files towards
 * being one file.
 *
 * What cannot be reworded is the code a trap points at. If the short list
 * warns about a symbol, a caller has to be able to look that symbol up in the
 * long one. That is the invariant, and it is exactly as strict as it should
 * be: it says nothing about how either file phrases anything.
 */
const root = resolve(__dirname, '../..');
const claude = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
const traps = readFileSync(resolve(root, 'docs/TRAPS.md'), 'utf8');

const trapSection = (): string => {
  const from = claude.indexOf('## Traps that have cost real time');
  const to = claude.indexOf('## Assets, maps and tools');
  return claude.slice(from, to);
};

/**
 * A backticked span that names code rather than quoting prose.
 *
 * A path, a call, a dotted member or something in camel/Pascal/SCREAMING case,
 * with no spaces. Bare numbers are excluded — `0.25` reads as a member access
 * to the shape test and is a quantity, not a symbol to look up.
 */
const isIdentifier = (token: string): boolean => {
  if (token.length < 4 || /\s/.test(token)) return false;
  if (/^[\d.%]+$/.test(token)) return false;
  return /[./(]/.test(token) || /[a-z][A-Z]/.test(token) || /^[A-Z][A-Za-z]+$/.test(token) || token.includes('_');
};

/**
 * The ways the same symbol legitimately gets written.
 *
 * `Stats.hasteCooldownMultiplier` is the member on its class and
 * `hasteCooldownMultiplier` is the same stat; `src/game/simulationClock.ts` is
 * the file and `simulationClock` is what a sentence calls it. A check that
 * demanded one spelling would be a check on formatting.
 */
const formsOf = (token: string): string[] => {
  const bare = token.replace(/\(\)?$/, '');
  const basename = bare.split('/').pop() ?? bare;
  const stem = basename.replace(/\.(ts|tsx|mjs|js|md|json)$/, '');
  const member = stem.split('.');
  return [...new Set([token, bare, basename, stem, member[member.length - 1]])];
};

describe('CLAUDE.md’s traps are a summary, never the only copy', () => {
  const cited = [...new Set([...trapSection().matchAll(/`([^`\n]+)`/g)].map(m => m[1]))]
    .filter(isIdentifier)
    // A pointer at the deep file is not a symbol the deep file must contain.
    .filter(token => !token.includes('TRAPS.md'));

  it('cites enough code to be worth checking', () => {
    expect(cited.length).toBeGreaterThan(50);
  });

  it('names nothing docs/TRAPS.md cannot explain', () => {
    const missing = cited.filter(token => !formsOf(token).some(form => traps.includes(form)));
    expect(missing, 'add the trap to docs/TRAPS.md, do not delete it from CLAUDE.md').toEqual([]);
  });
});
