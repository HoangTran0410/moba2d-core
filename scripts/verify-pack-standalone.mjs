#!/usr/bin/env node
/**
 * The hermetic standalone drill — spec §7's acceptance criterion, runnable
 * today, before the pack has a repository of its own.
 *
 * `npm run verify:pack-standalone [-- <pack-dir>]` (default: whichever
 * optional content pack this checkout currently has installed)
 *
 * NOT wired into `verify` or `verify:all`, on purpose. It packs core, does a
 * real `npm install` into a scratch directory and runs a whole suite — a
 * couple of minutes, not seconds — so it belongs beside
 * `verify:without-packs`: a drill someone runs deliberately, never a gate
 * every commit pays for. If you are tempted to add it to `verify`, don't —
 * that was decided on purpose, not an oversight.
 *
 * ## What this is standing in for
 *
 * Spec §7's real criterion is a checkout of the pack repository, outside
 * this tree, with `@moba2d/core` installed as a real npm dependency and no
 * symlink home. That private remote does not exist yet, so this drill builds
 * the same situation out of a tarball: `npm pack` and a git/npm dependency
 * select files by the same `package.json` `files` rules, so a tarball
 * install is the honest stand-in, not a shortcut.
 *
 * ## The trap this is written against
 *
 * An earlier batch shipped a test that claimed to prove the pack worked as a
 * sibling repository, and its fixture symlinked
 * `node_modules/@moba2d/core` back into this monorepo — so `realpath` found
 * core's own devDependencies and the simulation leaked at exactly the point
 * that breaks in reality. It passed, and it proved nothing. *A fixture that
 * can reach the thing it is simulating the absence of proves nothing.* Every
 * path below is built fresh under `mkdtemp`, nothing is symlinked back into
 * this checkout, and the symlink walk before the suite runs
 * (`assertNoEscapingSymlinks` / `assertCoreIsRealDirectory`) is what makes
 * that a checked property instead of a hope.
 *
 * ## Hermetic, deliberately
 *
 * Nearly every path this script writes to or deletes lives under one
 * `mkdtemp` directory. The one exception is deliberate and self-restoring —
 * see "Packing core as it will actually ship" below — and the one read this
 * script performs against the repo itself outside that exception is a
 * `npm test` run of the pack's *own* suite, in place, exactly as `npm test`
 * already runs it today (any cache it leaves behind, e.g.
 * `node_modules/.vite`, is the same gitignored build cache that command
 * always leaves — nothing this script wouldn't also leave by being run at
 * all). That in-place run is not part of the simulation; it exists solely to
 * read the pack's current test count as the oracle the standalone run is
 * held to (see `readReferenceTestCount`), so the number that decides
 * pass/fail is read from the pack, never typed into this file.
 *
 * ## Packing core as it will actually ship
 *
 * `npm pack` reads whatever is on disk, and `src/generated/installedPacks.ts`
 * — the barrel that names every optional pack by package name — is on disk
 * naming `packs/riot` for exactly as long as this monorepo keeps developing
 * both together. Packing core *with the pack still installed in core's own
 * tree* therefore ships a tarball that imports `@moba2d/content-riot/pack`
 * unconditionally — which is not a bug in the barrel, it is this drill
 * describing a state core will never actually ship in. Post-departure, with
 * `packs/riot` a repository of its own, that file regenerates with no pack
 * import at all; `npm run verify:without-packs` already proves this on every
 * run of its own (its step 4 runs a full `verify`, typecheck of `src/`
 * included, with the pack physically absent, and stays green).
 *
 * So before `npm pack`, this script does what `verify:without-packs` does:
 * move every optional pack out of `packs/`, regenerate
 * `src/generated/installedPacks.ts`, and only then pack — then immediately
 * restore both, so this repository ends the run exactly as it started.
 * `scripts/lib/packDeparture.mjs` is the mover, shared with
 * `verify-without-packs.mjs` rather than reimplemented here — its own header
 * explains why a second, hand-rolled version was rejected on sight (a bug in
 * an earlier restore-failure branch used to delete the very pack it was
 * supposed to be protecting).
 *
 * **Order matters, and it is the opposite of "move, then copy."** The pack
 * under test (`packDir`, e.g. `packs/riot`) is copied into the sandbox
 * *before* any pack moves aside — copying a directory that has just been
 * renamed away copies nothing. The alternative (restore before copying)
 * would work too, but would mean packing core, restoring, copying, and only
 * then continuing — an extra round trip for no benefit, since the sandbox
 * copy does not need core's tarball to exist yet. Restoring quickly, right
 * after `npm pack` reads the tarball off disk, is what keeps the window
 * during which `packs/riot` is not where the rest of this checkout expects
 * it as short as this script can make it.
 *
 * ## Every failure ends in the same summary table
 *
 * Everything from `readReferenceTestCount` through the count check runs
 * inside one `try`, whose `catch` records whatever phase was running as a
 * failed step and falls through to the same PASS/FAIL table printed at the
 * bottom — an `npm pack` failure, a bad install, an escaping symlink and a
 * count mismatch all read the same way, rather than the earlier ones
 * crashing out as a raw stack trace before the table a reader is expecting
 * ever prints. `finally` still always cleans up the sandbox, catch or not.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackDeparture } from './lib/packDeparture.mjs';
import { optionalContentPackages } from './installed-packs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * With no directory given, use whichever optional content pack this
 * checkout currently has installed — never a literal path, so this file
 * does not itself become one of the scripts `tests/scripts/
 * packAgnostic.test.ts` bans from knowing a pack by name. `optionalContentPackages`
 * answers through `node_modules/@moba2d/`'s workspace symlink;
 * `realpathSync` is what turns that back into the real, on-disk pack
 * directory this script needs to `cpSync` — copying the symlink itself
 * would leave the sandbox holding a link back into this checkout, which is
 * exactly what the hermetic drill exists to refuse.
 */
