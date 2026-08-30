/**
 * Content-pack-extraction batch 6 task 9: core's own `scripts/` tooling
 * stops knowing a pack by name. Fourteen files under `scripts/` used to
 * mention `riot` — most in a comment, three in real behaviour
 * (`check-chunks.mjs`, `verify-without-packs.mjs` both derived their answer
 * from `installedContentPackages`; `generate-spell-catalog.mjs`'s
 * `PACK_SPELL_TREES` table moved to `packs/riot/catalog.config.mjs`, the
 * pack's own knowledge about its own layout). A script that hardcodes a
 * pack's name is a script that breaks, or silently does nothing, the day
 * that pack is gone — this is the scan that keeps that true.
 *
 * Shaped after `tests/scripts/e2eHarness.test.ts` and
 * `tests/game/attackableUnits/attack-gate-seam.test.ts`: a static source
 * scan, walking every real file rather than trusting a rule that lives only
 * in a code-review comment. `stripComments` is `src/seams/importScan.ts`'s
 * shared parser (formerly `importScan.ts` — see that file's
 * own header) rather than a hand-rolled one: CLAUDE.md names the exact
 * failure a second copy risks — a `//` comment containing `/*` blinding six
 * scans at once.
 *
 * Two patterns, not one. A bare `'riot'`/`"riot"` string literal catches a
 * value that *is* the pack's local name (`packId: 'riot'`,
 * `contentPackInstalled(root, 'riot')`); a `packs/riot` path catches the
 * pack named by *location* (`join(ROOT, 'packs/riot/spells')`) even where
 * the literal itself is a longer string. Neither pattern touches an
 * uppercase identifier like `NOT_FROM_RIOT` or an unquoted object key like
 * `riot:` — those are not the pack's name written down as data, and this
 * scan is about data, not every occurrence of four letters.
 *
 * ## Exemptions
 *
 * One directory is excused today: `scripts/migrations/**` is a historical
 * record of one-shot transforms already run, out of this task's scope per
 * its own brief the same way the two below used to be.
 * `scripts/pack-dependent-tests.mjs` is deliberately *not* in this list:
 * its only pack-shaped code is an unquoted `riot:` object key, which
 * neither pattern below matches, so it needs no exemption to pass — and it
 * is another task's file to edit, not this scan's to carve a hole for.
 *
 * Two more used to be excused here — `scripts/wiki/*.mjs` ("leaves with the
 * pack in a later task") and `scripts/pack-add.mjs` ("superseded, slated
 * for deletion rather than migration") — and both predictions came true:
 * content-pack-and-repo-split batch 6 task 10 deleted `scripts/wiki/`
 * outright and moved it into `@moba2d/content-riot`'s own repository, and
 * `scripts/pack-add.mjs` is gone the same way. Neither path exists in this
 * checkout any more, so `readdirSync` above cannot produce either one for
 * `EXEMPTIONS` to match — whole-branch fix pass: the two entries are
 * removed rather than left carrying a future-tense reason for something
 * that has already happened; git history is where "what `new-spell.mjs`
 * used to do" belongs now, not a live exemption list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/seams/importScan';

const SCRIPTS_ROOT = fileURLToPath(new URL('../../scripts/', import.meta.url));

/**
 * Every `.mjs` file under `scripts/`, at any depth, relative to `scripts/`
 * itself — the population this whole scan runs over.
 */
const allFiles = readdirSync(SCRIPTS_ROOT, { recursive: true, encoding: 'utf8' })
  .filter(entry => entry.endsWith('.mjs'))
  .sort();

/**
 * Paths (relative to `scripts/`) excused from the rule below, each with the
 * reason it is excused. `prefix` excuses a whole directory; `path` excuses
 * one file exactly. See this file's own header for why
 * `pack-dependent-tests.mjs` is deliberately absent from this list.
 */
const EXEMPTIONS = [
  {
    prefix: 'migrations/',
    reason:
      'One-shot migration scripts, each already run once against this exact tree and never run ' +
      'again — a historical record of a transform, not live tooling a future pack must not be ' +
      'named by.',
  },
];

const isExempt = (relativePath: string): boolean =>
  EXEMPTIONS.some(entry =>
    'path' in entry ? relativePath === entry.path : relativePath.startsWith(entry.prefix)
  );

const scanned = allFiles.filter(entry => !isExempt(entry));

