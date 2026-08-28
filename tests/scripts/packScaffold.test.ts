/**
 * Content-pack-and-repo-split batch 6 task 8: the scaffold.
 *
 * `moba2d-pack-new`/`moba2d-pack-add` are what decides whether anyone would
 * actually want to write a new pack against `@moba2d/core` — everything up
 * to this task only proved a pack could *leave*. Three things pinned here,
 * matching the brief's own three bullets:
 *
 *  1. `packRootFrom` finds the pack root from a nested directory, and
 *     throws a named error at core's own root (which has no dependency on
 *     itself — the same "derive it, don't count `..`s" shape
 *     `packs/riot/tests/support/packRoot.ts` is the prior art for).
 *  2. `moba2d-pack-new` into an empty temp directory writes every file the
 *     template tree declares, and leaves no `__TOKEN__` anywhere in the
 *     output — the one assertion that catches a template growing a token
 *     the substitution table does not know about, the failure mode of
 *     every scaffold ever written.
 *  3. `moba2d-pack-add spell` into that scaffold adds exactly two files
 *     (the spell, its test) and edits `pack.ts` — the import, the
 *     champion's roster entry, and the code half's factory map.
 *
 * Every fixture lives under its own `mkdtemp` directory and is spawned
 * through `node <script>.mjs` directly (never through
 * `node_modules/.bin/...`), the same shape `tests/scripts/
 * checkSeams.bin.test.ts` uses for its own non-bin-symlink cases — this
 * suite does not need a fresh `npm install` to have run to prove the
 * scripts themselves are correct.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { packRootFrom } from '../../scripts/lib/packRoot.mjs';
import { satisfiesCoreRange } from '@/content/packSource';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packNewScript = join(repoRoot, 'scripts/pack-new.mjs');
const packAddScript = join(repoRoot, 'scripts/pack-add.mjs');
const templateRoot = join(repoRoot, 'scripts/templates/pack');

const tmpDirs: string[] = [];
async function freshTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

/** Every file under `scripts/templates/pack/`, relative, `.tmpl` included. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full, base)));
    else found.push(relative(base, full));
  }
  return found;
}

/**
 * The output path(s) `pack-new` writes a `.tmpl` file's contents to.
 *
 * Plural because a `__SLOT__` in the *path* means one template and four
 * files: core refuses to install a `playable` champion with any number of
 * abilities but four, so the scaffold renders its one spell template once
 * per slot rather than shipping a pack that cannot be published.
 */
function outputPathsFor(templateRelPath: string): string[] {
  let withoutExt = templateRelPath.slice(0, -'.tmpl'.length).replaceAll('__CHAMPION__', 'Hero');
  // `x.png.b64.tmpl` -> `x.png`, base64-decoded on write. Every other template
  // is text and read as UTF-8, which is right — a template nothing can grep is
  // a template nobody maintains — but a pack needs one real image file to have
  // a working art path at all, and a placeholder living as a data URI inside a
  // hand-written manifest gave a scaffolded pack no route to a *generated* one.
  if (withoutExt.endsWith('.b64')) withoutExt = withoutExt.slice(0, -'.b64'.length);
  const segments = withoutExt.split('/');
  if (segments[segments.length - 1] === 'gitignore') segments[segments.length - 1] = '.gitignore';
  // `github/` -> `.github/`, the same reason `gitignore` has no leading dot
  // on disk: a real `.github/` under this repository's own
  // `scripts/templates/` is a directory GitHub's own tooling scans.
  if (segments[0] === 'github') segments[0] = '.github';
  const joined = segments.join('/');
  if (!joined.includes('__SLOT__')) return [joined];
  return ['Q', 'W', 'E', 'R'].map(slot => joined.replaceAll('__SLOT__', slot));
}

function runScript(script: string, args: string[], cwd: string) {
  return spawnSync('node', [script, ...args], { cwd, encoding: 'utf8' });
}

async function scaffold(dir: string, extraArgs: string[] = []) {
  return runScript(
    packNewScript,
    [dir, '--id', 'demo-pack', '--name', 'Demo Pack', ...extraArgs],
    repoRoot
  );
}