function defaultPackDir() {
  const [first] = optionalContentPackages(repoRoot);
  if (!first) {
    console.error('no optional content pack is installed, and no pack directory was given');
    process.exit(1);
  }
  return realpathSync(first.dir);
}

const packArg = process.argv[2];
const packDir = packArg
  ? path.isAbsolute(packArg)
    ? packArg
    : path.resolve(repoRoot, packArg)
  : defaultPackDir();

if (!existsSync(path.join(packDir, 'package.json'))) {
  console.error(`no package.json at ${packDir} — is this a pack directory?`);
  process.exit(1);
}

const packName = JSON.parse(readFileSync(path.join(packDir, 'package.json'), 'utf8')).name;

/**
 * The build-time devDependencies a pack needs but a workspace symlink used to
 * supply for free — pinned at core's own versions, read out of core's
 * `package.json` rather than typed here, so they cannot drift from what core
 * was actually tested against. The brief names the first four; `@types/node`
 * is a fifth, found empirically (see its own comment at the rewrite site).
 */
const PINNED_FROM_CORE = ['vitest', 'typescript', 'vite', '@types/p5', '@types/node'];

const log = message => console.log(`\n=== ${message}`);

/**
 * Runs an npm subcommand, always capturing stdout and stderr, never throwing.
 * `output` is the two streams merged, for display and for regex-scanning a
 * reporter's summary line; `stdout` is kept separate too, for the one caller
 * (`npm pack --json`) that has to `JSON.parse` exactly what came out of
 * stdout and cannot risk a stray stderr line landing inside the JSON text.
 *
 * `maxBuffer` is raised well past Node's 1 MB default: a full six-script gate
 * run (`check-seams`, `typecheck`, a 568-test Vitest report) can print more
 * than that on its own, and the whole point of Finding 2's fix is that a
 * failure's real output reaches the final summary rather than being cut off
 * first.
 */