/** The value is exactly the pack's local name — nothing else in the string. */
const RIOT_STRING_LITERAL = /(['"])riot\1/g;

/** The pack named by its location under `packs/`, quoted or not, standalone or as a prefix. */
const PACKS_RIOT_PATH = /packs\/riot\b/g;

const read = (relativePath: string): string =>
  stripComments(readFileSync(join(SCRIPTS_ROOT, relativePath), 'utf8'));

/**
 * Every match of `pattern` in `source`, except one immediately preceded or
 * followed by an *escaped* backtick — the two literal characters `\` then
 * `` ` `` — never a bare, unescaped one.
 *
 * That escape is the real, checkable signal, not "backtick-adjacent" in
 * general. A first version of this excluded any adjacent backtick and was
 * wrong: `generate-installed-packs.mjs` is one giant *outer* template
 * literal whose content is another file's generated source, so a literal
 * backtick inside it — including one Markdown/JSDoc-quoting the pack's id
 * as an example, `` \`'riot'\` `` — has to be written `` \` `` or it
 * would close the outer literal early. That escaping only ever shows up
 * because prose is nested a level deeper than usual; it never shows up
 * around a real, ordinary template literal, which is exactly the case the
 * unescaped rule missed: `` `packs/riot/${part}` `` (the same quoting
 * `installed-packs.mjs` already uses for `` `${SCOPE}/${PACKAGE_PREFIX}` ``)
 * has plain, unescaped backticks either side of its content and is a
 * perfectly real violation — found by review, not by this file's own tests,
 * because every violation actually planted here so far happened to use
 * quotes, not a template literal.
 */
const ESCAPED_BACKTICK = '\\`';

function codeMatches(source: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    const end = match.index + match[0].length;
    const before = source.slice(Math.max(0, start - 2), start);
    const after = source.slice(end, end + 2);
    if (before === ESCAPED_BACKTICK || after === ESCAPED_BACKTICK) continue;
    found.push(match[0]);
  }
  return found;
}

/**
 * `codeMatches`'s own exclusion rule, proven both ways against synthetic
 * input rather than trusted from the file-scan results alone — a review
 * finding on this exact scan: the first version excluded *any* adjacent
 * backtick, not only an escaped one, which silently let a plain template
 * literal (`` `packs/riot/${part}` ``) through uncaught.
 */
describe('codeMatches excludes an escaped backtick, and only an escaped one', () => {
  it('suppresses the real false positive — an inline-code-quoted riot inside an escaped-backtick template literal', () => {
    // The exact shape generate-installed-packs.mjs's own body has today:
    // that whole file is one outer template literal, so a literal backtick
    // inside it — quoting `'riot'` as an example in a doc comment meant for
    // the *generated* file — has to be written `` \` `` or it would close
    // the outer literal early.
    const prose = "The id the pack's own manifest declares \u2014 \\`'riot'\\`.";
    expect(codeMatches(prose, RIOT_STRING_LITERAL)).toEqual([]);
  });

  it('still catches a plain, unescaped-backtick template literal — the case the looser "any adjacent backtick" rule missed', () => {
    // `installed-packs.mjs` already builds a real value exactly this way
    // (`` `${SCOPE}/${PACKAGE_PREFIX}` ``); a hardcoded pack path written as
    // `` `packs/riot/${part}` `` is a perfectly real violation, and the
    // review that found this proved a prior version of this exclusion (any
    // adjacent backtick, escaped or not) let it through silently.
    const code = 'const dir = `packs/riot/${part}`;';
    expect(codeMatches(code, PACKS_RIOT_PATH)).toEqual(['packs/riot']);
  });
});

describe('no script under scripts/ knows a content pack by name', () => {
  it('found enough scripts to scan, so this cannot pass by finding nothing', () => {
    // The guard tests/scripts/e2eHarness.test.ts's own header names: a glob
    // matching nothing passes silently, and that has happened in this
    // repository before. 31 files exist under scripts/ today, across
    // scripts/ itself, scripts/lib/ and two scripts/migrations/ trees —
    // scripts/wiki/ (formerly a third contributor here) left with the pack
    // in content-pack-and-repo-split batch 6 task 10.
    expect(allFiles.length).toBeGreaterThanOrEqual(12);
  });

  it('has non-exempt files left to check once the excused ones are set aside', () => {
    // The population guard above proves the walk found files; this proves
    // the exemption list has not swallowed the walk whole.
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.length).toBeLessThan(allFiles.length);
  });

  it.each(scanned)('%s names no pack by a bare "riot" string literal', relativePath => {
    expect(codeMatches(read(relativePath), RIOT_STRING_LITERAL)).toEqual([]);
  });

  it.each(scanned)('%s names no pack by a packs/riot path', relativePath => {
    expect(codeMatches(read(relativePath), PACKS_RIOT_PATH)).toEqual([]);
  });
});
