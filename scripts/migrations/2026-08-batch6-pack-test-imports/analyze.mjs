// Dumps every non-relative-to-packs, non-vitest import specifier used by
// each file under tests/packs/riot/, using the project's own scanImports
// parser (src/seams/importScan.ts) rather than a hand-rolled regex. Read-only:
// produces a JSON report for the migration scripts in this directory to act
// on, and for manual review while planning the codemod.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { scanImports } from '../../../src/seams/importScan.ts';

const ROOT = resolve(import.meta.dirname, '../../../');
const TEST_DIR = join(ROOT, 'tests/packs/riot');

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

const files = walk(TEST_DIR).sort();
const report = {};

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const refs = scanImports(source);
  const rel = relative(ROOT, file);
  const fileDir = dirname(file);
  const interesting = [];
  for (const ref of refs) {
    const spec = ref.specifier;
    if (spec === 'vitest' || spec.startsWith('node:')) continue;
    if (spec.startsWith('.')) {
      const resolved = resolve(fileDir, spec);
      const relFromRoot = relative(ROOT, resolved);
      if (relFromRoot.startsWith('packs/riot') || relFromRoot.startsWith('tests/packs/riot'))
        continue;
      interesting.push({ ...ref, resolved: relFromRoot });
    } else {
      interesting.push(ref);
    }
  }
  // vi.mock scan, textual, after the same stripComments used internally.
  const mockMatches = [...source.matchAll(/vi\.mock\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  if (interesting.length > 0 || mockMatches.length > 0) {
    report[rel] = { imports: interesting, mocks: mockMatches };
  }
}

writeFileSync(join(import.meta.dirname, 'analysis.json'), JSON.stringify(report, null, 2));

let totalFiles = Object.keys(report).length;
let totalImports = 0;
let totalMocks = 0;
for (const f of Object.values(report)) {
  totalImports += f.imports.length;
  totalMocks += f.mocks.length;
}
console.log(`files with core reach: ${totalFiles}`);
console.log(`total core import refs: ${totalImports}`);
console.log(`total vi.mock refs: ${totalMocks}`);