function run(cwd, args, { stdio = 'pipe' } = {}) {
  const result = spawnSync('npm', args, {
    cwd,
    encoding: 'utf8',
    stdio,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = stdio === 'pipe' ? result.stdout || '' : '';
  const output = stdio === 'pipe' ? stdout + (result.stderr || '') : '';
  return { ok: result.status === 0, status: result.status, output, stdout };
}

/**
 * Same shape as `run()` above, for the one caller (Phase 2's own
 * `moba2d-pack-new`) that needs to invoke an *installed bin* directly
 * rather than an `npm` subcommand — `run()` hardcodes `npm` as the
 * executable, which is exactly wrong for proving the bin itself resolves
 * and runs off a real tarball install.
 */
function runBin(cwd, bin, args) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  return { ok: result.status === 0, status: result.status, output };
}

/**
 * Regenerates `src/generated/installedPacks.ts` from whatever is actually in
 * `packs/` right now — run once with an optional pack moved aside (so the
 * tarball `npm pack` reads carries no pack import) and once immediately
 * after it is restored (so this repository's own copy of that generated
 * file ends the run exactly as it started). Not an npm subcommand, unlike
 * `run()` above, so it spawns `node` directly rather than going through it.
 */
function runNode(args) {
  const result = spawnSync('node', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`node ${args.join(' ')} failed (exit ${result.status})`);
  }
}

/**
 * Vitest's own `Tests  ...` summary line, split into the two numbers that
 * matter here. The all-passing shape is `Tests  N passed (N)`; the moment
 * anything fails it becomes `Tests  F failed | N passed (Total)`, and a
 * regex that requires `passed` immediately before the parenthesised total —
 * this check's original shape — misses that second form entirely. Found by
 * review, reproduced directly against Vitest 1.6.1: that exact shape is
 * Vitest's normal partial-failure output, not an edge case.
 *
 * `total` and `passed` are now read independently: `total` from the
 * parenthesised number at the end of the line (present whenever Vitest
 * collected anything at all), `passed` from a `(\d+)\s+passed` substring
 * anywhere in it (present whenever at least one test passed, wherever it
 * sits relative to a `failed` clause). Both come back `null` only for
 * `Tests  no tests` — the true zero-collected case every check in this file
 * exists to catch.
 */
function parseTestsLine(output) {
  const lineMatch = output.match(/^\s*Tests\s+(.*)$/m);
  if (!lineMatch) return { line: null, passed: null, total: null };
  const line = lineMatch[1].trim();
  const passedMatch = line.match(/(\d+)\s+passed/);
  const totalMatch = line.match(/\((\d+)\)/);
  return {
    line,
    passed: passedMatch ? Number(passedMatch[1]) : null,
    total: totalMatch ? Number(totalMatch[1]) : null,
  };
}

/**
 * The oracle for "how many tests should this pack report" — read by actually
 * running the pack's own suite where it already works today, not typed in
 * here. A number baked into this file would silently drift the day someone
 * adds or removes a test; asking the pack is the only way this stays honest
 * without a second source of truth to keep in sync by hand.
 *
 * Two ways to ask, tried in order:
 *
 *   1. `npm test --workspace=${packName}` inside `repoRoot` — the original
 *      shape, for a pack still workspace-linked into this checkout (`packs/
 *      riot` before content-pack-and-repo-split batch 6 task 10, or any
 *      future optional pack developed the same way before its own
 *      departure). Fast, and reads the exact tree `packDir` was copied from
 *      a few lines up.
 *   2. `npm test` run directly with `cwd: packDir` — for a `packDir` that is
 *      not this checkout's own workspace at all, which is what "pointed at
 *      the sibling repository" (spec §7's real acceptance shape) means once
 *      the pack genuinely has a repository of its own: `npm --workspace=`
 *      has nothing here to resolve `packName` against, so attempt 1 fails
 *      with "No workspaces found" and no parseable total, not a test count
 *      of zero. Requires `packDir` to already have its own `node_modules`
 *      installed — a real external checkout would (`npm install`, against
 *      whatever real or `file:`-substituted `@moba2d/core` its own
 *      `package.json` names); this script never installs one for it, the
 *      same way it never installs one for the sandboxed copy's *own*
 *      devDependencies before Phase 1's rewrite runs `npm install` there.
 *
 * Uses the *total* Vitest reports, not the passed count, and does not treat
 * a non-zero exit code here as fatal on its own. This run's only job is to
 * answer "how many tests exist" — the original version required exit 0,
 * which meant one ordinary failing test anywhere in the pack's in-repo suite
 * (unrelated to anything this drill exists to catch) aborted the whole
 * drill before it ever reached `npm pack`, with a message that blamed the
 * oracle mechanism when the real state was "some tests failed". If the
 * reference suite is not fully green that is worth a note, not a reason to
 * refuse testing the one thing this drill actually checks: whether the pack
 * installs and runs standalone. It still throws — refusing to guess — when
 * no total is parseable at all from either attempt, since without one the
 * standalone count check has nothing to compare against.
 */
