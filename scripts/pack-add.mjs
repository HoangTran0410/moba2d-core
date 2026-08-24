#!/usr/bin/env node
/**
 * `moba2d-pack-add <spell|champion|map|monster> <Name> [--champion X] [--slot Q]`
 *
 * Adds one piece of content, and its test, to the pack the current
 * directory is inside — found by `packRootFrom` (`./lib/packRoot.mjs`),
 * never by a hardcoded path or a directory literally called `packs`, so
 * this works identically from a pack's own root, from a nested directory
 * inside it, and inside a genuinely separated pack repository.
 *
 * Only `spell` is implemented. `champion`, `map` and `monster` are named in
 * the CLI shape spec §8's own interface promises, and the plan this task
 * follows argues for adding them incrementally — but a verb this command
 * recognises and then does nothing useful with is worse than one it
 * refuses: the author assumes it worked and goes looking for files that
 * were never written. So all three are refused outright, loudly, non-zero,
 * naming every one of them and the one kind that *does* work, rather than
 * silently accepted as some quieter form of "not yet". Add a champion, a
 * map or a monster to `pack.ts` by hand in the meantime, using the
 * champion/map already there as the model.
 *
 * `spell` writes `spells/<Champion>_<Slot>.ts` and
 * `tests/<Champion>_<Slot>.test.ts` from the same two template files
 * `moba2d-pack-new` renders its own sample ability from
 * (`scripts/templates/pack/spells/__CHAMPION_____SLOT__.ts.tmpl` and its
 * test),
 * substituting the champion and slot actually asked for rather than the
 * scaffold's fixed `Hero`/`Q` default — then registers the new spell in
 * `pack.ts`: the import, the champion's own `spells: [...]` roster entry,
 * and the code half's `spells: {...}` factory map. Ported from
 * `scripts/new-spell.mjs`'s `registerInBarrel`/`registerInChampionKit`
 * (lines 568-633 as of this writing) — the working prior art for rewriting
 * a barrel and a champion's kit in place — minus that script's
 * `docs/spell-names-vi.json` dependency, which is Riot's own localisation
 * pipeline and leaves with the pack, not something a new pack has.
 *
 * `pack.ts`'s own three `// moba2d-pack-add spell: ... above this line`
 * comments are the insertion points: a plain string search for one exact,
 * greppable line, never a regex parsing nested braces to find "the end of
 * this object literal" — the shape that actually breaks the day someone
 * reformats a spacing this generator did not predict.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packRootFrom } from './lib/packRoot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ROOT = join(ROOT, 'scripts/templates/pack');

const die = message => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

// The whole CLI shape spec §8 documents — recognised as real words this
// command understands, not confused with a typo — but only the first is
// actually implemented; see this file's own header for why the other
// three are refused rather than silently accepted.
const IMPLEMENTED_KIND = 'spell';
const UNIMPLEMENTED_KINDS = ['champion', 'map', 'monster'];
const KINDS = [IMPLEMENTED_KIND, ...UNIMPLEMENTED_KINDS];
const SLOTS = ['Q', 'W', 'E', 'R'];

// ─── arguments ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const token = argv[i];
  if (token.startsWith('--')) {
    const [key, inlineValue] = token.slice(2).split('=');
    const next = argv[i + 1];
    flags[key] = inlineValue ?? (next === undefined || next.startsWith('--') ? 'true' : argv[++i]);
  } else {
    positional.push(token);
  }
}

const kind = positional[0];
const name = positional[1];

if (!kind || !KINDS.includes(kind)) {
  die(
    `usage: moba2d-pack-add <${KINDS.join('|')}> <Name> [--champion X] [--slot Q]\n\n` +
      `  <kind> must be one of: ${KINDS.join(', ')}. Only \`${IMPLEMENTED_KIND}\` is implemented — ` +
      `${UNIMPLEMENTED_KINDS.join(', ')} are recognised but every one of them refuses to run.`
  );
}
if (!name) die('a <Name> is required, e.g. moba2d-pack-add spell Bolt --champion Vera --slot W');

if (UNIMPLEMENTED_KINDS.includes(kind)) {
  die(
    `moba2d-pack-add ${kind} is not implemented — only \`${IMPLEMENTED_KIND}\` is. ` +
      `${UNIMPLEMENTED_KINDS.join(', ')} are none of them built yet; this refuses rather than ` +
      `pretending to succeed.\n` +
      `  Add a ${kind} to pack.ts by hand, using the champion/map already there as the model.`
  );
}

// ─── spell ──────────────────────────────────────────────────────────────────

// `--champion` names whose kit this joins; the positional <Name> stands in
// for it when the flag is omitted, the same "one required thing, however
// it arrives" shape `--slot` takes below.
const champion = flags.champion ?? name;
const slot = (flags.slot ?? 'Q').toUpperCase();
if (!SLOTS.includes(slot)) die(`--slot must be one of ${SLOTS.join(', ')}`);

/** `"Sun Wukong"` -> `"SunWukong"` — what the class and the file are called. */
const classPrefix = champion.replace(/[^A-Za-z0-9]/g, '');
if (!classPrefix) {
  die(`--champion "${champion}" has no letters or digits left once sanitised.`);
}
const slug = `${classPrefix}_${slot}`;

