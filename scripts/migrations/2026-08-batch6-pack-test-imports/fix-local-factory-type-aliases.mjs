// Fifth pass, run once — after `git mv tests/packs/riot packs/riot/tests`
// and `fix-relative-depth.mjs` (content-pack-extraction batch 6 task 6):
// adds a `type X = InstanceType<typeof X>;` self-referential alias for every
// locally-constructed spell-object factory result that turned out to be
// used in TYPE position somewhere in its own file's body — the same
// `TS2749: 'X' refers to a value, but is being used as a type here` shape
// `fix-type-aliases.mjs` (batch 6 task 5's own third pass) already fixes for
// a *shared engine class* reached through `__api.<namespace>.<Name>`.
//
// This is a different shape, not a duplicate: `const Anivia_E_Bolt =
// makeAnivia_E_Bolt(__api);` is a *local* binding, declared once per file,
// with no `__api` namespace to walk — the alias is self-referential
// (`typeof Anivia_E_Bolt` reads the const two lines above it, not a path
// through `__api`), which is simpler than `fix-type-aliases.mjs`'s
// `ACCESS_PATH` lookup and does not need one.
//
// Found the same way that script's own header says its list was: `tsc -p
// packs/riot/tsconfig.json` is the first program that has ever typechecked
// this tree (no config reached `tests/packs/riot/**` before this task moved
// it inside the pack — see task-6-brief.md's own "Something the review of
// Task 5 found" section) — every entry below is a real `TS2749` from that
// run, not a guess.
//
// Run with:
//   node scripts/migrations/2026-08-batch6-pack-test-imports/fix-local-factory-type-aliases.mjs         (dry run)
//   node scripts/migrations/2026-08-batch6-pack-test-imports/fix-local-factory-type-aliases.mjs --write
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../');
const WRITE = process.argv.includes('--write');