function readReferenceTestCount() {
  log(`reading the pack's own current test count (npm test --workspace=${packName})`);
  let result = run(repoRoot, ['test', `--workspace=${packName}`]);
  let { total, passed, line } = parseTestsLine(result.output);
  let source = `npm test --workspace=${packName} (inside ${repoRoot})`;

  if (total === null) {
    console.log(
      `no workspace named ${packName} in this checkout (or its suite reported nothing) — ` +
        `falling back to running the suite directly in ${packDir}`
    );
    const fallback = run(packDir, ['test']);
    ({ total, passed, line } = parseTestsLine(fallback.output));
    result = fallback;
    source = `npm test (cwd=${packDir})`;
  }

  process.stdout.write(result.output);
  if (total === null) {
    throw new Error(
      `could not read a reference test count from ${packName}'s own suite, tried both inside ` +
        `this checkout (--workspace=${packName}) and directly in ${packDir} (exit ${result.status}, ` +
        `no parseable "Tests" summary line either way). Without this oracle the standalone count ` +
        `check has nothing to compare against, so the drill cannot tell "0 tests collected" from ` +
        `"green". If the second attempt is what failed, check that ${packDir} already has its own ` +
        `node_modules installed — this script does not install one for it.`
    );
  }
  if (passed !== total) {
    console.warn(
      `NOTE: ${packName}'s own suite (${source}) is not fully green right now ("Tests ${line}"). ` +
        `Continuing anyway — this drill exists to prove the standalone half, not to re-litigate an ` +
        `unrelated failure in that suite. Using the total test count (${total}) as the reference.`
    );
  }
  return total;
}

/**
 * Recursively walks `dir`, returning every symlink found (at any depth —
 * npm's own `.bin` shims and nested dedupe links included), each paired with
 * the real path it resolves to. Does not follow a symlink to keep walking
 * inside it: whatever it points at, if it lives under this same tree, is a
 * real directory this walk reaches on its own, and if it does not, it is
 * exactly the leak this check exists to name.
 */
function findSymlinks(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      found.push({ link: full, target: realpathSync(full) });
    } else if (entry.isDirectory()) {
      findSymlinks(full, found);
    }
  }
  return found;
}

/**
 * The check Step 4's drill 1 exists to prove: every symlink under
 * `<tmpPackDir>/node_modules`, at any depth, must resolve inside the temp
 * sandbox. One that resolves outside it is not a broken link, it is this
 * checkout leaking back in — exactly the batch-5 shape, where
 * `node_modules/@moba2d/core` pointed at the monorepo and `realpath` found
 * core's own devDependencies through it.
 */
function assertNoEscapingSymlinks(tmpPackDir, tmpRoot) {
  const nodeModules = path.join(tmpPackDir, 'node_modules');
  const symlinks = findSymlinks(nodeModules);
  const tmpRootReal = realpathSync(tmpRoot);
  const escaped = symlinks.filter(
    ({ target }) => target !== tmpRootReal && !target.startsWith(tmpRootReal + path.sep)
  );
  if (escaped.length > 0) {
    const lines = escaped
      .map(({ link, target }) => `  ${path.relative(tmpPackDir, link)} -> ${target}`)
      .join('\n');
    throw new Error(
      `${escaped.length} symlink(s) under node_modules resolve OUTSIDE the temp sandbox:\n${lines}\n` +
        `This is the batch-5 leak: a link back into this checkout (or anywhere else on this ` +
        `machine) lets the "standalone" install quietly see files, devDependencies or state that ` +
        `only exist because this simulation is running next to a real checkout. A separate ` +
        `repository, on a separate machine, would not have that path at all — this run just proved ` +
        `nothing, the same way batch 5's did.`
    );
  }
  return symlinks.length;
}