/**
 * Takes one slot back out of a scaffolded pack — the two files and all three
 * of its registrations — leaving the kit with a hole in it.
 *
 * The scaffold ships all four slots filled, because core installs no other
 * kind of playable champion, so "a free slot to add" is a state that has to
 * be arranged rather than assumed. It is not a contrived one: a kit with a
 * hole is exactly what a pack looks like halfway through being written, and
 * it is the only state in which `moba2d-pack-add spell` has anything to do.
 */
async function openSlot(target: string, slot: string): Promise<void> {
  await rm(join(target, `spells/Hero_${slot}.ts`));
  await rm(join(target, `tests/Hero_${slot}.test.ts`));
  // Two registrations, not three: the barrel is what the catalogue generator
  // reads, and the champion's kit is what the roster names. There is no
  // import line and no factory map in `pack.ts` any more — the generator
  // derives both from the barrel.
  for (const file of ['pack.ts', 'spells/index.ts']) {
    const path = join(target, file);
    const source = await readFile(path, 'utf8');
    await writeFile(
      path,
      source
        .split('\n')
        .filter(line => !new RegExp(`\\bHero_${slot}\\b`).test(line))
        .join('\n')
    );
  }
}

describe('packRootFrom', () => {
  it('finds the pack root from a nested directory inside it', async () => {
    const root = await freshTmpDir('moba2d-packroot-nested-');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: '@moba2d/content-demo', devDependencies: { '@moba2d/core': '*' } })
    );
    const nested = join(root, 'spells', 'deeper');
    await mkdir(nested, { recursive: true });

    expect(packRootFrom(nested)).toBe(root);
  });

  it('finds the pack root when @moba2d/core is a plain dependency, not a devDependency', async () => {
    const root = await freshTmpDir('moba2d-packroot-dep-');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: '@moba2d/content-demo', dependencies: { '@moba2d/core': '*' } })
    );

    expect(packRootFrom(root)).toBe(root);
  });

  it("throws a named error walking up from core's own repository root", () => {
    // Core's own package.json names itself `@moba2d/core` — it does not
    // depend on itself — so the walk must climb past it to the filesystem
    // root and throw, never mistake self-naming for the dependency this
    // function is actually looking for.
    expect(() => packRootFrom(repoRoot)).toThrow(/@moba2d\/core/);
  });

  it('does not stop at an unrelated package.json that does not name @moba2d/core', async () => {
    const root = await freshTmpDir('moba2d-packroot-unrelated-');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'unrelated-project' }));
    const nested = join(root, 'nested');
    await mkdir(nested, { recursive: true });

    expect(() => packRootFrom(nested)).toThrow(/@moba2d\/core/);
  });
});

describe('moba2d-pack-new', () => {
  it('writes every file the template tree declares, substituting all four tokens', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);

    expect(result.status, result.stdout + result.stderr).toBe(0);

    const templateFiles = (await walk(templateRoot)).filter(f => f.endsWith('.tmpl'));
    const expectedOutputs = templateFiles.flatMap(outputPathsFor).sort();
    const actualOutputs = (await walk(target)).sort();

    expect(actualOutputs).toEqual(expectedOutputs);
  });

  it('leaves no __TOKEN__ marker anywhere in the scaffolded output', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-tokens-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const files = await walk(target);
    const leftovers: string[] = [];
    for (const file of files) {
      const content = await readFile(join(target, file), 'utf8');
      const matches = content.match(/__[A-Z][A-Z0-9_]*__/g);
      if (matches) leftovers.push(`${file}: ${[...new Set(matches)].join(', ')}`);
    }

    expect(leftovers).toEqual([]);
  });

  it('substitutes --id and --name into package.json and pack.ts', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-values-');
    const target = join(parent, 'pack');
    const result = await scaffold(target, []);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@moba2d/content-demo-pack');

    const packSource = await readFile(join(target, 'pack.ts'), 'utf8');
    expect(packSource).toContain("id: 'demo-pack'");
    expect(packSource).toContain('Demo Pack');
  });

  it('refuses to write into a non-empty directory', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-nonempty-');
    const target = join(parent, 'pack');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'already-here.txt'), 'hello');

    const result = runScript(packNewScript, [target, '--id', 'demo'], repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/not empty/);
    // Refused before writing anything else into it.
    expect((await readdir(target)).sort()).toEqual(['already-here.txt']);
  });
});

