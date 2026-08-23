#!/usr/bin/env node
/**
 * `moba2d-pack-new <directory> [--id <packId>] [--name "<display name>"]`
 *
 * Scaffolds a complete, runnable `@moba2d/core` content pack into an empty
 * directory: `package.json`, a strict `tsconfig.json`, a Vitest config and
 * setup file, one champion with one ability, one map, and a README that
 * says what to run next.
 *
 * Every file it writes is read from `scripts/templates/pack/**` — real
 * files under version control, not inline template literals. That is a
 * deliberate reversal of `scripts/new-spell.mjs`, the prior art this
 * generator (and `pack-add.mjs`) replaces for pack content: that script's
 * spell and test bodies are JS template strings, and its `TESTS_DIR`
 * pointed at an abandoned directory for a day before anyone noticed,
 * because nothing typechecks, lints or greps a string. A `.tmpl` file on
 * disk is subject to every tool this repository already runs — including,
 * eventually, its own author's editor.
 *
 * Four tokens, and only four, appear in the template tree:
 * `__PACK_ID__`, `__PACK_NAME__`, `__CHAMPION__`, `__SLOT__`. This command
 * fixes `__CHAMPION__` at `Hero` and `__SLOT__` at `Q` — one deliberately
 * unglamorous example, not a menu of choices; `moba2d-pack-add` is how a
 * real second ability, at a real slot, gets added afterwards.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ROOT = join(ROOT, 'scripts/templates/pack');

const die = message => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

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

const targetArg = positional[0];
if (!targetArg) {
  die('usage: moba2d-pack-new <directory> [--id <packId>] [--name "<display name>"]');
}

const targetPath = resolve(process.cwd(), targetArg).replace(new RegExp(`${sep}+$`), '');

// ─── derive id / name ───────────────────────────────────────────────────────

/** `"My Cool Pack"` / `"my_cool_pack"` -> `"my-cool-pack"`. */
const slugify = value =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** `"my-cool-pack"` -> `"My Cool Pack"`. */
const titleCase = value =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');

const packId = flags.id ?? slugify(targetPath.split(sep).pop() ?? '');
if (!packId) {
  die(`could not derive a pack id from "${targetArg}" — pass one explicitly: --id <packId>`);
}

const packName = flags.name ?? titleCase(packId);

// The one sample champion and slot every scaffold ships with — fixed, not
// a flag: `moba2d-pack-add spell --champion X --slot W` is how a pack
// grows past this one example.
const CHAMPION = 'Hero';
const SLOT = 'Q';

const TOKENS = {
  __PACK_ID__: packId,
  __PACK_NAME__: packName,
  __CHAMPION__: CHAMPION,
  __SLOT__: SLOT,
};

function substitute(text) {
  let out = text;
  for (const [token, value] of Object.entries(TOKENS)) out = out.split(token).join(value);
  return out;
}

// ─── refuse a non-empty target ───────────────────────────────────────────────

if (existsSync(targetPath)) {
  if (readdirSync(targetPath).length > 0) {
    die(`${targetPath} is not empty. moba2d-pack-new only writes into an empty directory.`);
  }
} else {
  mkdirSync(targetPath, { recursive: true });
}

// ─── walk the template tree and write ────────────────────────────────────────

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

if (!existsSync(TEMPLATE_ROOT)) {
  die(
    `scripts/templates/pack is missing from this install of @moba2d/core — ` +
      `the template tree did not ship. This is a packaging defect, not something to work around.`
  );
}

const templateFiles = walk(TEMPLATE_ROOT);
let written = 0;
for (const file of templateFiles) {
  const rel = relative(TEMPLATE_ROOT, file);
  if (!rel.endsWith('.tmpl')) {
    die(`unexpected non-.tmpl file under scripts/templates/pack: ${rel}`);
  }

  let outRel = substitute(rel.slice(0, -'.tmpl'.length));
  const segments = outRel.split(sep);
  // `gitignore.tmpl` -> `.gitignore`. Named without the leading dot on
  // disk so it is never mistaken for a hidden file of *this* repository's
  // own (a `.gitignore` under `scripts/templates/` would apply to nothing
  // and confuse every tool that lists this directory); the dot is added
  // back only on write, into the pack being scaffolded.
  if (segments[segments.length - 1] === 'gitignore') {
    segments[segments.length - 1] = '.gitignore';
    outRel = segments.join(sep);
  }

  const outPath = join(targetPath, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, substitute(readFileSync(file, 'utf8')));
  written++;
}

// ─── done ─────────────────────────────────────────────────────────────────────

console.log(`
  ${packName} (@moba2d/content-${packId}) scaffolded at ${targetPath} — ${written} file(s) written.

  Next:

    cd ${targetArg}
    npm install
    npm test
`);