const packRoot = packRootFrom(process.cwd());
const spellFile = join(packRoot, 'spells', `${slug}.ts`);
const testFile = join(packRoot, 'tests', `${slug}.test.ts`);
const packFile = join(packRoot, 'pack.ts');

const force = flags.force === 'true' || flags.force === true;
if (existsSync(spellFile) && !force) {
  die(`spells/${slug}.ts already exists. Pass --force to overwrite it.`);
}

const spellTemplatePath = join(TEMPLATE_ROOT, 'spells/__CHAMPION_____SLOT__.ts.tmpl');
const testTemplatePath = join(TEMPLATE_ROOT, 'tests/__CHAMPION_____SLOT__.test.ts.tmpl');
if (!existsSync(spellTemplatePath) || !existsSync(testTemplatePath)) {
  die(
    'scripts/templates/pack is missing from this install of @moba2d/core — ' +
      'the template tree did not ship. This is a packaging defect, not something to work around.'
  );
}

/** Only the two tokens a spell/test body actually uses — see this file's own header. */
const substitute = text =>
  text.split('__CHAMPION__').join(classPrefix).split('__SLOT__').join(slot);

writeFileSync(spellFile, substitute(readFileSync(spellTemplatePath, 'utf8')));

const testExisted = existsSync(testFile);
if (!testExisted) writeFileSync(testFile, substitute(readFileSync(testTemplatePath, 'utf8')));

// ─── registration ─────────────────────────────────────────────────────────────

const IMPORT_MARKER = '// moba2d-pack-add spell: new imports go above this line';
const KIT_MARKER = '        // moba2d-pack-add spell: new slot ids go above this line';
const CODE_MARKER = '    // moba2d-pack-add spell: new entries go above this line';

/**
 * Inserts `line` immediately before the first (and, if this pack's own
 * `pack.ts` still matches the scaffold's shape, only) occurrence of
 * `marker`. Reports which happened, the same three outcomes
 * `scripts/new-spell.mjs`'s own `registerInBarrel`/`registerInChampionKit`
 * report: already present, written, or the marker is gone and this needs a
 * human.
 */
function insertBeforeMarker(source, marker, line, already) {
  if (source.includes(already)) return { source, message: 'already registered' };
  if (!source.includes(marker)) {
    return {
      source,
      message: `no \`${marker.trim()}\` marker found in pack.ts — add \`${line.trim()}\` by hand`,
    };
  }
  return { source: source.replace(marker, `${line}\n${marker}`), message: 'registered' };
}

let packSource = readFileSync(packFile, 'utf8');

const importResult = insertBeforeMarker(
  packSource,
  IMPORT_MARKER,
  `import make${slug} from './spells/${slug}';`,
  `from './spells/${slug}'`
);
packSource = importResult.source;

// The roster marker sits inside exactly one champion's `spells: [...]`
// today, because this generator writes exactly one champion — but nothing
// stops a `--champion` typo, or a name that once existed and was renamed,
// from silently landing a spell in a stranger's kit. `name: '<champion>'`
// has to actually appear in pack.ts before this touches the marker at all.
const championNameLine = `name: '${champion}'`;
const kitResult = packSource.includes(championNameLine)
  ? insertBeforeMarker(packSource, KIT_MARKER, `        '${slug}',`, `'${slug}'`)
  : {
      source: packSource,
      message: `no champion named '${champion}' in pack.ts — add '${slug}' to its spells: [] by hand`,
    };
packSource = kitResult.source;

const codeResult = insertBeforeMarker(
  packSource,
  CODE_MARKER,
  `    ${slug}: make${slug}(api),`,
  `${slug}: make${slug}(api)`
);
packSource = codeResult.source;

writeFileSync(packFile, packSource);

// ─── done ─────────────────────────────────────────────────────────────────────

const displayRoot = relative(process.cwd(), packRoot) || '.';

console.log(`
  ${slug} written into ${displayRoot}

    spell    spells/${slug}.ts
    test     ${testExisted ? `tests/${slug}.test.ts (kept — already existed)` : `tests/${slug}.test.ts`}
    import   ${importResult.message}
    roster   ${kitResult.message}
    code     ${codeResult.message}

  Next:

    1. Write the player-visible script into the test names before touching
       the spell body — "press once and X happens" — then run it, watch it
       fail, and read the message.
    2. Fill in spells/${slug}.ts, and add a spellDisplay entry for '${slug}'
       to pack.ts — this command does not write one.
    3. npm test && npm run check-seams
`);
