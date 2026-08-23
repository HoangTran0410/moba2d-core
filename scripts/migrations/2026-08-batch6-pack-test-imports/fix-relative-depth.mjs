// Fourth pass, run once — after `git mv tests/packs/riot packs/riot/tests`
// (content-pack-extraction batch 6 task 6) — over a tree the first three
// passes never saw: every relative import that used to reach from
// tests/packs/riot/** into packs/riot/** now sits two directories closer.
// `../../../../packs/riot/spells/X` (four levels, from
// tests/packs/riot/spells/) becomes `../../spells/X` (two levels, from
// packs/riot/tests/spells/); a root-level file
// (tests/packs/riot/pack.test.ts, now packs/riot/tests/pack.test.ts) drops
// one level, `../../../packs/riot/pack` -> `../pack`. 152 specifiers per
// the authoring survey — mechanical, and the same reason the first three
// passes exist rather than 70 files hand-edited once each.
//
// Recomputed per specifier against where its target actually resolves, not
// pattern-matched by counting leading `../`: a specifier is rewritten only
// if, resolved from the file's OLD location, it lands inside `packs/riot/`
// (the pack source, which never moved) or inside the tree that just moved
// with it — anything else is left untouched. That guard is what keeps this
// pass from corrupting `generate-assets.test.ts`'s own fixture text: two
// unrelated string literals in that file (`'export const assetManifest =
// {'` and `"from '../assets/images/champions/janna.png?url'"`) read like
// one real `export ... from '...'` statement to a parser with no notion of
// string boundaries (see noCoreReach.test.ts's own header, and
// KNOWN_FALSE_POSITIVES there) — its resolved target lands nowhere near
// either tree, so the guard leaves it alone.
//
// Run with:
//   node scripts/migrations/2026-08-batch6-pack-test-imports/fix-relative-depth.mjs         (dry run)
//   node scripts/migrations/2026-08-batch6-pack-test-imports/fix-relative-depth.mjs --write
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../');
const NEW_TEST_DIR = join(ROOT, 'packs/riot/tests');
const OLD_TEST_DIR = join(ROOT, 'tests/packs/riot');
const PACKS_RIOT = join(ROOT, 'packs/riot');
const WRITE = process.argv.includes('--write');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// The same three shapes `src/seams/importScan.ts`'s `scanImports`
// recognises, simplified to capture only what this pass needs to rewrite in
// place: the quote character and the specifier itself.
const STATIC_PATTERN =
  /\b(?:import|export)\b\s+(?:type\s+)?(?:(?!\b(?:import|export)\b)[\s\S])*?\bfrom\s+(['"])([^'"]+)\1/g;
const SIDE_EFFECT_PATTERN = /\bimport\s+(['"])([^'"]+)\1/g;
const DYNAMIC_PATTERN = /\bimport\(\s*(['"])([^'"]+)\1/g;

/** Where `oldAbs` lives after the move — unchanged if it was never inside `OLD_TEST_DIR`. */
function mapOldAbsToNewAbs(oldAbs) {
  const relToOldTests = relative(OLD_TEST_DIR, oldAbs);
  if (relToOldTests === '' || !relToOldTests.startsWith('..')) {
    return join(NEW_TEST_DIR, relToOldTests);
  }
  return oldAbs;
}

function oldDirFor(newFileDir) {
  const rel = relative(NEW_TEST_DIR, newFileDir);
  return join(OLD_TEST_DIR, rel);
}

function rewriteWith(source, pattern, newFileDir, oldFileDir) {
  let changed = false;
  const rewritten = source.replace(pattern, (whole, quote, specifier) => {
    if (!specifier.startsWith('.')) return whole;

    const oldTarget = resolve(oldFileDir, specifier);
    const newTarget = mapOldAbsToNewAbs(oldTarget);

    // Guard: only rewrite a specifier that genuinely resolves inside this
    // package. Anything else — including the false-positive shape above —
    // is left exactly as written.
    const relFromPackRoot = relative(PACKS_RIOT, newTarget);
    if (relFromPackRoot === '..' || relFromPackRoot.startsWith(`..${'/'}`)) return whole;

    let newSpecifier = relative(newFileDir, newTarget).split('\\').join('/');
    if (!newSpecifier.startsWith('.')) newSpecifier = `./${newSpecifier}`;
    if (newSpecifier === specifier) return whole;

    changed = true;
    return whole.replace(`${quote}${specifier}${quote}`, `${quote}${newSpecifier}${quote}`);
  });
  return { source: rewritten, changed };
}

const files = walk(NEW_TEST_DIR).sort();
let filesChanged = 0;

for (const file of files) {
  const newFileDir = dirname(file);
  const oldFileDir = oldDirFor(newFileDir);
  let source = readFileSync(file, 'utf8');
  let anyChange = false;

  for (const pattern of [STATIC_PATTERN, SIDE_EFFECT_PATTERN, DYNAMIC_PATTERN]) {
    const result = rewriteWith(source, pattern, newFileDir, oldFileDir);
    source = result.source;
    anyChange = anyChange || result.changed;
  }

  if (anyChange) {
    filesChanged++;
    if (WRITE) writeFileSync(file, source);
  }
}

console.log(
  `fix-relative-depth: ${filesChanged}/${files.length} file(s) ${WRITE ? 'rewritten' : 'need rewriting'}`
);
