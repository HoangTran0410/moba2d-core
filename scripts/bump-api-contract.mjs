#!/usr/bin/env node
/**
 * Raises the `ContentApi` contract number and records the surface that goes
 * with it, in one step.
 *
 * `npm run contract:bump`
 *
 * The contract number is core's **minor** version, and it is not a release
 * number — it answers one question a pack asks: "is the core I am about to run
 * on new enough to have the members I was written against?" A pack's manifest
 * states that as `coreRange: '>=1.<contract>.0'`, and `satisfiesCoreRange`
 * refuses the install when it is not met.
 *
 * That gate was vacuous for the whole of this project's life. `package.json`
 * had said `1.0.0` since the first commit — `git log -p -- package.json` shows
 * exactly one line ever written for `version` — while `ContentApi` grew to 278
 * members, so `>=1.0.0` was a promise that could not fail. This command exists
 * because the alternative is remembering, and nobody does.
 *
 * Two halves, always together:
 *
 *   1. `package.json`'s minor, which becomes `__CORE_VERSION__` at build time
 *      and is the number a pack's range is compared against.
 *   2. `tests/content/apiSurface.snapshot.json`, which is what makes the next
 *      change detectable rather than something a reviewer has to notice.
 *
 * The snapshot is written by the test itself, under `MOBA2D_WRITE_API_CONTRACT`
 * — the same code path that reads it — so there is no second implementation of
 * "what the surface is" for the two to disagree about.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(root, 'package.json');

const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!parts) {
  console.error(
    `\n  package.json version "${pkg.version}" is not X.Y.Z, which is the only shape ` +
      `satisfiesCoreRange can compare. Fix it before bumping.\n`
  );
  process.exit(1);
}

const [, major, minor] = parts;
const contract = Number(minor) + 1;
const version = `${major}.${contract}.0`;

pkg.version = version;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

execFileSync('npx', ['vitest', 'run', 'tests/content/apiContract.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MOBA2D_WRITE_API_CONTRACT: String(contract) },
});

console.log(`
  core is now ${version} — contract ${contract}.

  A pack that needs anything added in this contract declares:

    coreRange: '>=${major}.${contract}.0'

  Raise a pack's floor only once a core carrying this contract is actually
  deployed. A pack published with a floor its live core cannot meet is refused
  on every player's machine, and the pack is the half that is already out.
`);