describe('moba2d-pack-add spell', () => {
  it('adds exactly two files and edits the barrel', async () => {
    const parent = await freshTmpDir('moba2d-pack-add-');
    const target = join(parent, 'pack');
    const scaffoldResult = await scaffold(target);
    expect(scaffoldResult.status, scaffoldResult.stdout + scaffoldResult.stderr).toBe(0);
    await openSlot(target, 'W');

    const before = new Set(await walk(target));
    const packBefore = await readFile(join(target, 'pack.ts'), 'utf8');

    const addResult = runScript(
      packAddScript,
      ['spell', 'Bolt', '--champion', 'Hero', '--slot', 'W'],
      target
    );
    expect(addResult.status, addResult.stdout + addResult.stderr).toBe(0);

    const after = await walk(target);
    const added = after.filter(f => !before.has(f)).sort();
    expect(added).toEqual(['spells/Hero_W.ts', 'tests/Hero_W.test.ts']);

    const packAfter = await readFile(join(target, 'pack.ts'), 'utf8');
    expect(packAfter).not.toBe(packBefore);
    expect(packAfter).toContain("'Hero_W'");
    // The original spell's own registration is undisturbed.
    expect(packAfter).toContain("'Hero_Q'");

    // The barrel is the other half, and the one the generator reads.
    const barrel = await readFile(join(target, 'spells/index.ts'), 'utf8');
    expect(barrel).toContain("export { default as Hero_W } from './Hero_W';");
    expect(barrel).toContain("export { default as Hero_Q } from './Hero_Q';");
  });

  it('the roster entry itself is written when --champion matches an existing champion name exactly', async () => {
    // "adds exactly two files and edits the barrel" above already touches
    // this path incidentally; this pins it directly, against the
    // mis-registration bug self-review found (a --champion typo used to
    // silently land the new spell id in whichever champion the roster
    // marker happened to sit next to). The 8-space indent is
    // `insertBeforeMarker`'s own roster-array insertion — distinct from
    // the 4-space, unquoted line the same run also writes into the code
    // half's factory map — so this can only pass if the entry actually
    // landed inside champions[].spells, not merely somewhere in the file.
    const parent = await freshTmpDir('moba2d-pack-add-champion-match-');
    const target = join(parent, 'pack');
    const scaffoldResult = await scaffold(target);
    expect(scaffoldResult.status, scaffoldResult.stdout + scaffoldResult.stderr).toBe(0);
    await openSlot(target, 'W');

    const result = runScript(
      packAddScript,
      ['spell', 'Bolt', '--champion', 'Hero', '--slot', 'W'],
      target
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/roster\s+registered/);

    const packSource = await readFile(join(target, 'pack.ts'), 'utf8');
    expect(packSource).toContain("        'Hero_W',");
  });

  it('refuses to register into the roster on a --champion typo, but still writes everything else and exits 0', async () => {
    // The deliberate choice this pins: not a silent mis-registration (the
    // original bug — landing the spell in the only champion's kit
    // regardless of what --champion actually said) and not a hard refusal
    // of the whole command either. The spell and its test are written, the
    // import and the code-map entry are registered, the roster alone is
    // skipped, the command still exits 0, and the printed message names
    // the champion it could not find. A future edit to `insertBeforeMarker`
    // or to the champion lookup that turns this back into either extreme
    // has to break this test to do it.
    const parent = await freshTmpDir('moba2d-pack-add-champion-typo-');
    const target = join(parent, 'pack');
    const scaffoldResult = await scaffold(target);
    expect(scaffoldResult.status, scaffoldResult.stdout + scaffoldResult.stderr).toBe(0);

    const result = runScript(
      packAddScript,
      ['spell', 'Bolt', '--champion', 'NotHero', '--slot', 'W'],
      target
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/no champion named 'NotHero' in pack\.ts/);

    const spellStat = await stat(join(target, 'spells/NotHero_W.ts'));
    const testStat = await stat(join(target, 'tests/NotHero_W.test.ts'));
    expect(spellStat.isFile()).toBe(true);
    expect(testStat.isFile()).toBe(true);

    const packSource = await readFile(join(target, 'pack.ts'), 'utf8');
    const typoBarrel = await readFile(join(target, 'spells/index.ts'), 'utf8');
    expect(typoBarrel).toContain("export { default as NotHero_W } from './NotHero_W';");
    expect(packSource, 'the roster is the one thing it refuses to guess at').not.toContain(
      "'NotHero_W'"
    );
    // The roster array itself was never touched — no quoted 'NotHero_W'
    // entry anywhere, not just absent from the 8-space kit-array shape.
    expect(packSource).not.toContain("'NotHero_W'");
  });

  it('leaves no __TOKEN__ marker in the added spell or test', async () => {
    const parent = await freshTmpDir('moba2d-pack-add-tokens-');
    const target = join(parent, 'pack');
    const scaffoldResult = await scaffold(target);
    expect(scaffoldResult.status, scaffoldResult.stdout + scaffoldResult.stderr).toBe(0);
    await openSlot(target, 'E');

    const addResult = runScript(
      packAddScript,
      ['spell', 'Bolt', '--champion', 'Hero', '--slot', 'E'],
      target
    );
    expect(addResult.status, addResult.stdout + addResult.stderr).toBe(0);

    const spell = await readFile(join(target, 'spells/Hero_E.ts'), 'utf8');
    const test = await readFile(join(target, 'tests/Hero_E.test.ts'), 'utf8');
    expect(spell.match(/__[A-Z][A-Z0-9_]*__/g)).toBeNull();
    expect(test.match(/__[A-Z][A-Z0-9_]*__/g)).toBeNull();
  });

  it('is idempotent about the barrel when the spell file already exists and --force is not passed', async () => {
    const parent = await freshTmpDir('moba2d-pack-add-exists-');
    const target = join(parent, 'pack');
    const scaffoldResult = await scaffold(target);
    expect(scaffoldResult.status, scaffoldResult.stdout + scaffoldResult.stderr).toBe(0);

    // Hero_Q already exists — pack-new wrote it.
    const result = runScript(packAddScript, ['spell', 'Hero', '--slot', 'Q'], target);

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/already exists/);
  });

  it('refuses an unknown kind rather than silently doing nothing, with the same plain honesty', async () => {
    const parent = await freshTmpDir('moba2d-pack-add-badkind-');
    const target = join(parent, 'pack');
    const scaffoldResult = await scaffold(target);
    expect(scaffoldResult.status, scaffoldResult.stdout + scaffoldResult.stderr).toBe(0);

    const result = runScript(packAddScript, ['relic', 'Something'], target);

    expect(result.status).not.toBe(0);
    expect(result.status).not.toBeNull();
    expect(result.stdout + result.stderr).toMatch(/Only `spell` is implemented/);
  });

  it('rejects champion, map and monster outright, non-zero, naming what is and is not implemented', async () => {
    // A refusal nobody asserts becomes an acceptance the first time someone
    // refactors the argument parsing — this pins both the exit code and
    // that the message plainly says only `spell` works, not merely that
    // *this* kind failed. Every unimplemented kind must still write
    // nothing: this generator recognising a verb and doing nothing useful
    // with it is worse than refusing it outright.
    const parent = await freshTmpDir('moba2d-pack-add-notimpl-');
    const target = join(parent, 'pack');
    const scaffoldResult = await scaffold(target);
    expect(scaffoldResult.status, scaffoldResult.stdout + scaffoldResult.stderr).toBe(0);
    const before = new Set(await walk(target));

    for (const kind of ['champion', 'map', 'monster']) {
      const result = runScript(packAddScript, [kind, 'Something'], target);
      const output = result.stdout + result.stderr;

      expect(result.status, `${kind} should exit non-zero`).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(output, `${kind}'s own message`).toMatch(new RegExp(`${kind} is not implemented`));
      expect(output, 'names the one kind that does work').toMatch(/only `spell` is/);
      expect(output, 'names all three unimplemented kinds together').toMatch(
        /champion, map, monster are none of them built yet/
      );
    }

    // Refused, not merely logged about: nothing was written.
    const after = await walk(target);
    expect(after.sort()).toEqual([...before].sort());
  });
});

