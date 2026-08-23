// Second pass, run after transform.mjs: merges multiple
// `import { ... } from '@moba2d/core/testing'` (or `/testing/spell`, or
// `/content/types`) statements in one file into a single import — the
// mechanical pass above adds one import per specifier it retargets, so a
// file touching several REACHABLE/gap specifiers from the same barrel ends
// up with several import lines from the same module. Functionally correct,
// but reads worse than the file it replaced.
//
// Run with:
//   node scripts/migrations/2026-08-batch6-pack-test-imports/consolidate.mjs         (dry run)
//   node scripts/migrations/2026-08-batch6-pack-test-imports/consolidate.mjs --write
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../');
const TEST_DIR = join(ROOT, 'tests/packs/riot');
const WRITE = process.argv.includes('--write');
const TARGETS = [
  '@moba2d/core/testing/spell',
  '@moba2d/core/testing',
  '@moba2d/core/content/types',
];

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

function consolidate(source, specifier) {
  // Bounded the same way src/seams/importScan.ts's STATIC_PATTERN is: the
  // brace content may not cross another import/export keyword, or a
  // non-greedy `{...}` matches from the FIRST `{` anywhere earlier in the
  // file (e.g. the vitest import) through to this specifier's own `}`,
  // silently swallowing every statement in between.
  const re = new RegExp(
    `import\\s+(type\\s+)?\\{((?:(?!\\bimport\\b|\\bexport\\b)[\\s\\S])*?)\\}\\s+from\\s+'${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';\\n?`,
    'g'
  );
  const matches = [...source.matchAll(re)];
  if (matches.length <= 1) return source;

  // A whole-statement `import type { ... }` and an ordinary `import { ... }`
  // from the same specifier are kept separate — merging would silently turn
  // a type-only member into a value import. Only merge within each group.
  const groups = { value: [], type: [] };
  for (const m of matches) (m[1] ? groups.type : groups.value).push(m);

  let out = source;
  for (const [, group] of Object.entries(groups)) {
    if (group.length <= 1) continue;
    const names = [];
    const seen = new Set();
    for (const m of group) {
      for (const part of m[2]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)) {
        if (!seen.has(part)) {
          seen.add(part);
          names.push(part);
        }
      }
    }
    const isType = Boolean(group[0][1]);
    const merged = `import ${isType ? 'type ' : ''}{ ${names.join(', ')} } from '${specifier}';\n`;
    // Replace the first occurrence with the merged import, delete the rest.
    const first = group[0];
    out = out.replace(first[0], merged);
    for (const m of group.slice(1)) {
      out = out.replace(m[0], '');
    }
  }
  return out;
}

function main() {
  const files = walk(TEST_DIR).sort();
  let changed = 0;
  for (const file of files) {
    const rel = relative(ROOT, file);
    const original = readFileSync(file, 'utf8');
    let source = original;
    for (const specifier of TARGETS) {
      source = consolidate(source, specifier);
    }
    if (source !== original) {
      changed++;
      console.log(rel);
      if (WRITE) writeFileSync(file, source);
    }
  }
  console.log(`\n${changed} file(s) ${WRITE ? 'consolidated' : 'would be consolidated'}`);
}

main();
