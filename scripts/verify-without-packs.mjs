/**
 * The departure drill: move the optional content packs out of this tree, and
 * require core to still install, generate, typecheck, test and build.
 *
 * This is the acceptance test for the whole content-pack extraction. Every
 * other guard in this repository is *arrangement* — packs are workspace
 * packages, they reach core only through `import type`, core's public surface
 * is declared in `exports`, the scans derive their roots from the installed
 * set. None of that proves core can actually stand alone, because with
 * `packs/riot/` sitting in the tree every one of those guards runs against a
 * checkout that has the pack. Only taking it away proves anything.
 *
 * It is one command on purpose. The same procedure written as a paragraph in
 * a design document is a procedure nobody runs, and the first time anybody
 * would have found out is the day the pack became a separate repository.
 *
 *   npm run verify:without-packs
 *
 * ## What it does
 *
 *   1. move `packs/riot/` outside the tree — `rename`, never `rm`. It is 240
 *      spells and 378 images and it is not this script's to delete. Restored
 *      in a `finally`, and on SIGINT/SIGTERM too. The move-and-restore itself
 *      is `scripts/lib/packDeparture.mjs`, shared with
 *      `verify-pack-standalone.mjs` — see that module's own header for why a
 *      second, hand-rolled mover was rejected on sight.
 *   2. `npm install`, so the `node_modules/@moba2d/content-riot` workspace
 *      link actually goes away. Without this the pack is still resolvable by
 *      package name through a dangling symlink and the drill proves nothing.
 *   3. regenerate `src/generated/installedPacks.ts` — the generated barrel is
 *      the one place "which packs are installed" is written down, and a stale
 *      one would still name the departed pack.
 *   4. `npm run verify`
 *   5. `npm run build`
 *   6. **boot the thing** — `tests/e2e/verify-core-alone.mjs` drives a real
 *      browser to a real, playable match on the reference pack's map. A build
 *      that succeeds and a menu that dead-ends is the failure this drill
 *      exists to catch, and steps 1-5 cannot see it: Vitest runs on
 *      `environment: 'node'`, with no renderer and no `GameScene`.
 *   7. restore everything and verify again, so a green drill leaves the tree
 *      exactly as it found it rather than merely claiming to.
 *
 * `package-lock.json` is snapshotted and restored byte for byte: step 2
 * rewrites it (a workspace member disappearing is a real lockfile change) and
 * that edit must not survive the run.
 *
 * `--skip-restore-verify` drops step 7's second `npm run verify` when you are
 * iterating and only care about the pack-free half; `--skip-boot` drops step 6,
 * for a machine with no browser. The restore itself always runs, on every path,
 * including a throw and a SIGINT.
 *
 * ## Nothing here is ever allowed to delete the pack
 *
 * `scripts/lib/packDeparture.mjs`'s `cleanup()` removes the departure
 * directory **only** when every pack is verifiably back in `packs/`, and even
 * then with `rmdirSync`, which refuses a non-empty directory. An earlier
 * version of this script got this exactly backwards, before the mover moved
 * into its own module — worth restating here because the shape is seductive:
 * the restore-failure branch printed "left at <path>", telling the reader
 * their content was safe, and then fell through to
 * `rmSync(departureDir, { recursive: true })`, whose comment claimed it only
 * removed an empty directory. It does not. A recursive remove deletes a
 * non-empty tree silently, so the one branch that exists for "the restore
 * went wrong" was the branch that turned a recoverable problem into 240
 * spells and 378 images gone, while printing a message saying they were
 * fine. That is worse than having no safety copy at all, because it is
 * trusted. See `packDeparture.mjs`'s own header for the guard that replaced
 * it — shared now with `verify-pack-standalone.mjs` precisely so this lesson
 * only had to be learned once.
 *
 * `--prove-restore-failure` exercises that branch on purpose: it moves the
 * pack, plants an obstacle where the pack has to go back, and goes straight to
 * the restore, skipping every expensive step. Read the paths it names and check
 * that both still hold the pack.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackDeparture } from './lib/packDeparture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const departure = createPackDeparture(root);

/**
 * content-pack-and-repo-split batch 6 task 10 moved `packs/riot/` out of
 * this repository entirely, into its own. `optionalContentPackages` — the
 * same derivation `depart()` reads — now finds nothing to move on a normal
 * checkout, which used to mean this script ran `npm install`, `verify`,
 * `build` and a real-browser boot **twice**, moving and restoring an empty
 * list both times, to prove a fact the tree already states by having no
 * `packs/riot/` in it: `npm run verify` alone is now the departure drill,
 * because there is nothing left in the working tree for it to quietly still
 * depend on. Measured on content-pack-and-repo-split batch 6 task 11 — the
 * unguarded run passed, but wastefully, with `DEPARTING` empty at every
 * step.
 *
 * This guard is a no-op that says so, one of the two options the plan named,
 * rather than retiring the command: doc comments across `vitest.config.ts`,
 * `tests/setup.ts`, `src/testing/index.ts`, `src/content/install.ts` and
 * others point a future reader at `npm run verify:without-packs` as the
 * thing that proved a claim, and deleting the command would strand every one
 * of those references. Kept for the day a second optional pack exists to
 * drill against; `scripts/lib/packDeparture.mjs`'s restore/cleanup safety
 * reasoning is unchanged and still exercised for real by
 * `verify-pack-standalone.mjs`, which does not go through this guard.
 */