describe('the scaffolded pack is real content, not just files', () => {
  it('writing the pack once and reading it back describes one champion and one map', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-shape-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const packSource = await readFile(join(target, 'pack.ts'), 'utf8');
    const spellStat = await stat(join(target, 'spells/Hero_Q.ts'));
    const testStat = await stat(join(target, 'tests/Hero_Q.test.ts'));

    expect(spellStat.isFile()).toBe(true);
    expect(testStat.isFile()).toBe(true);
    expect(packSource).toContain('champions:');
    expect(packSource).toContain('maps: [map]');
  });
});

/**
 * The scaffold has to produce a pack someone can *publish*, not only one
 * that typechecks against a checkout of core sitting next to it.
 *
 * Every assertion below is a step that was measured to fail on the scaffold
 * as it shipped, in the order a stranger meets them:
 *
 *  1. `npm install` — 404. The template pinned `"@moba2d/core": "*"`, and
 *     core is not on any registry, so the scaffold's own printed "Next:
 *     npm install" was a step nobody could complete.
 *  2. `npm run build` — no such script, and no `vite.config.ts`,
 *     `runtime-entry.ts` or `write-manifest.mjs` for one to run. A pack
 *     with no `dist/manifest.json` is a package; only a manifest makes it
 *     something a player can paste a URL to.
 *  3. Install refused — `pack.ts` declared `coreRange: '^1'`, and
 *     `satisfiesCoreRange` (imported here rather than restated, so this
 *     cannot drift from the parser that actually decides) reads `*` or
 *     `>=X.Y.Z` and nothing else. A pack that shipped that string was
 *     rejected by core with a message that reads like a real version
 *     conflict.
 */
