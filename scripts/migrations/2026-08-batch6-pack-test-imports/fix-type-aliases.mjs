// Third pass, run after transform.mjs + consolidate.mjs: adds a
// `type X = InstanceType<typeof __api...X>;` alias for every REACHABLE
// class-shaped name that turned out to be used in TYPE position somewhere in
// a file's body, beyond the three (`AttackableUnit`, `Spell`, `Rectangle`)
// the survey flagged. Found empirically, not guessed: `tsc --noEmit` against
// a scratch tsconfig covering tests/packs/riot, diffed before/after the
// mechanical rewrite (see task-5-report.md's "Quality" section) — every
// entry below is a real `TS2749: 'X' refers to a value, but is being used as
// a type here` that only appears after the rewrite.
//
// Run with:
//   node scripts/migrations/2026-08-batch6-pack-test-imports/fix-type-aliases.mjs         (dry run)
//   node scripts/migrations/2026-08-batch6-pack-test-imports/fix-type-aliases.mjs --write
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../');
const WRITE = process.argv.includes('--write');

// name -> the `__api` access path whose namespace already has a destructure
// line in the affected files ('' for the api's own top level).
const ACCESS_PATH = {
  Champion: 'units',
  Dash: 'buffs',
  StatAmp: 'buffs',
  Shield: 'buffs',
  Slow: 'buffs',
  BeamSpellObject: '',
  Speedup: 'buffs',
  DamageOverTime: 'buffs',
  Stun: 'buffs',
  Untargetable: 'buffs',
  AoePulse: '',
};

// file (relative to repo root) -> names needing an alias in that file.
const NEEDS = {
  'tests/packs/riot/spells/Anivia_W.test.ts': ['Champion'],
  'tests/packs/riot/spells/Annie_QE.test.ts': ['Champion'],
  'tests/packs/riot/spells/Blitzcrank_Q.test.ts': ['Champion', 'Dash'],
  'tests/packs/riot/spells/Janna_E.test.ts': ['Champion', 'StatAmp', 'Shield'],
  'tests/packs/riot/spells/Janna_W.test.ts': ['Champion', 'Slow'],
  'tests/packs/riot/spells/Malzahar.test.ts': ['Champion', 'Stun'],
  'tests/packs/riot/spells/MasterYi.test.ts': ['Champion', 'Shield', 'Untargetable'],
  'tests/packs/riot/spells/Rammus_WE.test.ts': ['Champion'],
  'tests/packs/riot/spells/Veigar_Q.test.ts': ['Champion'],
  'tests/packs/riot/spells/Warwick_R.test.ts': ['Champion'],
  'tests/packs/riot/spells/Caitlyn.test.ts': ['Dash', 'Slow'],
  'tests/packs/riot/spells/Camille_R.test.ts': ['Dash'],
  'tests/packs/riot/spells/Darius.test.ts': ['Dash'],
  'tests/packs/riot/spells/Ezreal.test.ts': ['Dash'],
  'tests/packs/riot/spells/Nautilus.test.ts': ['Dash'],
  'tests/packs/riot/spells/Pantheon.test.ts': ['Dash'],
  'tests/packs/riot/spells/Rammus_R.test.ts': ['Dash'],
  'tests/packs/riot/spells/Renekton.test.ts': ['Dash'],
  'tests/packs/riot/spells/Singed_E.test.ts': ['Dash'],
  'tests/packs/riot/spells/Thresh_WE.test.ts': ['Dash'],
  'tests/packs/riot/spells/Tryndamere.test.ts': ['Dash', 'StatAmp'],
  'tests/packs/riot/spells/Vayne.test.ts': ['Dash'],
  'tests/packs/riot/spells/Vi.test.ts': ['Dash'],
  'tests/packs/riot/spells/Malphite_E.test.ts': ['StatAmp', 'Slow'],
  'tests/packs/riot/spells/Malphite_W.test.ts': ['StatAmp', 'Shield'],
  'tests/packs/riot/spells/Malphite_Q.test.ts': ['Slow', 'Speedup'],
  'tests/packs/riot/spells/Morgana_R.test.ts': ['Slow', 'Speedup', 'Stun'],
  'tests/packs/riot/spells/Lux_R.test.ts': ['BeamSpellObject'],
  'tests/packs/riot/spells/Pantheon_Q.test.ts': ['BeamSpellObject'],
  'tests/packs/riot/spells/Katarina.test.ts': ['Speedup'],
  'tests/packs/riot/spells/Teemo_W.test.ts': ['Speedup'],
  'tests/packs/riot/spells/Teemo_E.test.ts': ['DamageOverTime'],
  'tests/packs/riot/spells/Jinx_R.test.ts': ['AoePulse'],
};

function fixFile(relPath, names) {
  const file = join(ROOT, relPath);
  const original = readFileSync(file, 'utf8');
  const apiVarMatch = /\bconst\s+(__api|api)\s*=\s*buildTestApi\(/.exec(original);
  if (!apiVarMatch) {
    console.log(`SKIP ${relPath}: no "const __api = buildTestApi(...)" found`);
    return null;
  }
  const apiVar = apiVarMatch[1];

  let source = original;
  for (const name of names) {
    const nsPath = ACCESS_PATH[name];
    const fullPath = nsPath ? `${apiVar}.${nsPath}.${name}` : `${apiVar}.${name}`;
    const aliasLine = `type ${name} = InstanceType<typeof ${fullPath}>;`;
    if (source.includes(aliasLine)) continue; // already present

    // Anchor after the destructure line that pulls this name's namespace in
    // (`const { Champion } = __api.units;`), or — if this name shares a
    // destructure line with others — after that line, wherever it sits.
    const destructureRe = nsPath
      ? new RegExp(`const\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*${apiVar}\\.${nsPath};\\n?`)
      : new RegExp(`const\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*${apiVar};\\n?`);
    const m = destructureRe.exec(source);
    if (!m) {
      console.log(`MANUAL ${relPath}: no destructure line found for "${name}" — check by hand`);
      continue;
    }
    const at = m.index + m[0].length;
    source = source.slice(0, at) + aliasLine + '\n' + source.slice(at);
  }
  return source === original ? null : source;
}

function main() {
  let changed = 0;
  for (const [relPath, names] of Object.entries(NEEDS)) {
    const result = fixFile(relPath, names);
    if (result) {
      changed++;
      console.log(relPath);
      if (WRITE) writeFileSync(join(ROOT, relPath), result);
    }
  }
  console.log(`\n${changed} file(s) ${WRITE ? 'fixed' : 'would be fixed'}`);
}

main();
