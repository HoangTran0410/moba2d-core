#!/usr/bin/env node
/**
 * `moba2d-pack-new <directory> [--id <packId>] [--name "<display name>"]
 *                              [--core <npm spec>]`
 *
 * Scaffolds a complete, runnable, *publishable* `@moba2d/core` content pack
 * into an empty directory: `package.json`, a strict `tsconfig.json`, a
 * Vitest config and setup file, one champion with one ability, one map, the
 * Vite config and manifest writer a runtime install is served by, a GitHub
 * Pages workflow that publishes them, and a README that says what to run
 * next.
 *
 * Publishable is the point, and it is the half that used to be missing. A
 * pack that only typechecks against a checkout of core sitting beside it is
 * a package; what makes it a thing a *player* can install is
 * `dist/manifest.json` at a URL, which is `runtime-entry.ts` +
 * `vite.config.ts` + `scripts/pack-manifest.mjs` + the workflow. Every one
 * of those was something a pack author had to discover by reading an
 * existing pack's source.
 *
 * Every file it writes is read from `scripts/templates/pack/**` — real
 * files under version control, not inline template literals. That is a
 * deliberate reversal of `scripts/pack-add.mjs`, the prior art this
 * generator (and `pack-add.mjs`) replaces for pack content: that script's
 * spell and test bodies are JS template strings, and its `TESTS_DIR`
 * pointed at an abandoned directory for a day before anyone noticed,
 * because nothing typechecks, lints or greps a string. A `.tmpl` file on
 * disk is subject to every tool this repository already runs — including,
 * eventually, its own author's editor.
 *
 * Five tokens, and only five, appear in the template tree:
 * `__PACK_ID__`, `__PACK_NAME__`, `__CHAMPION__`, `__SLOT__`,
 * `__CORE_SPEC__`. This command fixes `__CHAMPION__` at `Hero` and
 * `__SLOT__` at `Q` — one deliberately unglamorous example, not a menu of
 * choices; `moba2d-pack-add` is how a real second ability, at a real slot,
 * gets added afterwards.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  die(
    'usage: moba2d-pack-new <directory> [--id <packId>] [--name "<display name>"] ' +
      '[--core <npm spec>]'
  );
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

// The one sample champion every scaffold ships with, and the four slots it
// ships filled — fixed, not flags: `moba2d-pack-add spell --champion X
// --slot W` is how a pack grows past this one example.
//
// Four, not one, because core refuses to install a `playable` champion with
// any other number: `validatePackData` reads "playable champion needs
// exactly four abilities", and a scaffold that shipped one produced a pack
// that built, typechecked, passed its own tests, published — and then failed
// in the browser, at install, with the URL already handed out. Every
// template whose *path* contains `__SLOT__` is therefore rendered once per
// slot below, from the same file: four near-identical bolts, which is the
// point, since making them different is the first thing a pack author does.
const CHAMPION = 'Hero';
const SLOTS = ['Q', 'W', 'E', 'R'];

/**
 * What the scaffolded `package.json` declares `@moba2d/core` as.
 *
 * A registry range is not an option: core is published to no registry, so
 * the `"*"` this template carried for its first life made `npm install` —
 * the very next line the scaffold prints — fail with a 404 for every person
 * who ran it. A git spec resolves today, from any machine, with nothing
 * installed first.
 *
 * `--core` is for the case the default cannot cover: developing a pack
 * beside a local checkout of core (`--core file:../moba2d-core`), or against
 * a fork, a branch, or a tarball. Whatever is passed is written through
 * verbatim — npm is the thing that understands these strings, not this
 * script, and pretending to validate them here would only reject specs npm
 * accepts.
 */
const DEFAULT_CORE_SPEC = 'github:moba2d-game/core#main';
const coreSpec = flags.core === 'true' || !flags.core ? DEFAULT_CORE_SPEC : flags.core;

const TOKENS = {
  __PACK_ID__: packId,
  __PACK_NAME__: packName,
  __CHAMPION__: CHAMPION,
  __CORE_SPEC__: coreSpec,
};

/** Every token but `__SLOT__`, which a per-slot render supplies itself. */
function substitute(text, slot) {
  let out = text;
  for (const [token, value] of Object.entries(TOKENS)) out = out.split(token).join(value);
  return slot === undefined ? out : out.split('__SLOT__').join(slot);
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

  // A `__SLOT__` in the *path* means one template, four files.
  const slots = rel.includes('__SLOT__') ? SLOTS : [undefined];
  for (const slot of slots) written += writeTemplate(file, rel, slot);
}

function writeTemplate(file, rel, slot) {
  let outRel = substitute(rel.slice(0, -'.tmpl'.length), slot);
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
  // `github/workflows/...` -> `.github/workflows/...`, for the same reason
  // and one worse: a real `.github/` anywhere in a repository is a directory
  // GitHub's own tooling reads, and templates for *another* repository's
  // workflows are the last thing this one wants scanned as its own.
  if (segments[0] === 'github') {
    segments[0] = '.github';
    outRel = segments.join(sep);
  }

  // `x.png.b64.tmpl` -> `x.png`, base64-decoded. Every other template is
  // text, and this loop reads them as UTF-8 — which is right, because a
  // template nothing can grep is a template nobody maintains. But a pack
  // needs at least one real image file to have a working art path at all
  // (core refuses a playable champion with no portrait), and a scaffold that
  // shipped its placeholder as a data URI inside a hand-written
  // `assetManifest.ts` had no path from there to a *generated* one: the
  // generator walks `assets/`, and there was nothing in it.
  if (outRel.endsWith('.b64')) {
    outRel = outRel.slice(0, -'.b64'.length);
    const outPath = join(targetPath, outRel);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
    return 1;
  }

  const outPath = join(targetPath, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, substitute(readFileSync(file, 'utf8'), slot));
  // A git hook is the one kind of file git itself refuses to run without the
  // executable bit, and writeFileSync does not carry one over from the .tmpl.
  if (segments[0] === 'scripts' && segments[1] === 'git-hooks') chmodSync(outPath, 0o755);
  return 1;
}

// ─── done ─────────────────────────────────────────────────────────────────────

console.log(`
  ${packName} (@moba2d/content-${packId}) scaffolded at ${targetPath} — ${written} file(s) written.
  @moba2d/core: ${coreSpec}

  Next:

    cd ${targetArg}
    npm install
    npm run verify          # typecheck, seams, tests, and the published build

  Then, to put it where a player can install it:

    git init && git add -A && git commit -m "scaffold ${packId}"
    npm run hooks:install   # pre-push runs verify before anything leaves
    gh repo create <name> --public --source=. --push
    # Settings -> Pages -> Source: GitHub Actions, once, by hand
    # installs from https://<owner>.github.io/<repo>/manifest.json

  docs/PACK_AUTHORING.md in @moba2d/core is the long form of all of it.
`);