describe('the scaffolded pack is publishable, not only buildable', () => {
  it('declares a @moba2d/core spec npm can actually resolve', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-dep-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    const spec = pkg.devDependencies?.['@moba2d/core'];

    expect(spec, '@moba2d/core must be declared').toBeTypeOf('string');
    expect(spec, 'a registry range 404s: core is published nowhere').not.toBe('*');
    expect(spec).toMatch(/^(github:|git\+|file:|https:)/);
  });

  it('takes --core to point at a local checkout instead', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-core-flag-');
    const target = join(parent, 'pack');
    const result = await scaffold(target, ['--core', 'file:../moba2d-core']);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@moba2d/core']).toBe('file:../moba2d-core');
  });

  it('ships the four files a runtime install is served by', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-runtime-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const files = await walk(target);
    for (const required of [
      'runtime-entry.ts',
      'vite.config.ts',
      'scripts/write-manifest.mjs',
      '.github/workflows/publish.yml',
    ]) {
      expect(files, `${required} is missing from the scaffold`).toContain(required);
    }

    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    expect(pkg.scripts.build, 'build must produce both halves').toMatch(/vite build/);
    expect(pkg.scripts.build).toMatch(/write-manifest/);
  });

  it('exports off runtime-entry exactly what loadPackFromManifest reads', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-entry-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const entry = await readFile(join(target, 'runtime-entry.ts'), 'utf8');
    // `packSource.loadPackFromManifest` reads `module.default` (the factory)
    // and `module.data` (the half it validates). Nothing else is mandatory.
    expect(entry).toMatch(/export\s*\{[^}]*\bdefault\b/);
    expect(entry).toMatch(/\bdata\b/);
  });

  it('declares a coreRange core can parse, in every file that states one', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-range-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const stated: string[] = [];
    for (const file of await walk(target)) {
      const content = await readFile(join(target, file), 'utf8');
      for (const [, range] of content.matchAll(/coreRange:\s*'([^']+)'/g)) {
        stated.push(`${file}: ${range}`);
        expect(satisfiesCoreRange(range, '1.0.0'), `${file} declares ${range}`).toBe(true);
      }
    }

    expect(stated.length, 'no file states a coreRange at all').toBeGreaterThan(0);
  });

  it('keeps the build output out of git', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-ignore-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const ignored = await readFile(join(target, '.gitignore'), 'utf8');
    expect(ignored.split('\n').map(line => line.trim())).toContain('dist');
  });
});