/**
 * The check Step 4's drill 1 also proves the *positive* half of: not merely
 * "no escaping symlink", but that `@moba2d/core` itself is real, installed
 * content — `lstat().isDirectory()`, which is false for a symlink even one
 * that happens to resolve inside the sandbox. A pack that got its copy of
 * core from a link rather than `npm install`ing the tarball is not proof of
 * anything either.
 */
function assertCoreIsRealDirectory(tmpPackDir) {
  const corePath = path.join(tmpPackDir, 'node_modules', '@moba2d', 'core');
  const stat = lstatSync(corePath);
  if (!stat.isDirectory()) {
    throw new Error(
      `node_modules/@moba2d/core is not a real directory (isSymbolicLink=${stat.isSymbolicLink()}). ` +
        `A standalone install must get its own on-disk copy of core from the tarball, not a link to ` +
        `one that already exists somewhere else.`
    );
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), 'moba2d-pack-standalone-'));
console.log(`sandbox: ${tmp}`);

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * The one thing this script moves inside the repository rather than under
 * `tmp` — see "Packing core as it will actually ship" above. Created here,
 * before anything runs, so the signal handlers below always have it in
 * scope even if a signal arrives before the departure step itself does.
 */
const departure = createPackDeparture(repoRoot);

/**
 * Whether `departure.depart()` has been attempted at all — set immediately
 * before calling it, not after, so a signal or an error arriving mid-move
 * still routes through the restore path below rather than skipping it
 * because the call never technically returned. `depart()`'s own first
 * action is `mkdirSync(departureDir, ...)`, so this flag being true is
 * exactly the condition under which `departureDir` is guaranteed to exist.
 */
let departInFlight = false;
let packsRestored = false;

/**
 * Restores whatever `departure.depart()` moved and regenerates
 * `src/generated/installedPacks.ts` back to its normal, pack-installed
 * state — idempotent and signal-safe, the same shape
 * `verify-without-packs.mjs`'s own `restoreOnce()` takes, and called from
 * both the normal control flow and the signal handlers below.
 */
function restorePacksOnce() {
  if (packsRestored) return;
  packsRestored = true;
  if (!departInFlight) return;
  departure.restore();
  runNode(['scripts/generate-installed-packs.mjs']);
  departure.cleanup();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`\n${signal} — restoring any moved pack before exiting`);
    restorePacksOnce();
    cleanup();
    process.exit(130);
  });
}

const results = [];
let referenceCount = null;
/**
 * What the `catch` below blames a failure on. Updated right before each
 * operation that can throw, so an uncaught `npm pack`/`npm install`/symlink
 * failure still lands in the summary table under a legible step name instead
 * of only a raw stack trace.
 */
let phase = 'startup';