// file (relative to repo root) -> local factory-result names needing a
// self-referential `InstanceType<typeof X>` alias in that file.
const NEEDS = {
  'packs/riot/tests/spells/Anivia_E.test.ts': ['Anivia_E_Bolt'],
  'packs/riot/tests/spells/Anivia_R.test.ts': ['Anivia_R', 'Anivia_R_Object'],
  'packs/riot/tests/spells/Anivia_W.test.ts': ['Anivia_W_Object'],
  'packs/riot/tests/spells/Annie_QE.test.ts': ['Annie_Q'],
  'packs/riot/tests/spells/Ashe_R.test.ts': ['Ashe_R_Object'],
  'packs/riot/tests/spells/Blitzcrank_Q.test.ts': ['Blitzcrank_Q_Object'],
  'packs/riot/tests/spells/Brand.test.ts': ['Brand_Q_Missile', 'Brand_R_Fireball', 'Brand_W_Object'],
  'packs/riot/tests/spells/Caitlyn.test.ts': ['Caitlyn_E_Net', 'Caitlyn_W_Trap'],
  'packs/riot/tests/spells/Camille_R.test.ts': ['Camille_R_Object'],
  'packs/riot/tests/spells/Ezreal.test.ts': ['Ezreal_Q_Object'],
  'packs/riot/tests/spells/Irelia.test.ts': ['Irelia_W_Guard'],
  'packs/riot/tests/spells/Janna_E.test.ts': ['Janna_E_Shell'],
  'packs/riot/tests/spells/Janna_Q.test.ts': ['Janna_Q_Object'],
  'packs/riot/tests/spells/Janna_R.test.ts': ['Janna_R_Object'],
  'packs/riot/tests/spells/Janna_W.test.ts': ['Janna_W_Bolt', 'Janna_W_Passive'],
  'packs/riot/tests/spells/Jhin.test.ts': ['Jhin_E_Trap', 'Jhin_Q', 'Jhin_Q_Object', 'Jhin_R', 'Jhin_W'],
  'packs/riot/tests/spells/Jinx_R.test.ts': ['Jinx_R_Object', 'Jinx_R_Smoke'],
  'packs/riot/tests/spells/Leblanc_Q.test.ts': ['Leblanc_Q_Mark', 'Leblanc_Q_Object'],
  'packs/riot/tests/spells/Leblanc_R.test.ts': ['Leblanc_Q', 'Leblanc_Q_Object', 'Leblanc_R'],
  'packs/riot/tests/spells/Lux_R.test.ts': ['Lux_E_Object'],
  'packs/riot/tests/spells/Malphite_E.test.ts': ['Malphite_E_Object'],
  'packs/riot/tests/spells/Malphite_Q.test.ts': ['Malphite_Q_Object'],
  'packs/riot/tests/spells/Malphite_W.test.ts': ['Malphite_W_Armor'],
  'packs/riot/tests/spells/Malzahar.test.ts': [
    'Malzahar_E_Object',
    'Malzahar_Q_Object',
    'Malzahar_R_Zone',
    'Malzahar_W_Rift',
    'Malzahar_W_Voidling',
  ],
  'packs/riot/tests/spells/MasterYi.test.ts': ['MasterYi_Q_Object'],
  'packs/riot/tests/spells/Morgana_R.test.ts': ['Morgana_R'],
  'packs/riot/tests/spells/Morgana_W.test.ts': ['Morgana_W'],
  'packs/riot/tests/spells/Nautilus.test.ts': ['Nautilus_Q_Object', 'Nautilus_R_Eruption'],
  'packs/riot/tests/spells/Nocturne_Q.test.ts': ['Nocturne_Dusk', 'Nocturne_Q_Object', 'Nocturne_Q_Trail'],
  'packs/riot/tests/spells/Pantheon.test.ts': ['Pantheon_R_Skyward'],
  'packs/riot/tests/spells/Pantheon_Q.test.ts': ['Pantheon_Q_Spear', 'Pantheon_Q_Thrust'],
  'packs/riot/tests/spells/Rammus_R.test.ts': ['Rammus_R_Leap'],
  'packs/riot/tests/spells/Riven.test.ts': ['Riven_R_WindSlash'],
  'packs/riot/tests/spells/Sett.test.ts': ['Sett_R_Carry'],
  'packs/riot/tests/spells/Soraka.test.ts': ['Soraka_E_Object', 'Soraka_Q_Object'],
  'packs/riot/tests/spells/Syndra.test.ts': ['Syndra_Sphere'],
  'packs/riot/tests/spells/Teemo_E.test.ts': ['Teemo_E_Object'],
  'packs/riot/tests/spells/Teemo_W.test.ts': ['Teemo_W_Burst'],
  'packs/riot/tests/spells/Thresh_WE.test.ts': [
    'Thresh_E_Object',
    'Thresh_W_Lantern_Throw',
    'Thresh_W_Object',
  ],
  'packs/riot/tests/spells/Twitch_Q.test.ts': ['Twitch_Q_Object'],
  'packs/riot/tests/spells/Varus_Q.test.ts': ['Varus_Q_Arrow'],
  'packs/riot/tests/spells/Veigar_Q.test.ts': ['Veigar_Q', 'Veigar_Q_Object'],
  'packs/riot/tests/spells/Veigar_R.test.ts': ['Veigar_R_Burst', 'Veigar_R_Object'],
  'packs/riot/tests/spells/Veigar_W.test.ts': ['Veigar_W_Object'],
  'packs/riot/tests/spells/XinZhao.test.ts': ['XinZhao_W_Object'],
};

function fixFile(relPath, names) {
  const file = join(ROOT, relPath);
  const original = readFileSync(file, 'utf8');
  let source = original;

  for (const name of names) {
    const aliasLine = `type ${name} = InstanceType<typeof ${name}>;`;
    if (source.includes(aliasLine)) continue; // already present

    // The local `const X = makeX(__api);` (or `makeSomethingElse_X`) —
    // anchored at the start of a line, so a use inside a template literal
    // or a comment naming the same identifier cannot match.
    const declRe = new RegExp(`^const\\s+${name}\\s*=.*;\\n`, 'm');
    const m = declRe.exec(source);
    if (!m) {
      console.log(`MANUAL ${relPath}: no top-level "const ${name} = ...;" found — check by hand`);
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