/**
 * The scaffold is the shape every pack in the world copies, so the shape is
 * worth pinning.
 *
 * `packClass` exists because the alternative was measured: the codemod that
 * first moved 237 spell files onto the injected `api` wrote each class as
 * three top-level declarations — `__buildX`, a `__cacheX` WeakMap, and a
 * `makeX` that reads and writes it — 650 times, which is a few thousand
 * lines of ceremony and the reason that pack reads like build output rather
 * than like something a person wrote. The memo is real and the factory is
 * required by `pack-core-boundary`; spelling both out at every call site is
 * not.
 */
describe('the scaffolded spell reads like source, not like codemod output', () => {
  it('declares plain classes against the injected api, with no factory to unwrap', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-shape-factory-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const spell = await readFile(join(target, 'spells/Hero_Q.ts'), 'utf8');
    expect(spell).toContain("import { api } from '../packApi';");
    expect(spell).toMatch(/^export default class Hero_Q extends api\.Spell \{/m);
    expect(spell).toMatch(/^export class Hero_Q_Object extends api\.MissileSpellObject \{/m);

    // The three things the factory shape forced on every file, all gone: a
    // wrapper to call, a memo to keep, and an alias to name what the factory
    // eventually builds. Here the class name is the type.
    expect(spell, 'no factory wrapper').not.toContain('packClass');
    expect(spell, 'no hand-rolled memo').not.toContain('new WeakMap');
    expect(spell, 'no unwrapping alias').not.toContain('InstanceType<ReturnType');
    expect(spell).toContain('live: Hero_Q_Object | null = null;');

    // And the api it leans on is the pack's own module, importing nothing of
    // core but a type — `pack-core-boundary` is what makes that mandatory.
    const packApi = await readFile(join(target, 'packApi.ts'), 'utf8');
    expect(packApi).toContain('export function setPackApi');
    expect(packApi).toMatch(/import type \{ ContentApi \}/);
    expect(packApi, 'a value import of core would not resolve outside a monorepo').not.toMatch(
      /^import \{/m
    );
  });

  it('gives the champion a full kit, because core installs no other kind', async () => {
    const parent = await freshTmpDir('moba2d-pack-new-kit-');
    const target = join(parent, 'pack');
    const result = await scaffold(target);
    expect(result.status, result.stdout + result.stderr).toBe(0);

    const files = await walk(target);
    for (const slot of ['Q', 'W', 'E', 'R']) {
      expect(files).toContain(`spells/Hero_${slot}.ts`);
      expect(files).toContain(`tests/Hero_${slot}.test.ts`);
    }

    const packSource = await readFile(join(target, 'pack.ts'), 'utf8');
    expect(packSource, 'a playable champion needs a portrait key').toMatch(/image: '[^']+'/);
    expect(packSource).not.toContain('image: null');

    // The pack carries its own check for this, so growing it cannot quietly
    // produce something core refuses to install.
    expect(files).toContain('tests/packInstallable.test.ts');
    const installable = await readFile(join(target, 'tests/packInstallable.test.ts'), 'utf8');
    expect(installable).toContain("from '@moba2d/core/testing'");
    expect(installable).toContain('validatePackData');
  });
});