try {
  phase = 'reference test count';
  referenceCount = readReferenceTestCount();
  console.log(
    `reference count (from ${packName}'s own suite, in this checkout): ${referenceCount}`
  );

  // Copy the pack under test into the sandbox first, excluding node_modules —
  // this checkout's own copy must never leak into the sandbox the way core's
  // devDependencies did in the batch-5 fixture. Deliberately *before* any
  // pack moves aside: a directory that has just been renamed away has
  // nothing left to copy. See "Order matters" in this file's own header.
  phase = 'copy pack into sandbox';
  log('copy the pack into the sandbox (excluding node_modules)');
  const tmpPackDir = path.join(tmp, 'pack');
  cpSync(packDir, tmpPackDir, {
    recursive: true,
    filter: src => path.basename(src) !== 'node_modules',
  });
  console.log(`${packDir} -> ${tmpPackDir}`);

  // Move every optional pack out of core's own tree and regenerate
  // `src/generated/installedPacks.ts` before packing — see "Packing core as
  // it will actually ship" in this file's own header. The restore (and the
  // regenerate back) happens in this same block's `finally`, not the
  // script's outer one, so core's tarball is the only thing that ever
  // observes the pack-absent state; everything after this block runs
  // against a repository already back to normal.
  let packResult;
  try {
    phase = 'move packs aside';
    log(
      `moving ${departure.DEPARTING.map(name => `packs/${name}`).join(', ') || '(no optional packs installed)'} out of the tree`
    );
    departInFlight = true;
    departure.depart();
    runNode(['scripts/generate-installed-packs.mjs']);

    // Step 2 of the brief: `npm pack` core, assert the tarball landed, record its file count.
    phase = 'npm pack';
    log('npm pack core (no optional pack in the tree)');
    packResult = run(repoRoot, ['pack', '--json', '--pack-destination', tmp]);
  } finally {
    log('restoring the pack(s) and regenerating installedPacks.ts');
    restorePacksOnce();
  }
  if (!packResult.ok) {
    throw new Error(`npm pack failed (exit ${packResult.status}):\n${packResult.output}`);
  }
  const [tarballInfo] = JSON.parse(packResult.stdout);
  const tarballPath = path.join(tmp, tarballInfo.filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack reported ${tarballInfo.filename} but it is not at ${tarballPath}`);
  }
  console.log(
    `tarball: ${tarballInfo.filename} — ${tarballInfo.entryCount} files, ${tarballInfo.size} bytes`
  );

  // Step 4: rewrite the copy's package.json — core becomes the tarball, and the
  // build-time devDependencies core itself needs are pinned at core's own versions so
  // they cannot drift from what core was actually tested against.
  //
  // `@types/node` is a fifth entry beyond the brief's own four (vitest, typescript,
  // vite, @types/p5) — found empirically, not anticipated. `@types/node` is only an
  // *optional peer* of `vite` (see vite's own package.json), so npm does not pull it
  // in on its own; without it the pack's `tsc -p tsconfig.json` dies on `Cannot find
  // module 'node:fs'` etc. in every file (this pack's own and core's) that imports a
  // Node builtin, which is most of them. Measured against a real tarball install
  // 2026-08-23. Adding it is a legitimate part of "install what core itself needed to
  // be tested against" — it changes nothing about what the pack can reach that a real
  // separate checkout could not also `npm install`.
  phase = 'rewrite package.json';
  log("rewrite the sandbox pack's package.json");
  const corePkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packPkgPath = path.join(tmpPackDir, 'package.json');
  const packPkg = JSON.parse(readFileSync(packPkgPath, 'utf8'));
  packPkg.devDependencies['@moba2d/core'] = `file:${tarballPath}`;
  for (const dep of PINNED_FROM_CORE) {
    const version = corePkg.devDependencies[dep];
    if (!version) {
      throw new Error(
        `core's own package.json has no devDependency "${dep}" to read a version from`
      );
    }
    packPkg.devDependencies[dep] = version;
  }
  writeFileSync(packPkgPath, JSON.stringify(packPkg, null, 2) + '\n');
  console.log(`@moba2d/core -> file:${tarballPath}`);
  for (const dep of PINNED_FROM_CORE) {
    console.log(`${dep} -> ${packPkg.devDependencies[dep]} (core's own)`);
  }

  // Step 5: a real npm install, no workspace, no symlink home.
  phase = 'npm install';
  log(`npm install (cwd=${tmpPackDir})`);
  const installResult = run(tmpPackDir, ['install', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
  });
  if (!installResult.ok) {
    throw new Error(`npm install failed in the sandbox (exit ${installResult.status})`);
  }

  // Step 3 of the brief ("assert no path escapes the temp directory") — before running
  // anything the pack ships, prove the install itself did not leak this checkout in.
  phase = 'symlink escape check';
  log('symlink escape check');
  const symlinkCount = assertNoEscapingSymlinks(tmpPackDir, tmp);
  assertCoreIsRealDirectory(tmpPackDir);
  console.log(
    `checked ${symlinkCount} symlink(s) under node_modules — none escape the sandbox; ` +
      '@moba2d/core is a real installed directory'
  );

  // Step 6: run the pack's own gate, in order, collecting every exit code. Deliberately
  // does not throw on an individual script's failure — every one of the six always runs.
  phase = 'run pack scripts';
  const scripts = [
    'check-seams',
    'check-seams:monsters',
    'typecheck',
    'assets:check',
    'catalog:check',
    'test',
  ];
  let testOutput = '';
  for (const script of scripts) {
    log(`npm run ${script} (cwd=${tmpPackDir})`);
    const result = run(tmpPackDir, ['run', script]);
    process.stdout.write(result.output);
    results.push({ step: script, ok: result.ok, status: result.status });
    if (script === 'test') testOutput = result.output;
  }

  // Step 2 of the brief ("assert the test count, not just the exit code").
  phase = 'test count check';
  log('test count check');
  const { total: observedTotal, passed: observedPassed } = parseTestsLine(testOutput);
  const countOk = observedTotal !== null && observedTotal === referenceCount;
  if (!countOk) {
    console.error(
      `FAIL: standalone install ${
        observedTotal === null
          ? 'reported no parseable "Tests" summary line — likely 0 files collected, or every ' +
            'file failed to load'
          : `collected ${observedTotal} test(s) (${observedPassed ?? 0} passed)`
      }; ${packName}'s own suite in this checkout reports ${referenceCount}. A suite that ` +
        'collects nothing can still exit 0 in some configurations, so the exit code above is ' +
        'not enough — this is the check that catches that.'
    );
  } else {
    console.log(
      `OK: standalone install collected ${observedTotal} test(s) (${observedPassed} passed), ` +
        'matching the reference'
    );
  }
  results.push({
    step: 'test count (collected == reference)',
    ok: countOk,
    status: countOk ? 0 : 1,
  });

  // ── Phase 2 (content-pack-and-repo-split batch 6 task 8): the scaffold
  // drill. Everything above proves an *existing* pack survives leaving the
  // monorepo; this is spec §7's second criterion — that writing a *new*
  // pack against core is actually easy — and it is the only real evidence
  // for that claim, the same way the drill above is the only real evidence
  // a departed pack still works. Reuses this same sandbox and the tarball
  // already built above rather than packing core a second time: the
  // question here is entirely about `moba2d-pack-new`/`moba2d-pack-add`
  // and the templates they render, not about core's own tarball, which
  // Phase 1 has already proven installs clean.
  //
  // `tmpPackDir`'s own `node_modules/.bin/moba2d-pack-new` — the *installed*
  // bin, resolved off the real tarball's `files`, not this checkout's
  // `scripts/pack-new.mjs` run directly — is the point: running the
  // checked-out script directly would prove the generator's *logic* but
  // say nothing about whether `package.json`'s `files` actually ships the
  // template tree the bin needs at runtime. A missing entry there resolves
  // to nothing the moment core is a real dependency rather than this
  // checkout, and this is the one place that shows up.
  phase = 'scaffold a fresh pack';
  log('moba2d-pack-new (installed bin): scaffold a fresh pack into the sandbox');
  const scaffoldDir = path.join(tmp, 'scaffold');
  const scaffoldBin = path.join(tmpPackDir, 'node_modules', '.bin', 'moba2d-pack-new');
  const scaffoldResult = runBin(tmp, scaffoldBin, [
    scaffoldDir,
    '--id',
    'scaffold-demo',
    '--name',
    'Scaffold Demo',
  ]);
  process.stdout.write(scaffoldResult.output);
  if (!scaffoldResult.ok || !existsSync(path.join(scaffoldDir, 'package.json'))) {
    throw new Error(
      `moba2d-pack-new failed to scaffold a fresh pack (exit ${scaffoldResult.status}):\n${scaffoldResult.output}`
    );
  }
  console.log(`scaffolded: ${scaffoldDir}`);

  // Same rewrite Phase 1 applies to the real pack under test: the tarball
  // in place of the workspace-linked `@moba2d/core`, and the same
  // build-time devDependencies pinned at core's own versions.
  phase = "rewrite the scaffold's package.json";
  log("rewrite the scaffolded pack's package.json");
  const scaffoldPkgPath = path.join(scaffoldDir, 'package.json');
  const scaffoldPkg = JSON.parse(readFileSync(scaffoldPkgPath, 'utf8'));
  scaffoldPkg.devDependencies['@moba2d/core'] = `file:${tarballPath}`;
  for (const dep of PINNED_FROM_CORE) {
    // Already validated present on `corePkg` by Phase 1's own rewrite above
    // — the same values that pack's own package.json is now pinned to.
    scaffoldPkg.devDependencies[dep] = corePkg.devDependencies[dep];
  }
  writeFileSync(scaffoldPkgPath, JSON.stringify(scaffoldPkg, null, 2) + '\n');
  console.log(`@moba2d/core -> file:${tarballPath}`);

  phase = 'npm install into the scaffold';
  log(`npm install (cwd=${scaffoldDir})`);
  const scaffoldInstall = run(scaffoldDir, ['install', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
  });
  if (!scaffoldInstall.ok) {
    throw new Error(`npm install failed in the scaffolded pack (exit ${scaffoldInstall.status})`);
  }

  phase = 'symlink escape check (scaffold)';
  log('symlink escape check (scaffold)');
  const scaffoldSymlinkCount = assertNoEscapingSymlinks(scaffoldDir, tmp);
  assertCoreIsRealDirectory(scaffoldDir);
  console.log(
    `checked ${scaffoldSymlinkCount} symlink(s) under the scaffold's node_modules — none escape ` +
      'the sandbox; @moba2d/core is a real installed directory'
  );

  // The acceptance criterion itself: `npm test` and `npm run check-seams`,
  // both green, on a pack nothing hand-tuned — plus `typecheck`, which the
  // brief's own Step 6 does not name but Phase 1 already runs against the
  // *real* pack above. A generated `.tmpl` file is exactly where a type
  // regression sits unnoticed: nobody reads it until it breaks, and by
  // then it has already been copied into someone's repository. Found by
  // hand once already (an `afterEach(() => vi.unstubAllGlobals())`
  // expression-body arrow returns `VitestUtils`, not `void`, and
  // `Awaitable<void>` does not extend the same leniency plain `void` does)
  // — this is what makes that check permanent instead of a one-off run
  // during review.
  phase = 'run the scaffolded pack scripts';
  for (const script of ['typecheck', 'test', 'check-seams']) {
    log(`npm run ${script} (cwd=${scaffoldDir})`);
    const result = run(scaffoldDir, ['run', script]);
    process.stdout.write(result.output);
    results.push({ step: `scaffold: npm run ${script}`, ok: result.ok, status: result.status });
  }
} catch (err) {
  console.error(`\nFATAL during "${phase}": ${err.message}`);
  results.push({ step: phase, ok: false, status: 1 });
} finally {
  // Idempotent — the inner block around `npm pack` already restores in its
  // own `finally`. This is defense in depth for a failure that happens
  // before that block is even reached (e.g. `readReferenceTestCount()`
  // throwing), where `departInFlight` is still false and this is a no-op.
  restorePacksOnce();
  cleanup();
}

console.log('\n--- hermetic standalone drill ---');
console.log(`reference test count: ${referenceCount ?? '(never established)'}`);
for (const { step, ok } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}`);
}
const failed = results.some(r => !r.ok);
console.log(
  failed
    ? '\nDRILL FAILED'
    : '\ndrill passed — the pack is green with core as a real dependency, no symlink home'
);
process.exit(failed ? 1 : 0);