if (departure.DEPARTING.length === 0) {
  console.log(
    '\nno optional content packs are installed (node_modules/@moba2d has none beyond the ' +
      "core-own reference pack) — there is nothing for this drill to move. `npm run verify` " +
      'already proves core stands alone, because the tree already has no optional pack in it.\n' +
      '\ndrill skipped — nothing to depart'
  );
  process.exit(0);
}

const lockPath = join(root, 'package-lock.json');
const lockBefore = readFileSync(lockPath);

const log = message => console.log(`\n=== ${message}`);

const run = (command, args, { allowFailure = false } = {}) => {
  log(`${command} ${args.join(' ')}`);
  try {
    execFileSync(command, args, { cwd: root, stdio: 'inherit' });
    return { ok: true };
  } catch (error) {
    if (!allowFailure) throw error;
    return { ok: false, status: error.status ?? 1 };
  }
};

let restored = false;
const restoreOnce = () => {
  if (restored) return;
  restored = true;
  departure.restore();
  writeFileSync(lockPath, lockBefore);
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`\n${signal} — restoring the pack before exiting`);
    restoreOnce();
    departure.cleanup();
    process.exit(departure.stranded.length ? 1 : 130);
  });
}

/**
 * A drill of the drill: move the pack, plant an obstacle where it has to go
 * back, and go straight to the restore — skipping `npm install`, `verify`,
 * `build` and the browser, none of which the failure branch touches. It exists
 * because that branch only ever runs when something has already gone wrong,
 * which is exactly the condition nobody reproduces, and it is the branch that
 * used to delete the pack.
 */
const PROVE_RESTORE_FAILURE = process.argv.includes('--prove-restore-failure');

/**
 * The sentinel `--prove-restore-failure` throws to reach the `finally`. Caught
 * and swallowed below, so the run ends in the drill's own summary and a
 * non-zero exit rather than an unhandled stack trace — a deliberate exercise
 * should not read like a crash.
 */
const PROOF_DONE = Symbol('prove-restore-failure');

const results = [];
let failed = false;

try {
  log('step 1 — moving the optional packs out of the tree (safety copy first)');
  departure.depart();

  if (PROVE_RESTORE_FAILURE) {
    for (const name of departure.DEPARTING) {
      const blocked = join(root, 'packs', name);
      mkdirSync(blocked, { recursive: true });
      writeFileSync(
        join(blocked, 'PLANTED-BY-PROVE-RESTORE-FAILURE'),
        'Planted by `npm run verify:without-packs -- --prove-restore-failure`.\n' +
          'Delete this directory, then move the pack back from the path the run printed.\n'
      );
      console.log(
        `planted an obstacle at packs/${name} — the restore must refuse and keep both copies`
      );
    }
    throw PROOF_DONE;
  }

  log('step 2 — npm install, so the workspace link goes away');
  run('npm', ['install', '--no-audit', '--no-fund']);

  log('step 3 — regenerating the installed-packs barrel');
  run('node', ['scripts/generate-installed-packs.mjs']);

  log('step 4 — npm run verify, with no optional content packs in the tree');
  const verify = run('npm', ['run', 'verify'], { allowFailure: true });
  results.push(['verify (pack absent)', verify.ok]);
  failed ||= !verify.ok;

  log('step 5 — npm run build, with no optional content packs in the tree');
  const build = run('npm', ['run', 'build'], { allowFailure: true });
  results.push(['build (pack absent)', build.ok]);
  failed ||= !build.ok;

  // The step that is easy to skip and is the actual point. A build that
  // succeeds and a menu that dead-ends is the failure this whole drill exists
  // to catch, and nothing above this line can see it: `verify` runs Vitest on
  // `environment: 'node'`, with no renderer, no p5, no DOM and no `GameScene`.
  // `--skip-boot` is for a machine with no browser at all; `LOL2D_CHROME_CHANNEL=`
  // (empty) is the better answer there, and swaps system Chrome for
  // Playwright's own bundled Chromium.
  if (process.argv.includes('--skip-boot')) {
    console.log('\n=== step 6 — skipped (--skip-boot)');
  } else {
    log('step 6 — does it still boot? a real browser, a real match');
    const boot = run('node', ['tests/e2e/verify-core-alone.mjs'], { allowFailure: true });
    results.push(['boots to a playable match (pack absent)', boot.ok]);
    failed ||= !boot.ok;
  }
} catch (error) {
  if (error !== PROOF_DONE) throw error;
} finally {
  log('restoring the pack');
  restoreOnce();
  if (!PROVE_RESTORE_FAILURE) {
    run('npm', ['install', '--no-audit', '--no-fund'], { allowFailure: true });
    run('node', ['scripts/generate-installed-packs.mjs'], { allowFailure: true });
  }
  departure.cleanup();
}

if (departure.stranded.length) {
  results.push([`packs/${departure.stranded.join(', packs/')} restored`, false]);
  failed = true;
}

if (!PROVE_RESTORE_FAILURE && !process.argv.includes('--skip-restore-verify')) {
  log('step 7 — npm run verify again, with the pack back');
  const again = run('npm', ['run', 'verify'], { allowFailure: true });
  results.push(['verify (pack restored)', again.ok]);
  failed ||= !again.ok;
}

console.log('\n--- departure drill ---');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(failed ? '\nDRILL FAILED' : '\ndrill passed — core stands alone');
process.exit(failed ? 1 : 0);
