#!/usr/bin/env node
/**
 * `moba2d-check-unused` — fails on any declaration a pack never reads.
 *
 * This is `tsc --noUnusedLocals`, and it is a script rather than a
 * `tsconfig.json` setting for one reason: **core ships raw TypeScript**, so
 * `node_modules/@moba2d/core/src/**` is part of a pack's program and
 * `noUnusedLocals` reports on it too. Core's unused locals are core's to fix,
 * and a pack whose typecheck goes red because of them is a pack that will
 * turn the rule off. Filtering by path keeps the compiler's exact answer and
 * scopes the verdict to the files that pack owns.
 *
 * ## Why every pack gets this
 *
 * On the largest pack there is, nothing ever asked, and 1968 dead
 * declarations accumulated in `spells/` — 1697 type aliases and 271
 * `const X = api.Y` value aliases, emitted per file by the codemod that first
 * moved it onto the injected `api`, none of them read by anything. That is
 * not a formatting complaint: it is what made those files read as machine
 * output and buried the ~40 lines per file that are actually the ability.
 *
 * The last twelve were not aliases and are the shape this catches from now
 * on: six imports of constants a test had stopped using, two `{ from, to }`
 * destructures reading a half nobody wanted, a private field nothing touched,
 * and two values computed inside a `draw()` and then dropped.
 *
 * ## Why this is a bin
 *
 * It was a file the scaffold copied. All three copies that exist differ by
 * exactly one thing — the package name in one `console.log` — which is read
 * from `package.json` here instead. Same reasoning as `pack-assets.mjs`
 * beside it.
 *
 * **The pack root comes from `process.cwd()`**, not from this file's own
 * location: through a `node_modules/.bin` symlink `import.meta.url` resolves
 * to the symlink's target, and the old `../` would have typechecked
 * `node_modules/@moba2d/`. See `pack-core-link.mjs`'s header for the same
 * trap, and `checkSeams.bin.test.ts` for what it cost once.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { packRootFrom } from './lib/packRoot.mjs';

const root = packRootFrom(process.cwd());
const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;

/**
 * The pack's own `typescript`, resolved and run with `node` — **not `npx
 * tsc`**, which this used to be and which fails open.
 *
 * npx falls back to whatever `tsc` is on `PATH` when the package has none of
 * its own, and macOS ships one: Turbo C++'s. It prints "This is not the tsc
 * command you are looking for" and **exits 0**. No TS diagnostic codes come
 * back, so every filter below matches nothing and this reports "no unused
 * declarations" over a check that never ran — green, in a pack whose
 * `npm install` had not finished. Measured while writing
 * `checkUnused.bin.test.ts`, which is where a fixture with no local
 * typescript first passed for that reason.
 *
 * Resolving from the pack's own `package.json` also means no network: npx
 * would otherwise offer to *download* typescript, which in CI is a silent
 * dependency on a registry this check has no business needing.
 */
const tsc = (() => {
  try {
    return createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');
  } catch {
    console.error(
      `no local typescript in ${name} — run npm install. (This used to shell out to\n` +
        `\`npx tsc\`, which on macOS finds Turbo C++'s tsc, exits 0, and reports a clean\n` +
        `check that never ran.)`
    );
    process.exit(1);
  }
})();

let output = '';
try {
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--noUnusedLocals', '--noEmit'], {
    cwd: root,
    encoding: 'utf8',
  });
} catch (failed) {
  output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
}

// TS6133 is a value ("its value is never read"), TS6196 a type ("never
// used"). Both, or the pass only ever sees half of what it is looking for.
const ours = output
  .split('\n')
  .map(line => line.trim())
  .filter(line => /error TS(6133|6196):/.test(line))
  // `node_modules/@moba2d/core/...` normally, but `../moba2d-core/...` when
  // core is linked from a local checkout — the same files either way, and
  // neither is this package's to fix.
  .filter(line => !line.includes('node_modules') && !line.startsWith('..'));

// Anything else the compiler said is a real type error and belongs to
// `npm run typecheck`, which runs first in `verify` — but if this script is
// run alone, staying silent about it would be misleading.
const otherErrors = output
  .split('\n')
  .filter(line => /error TS/.test(line) && !/error TS(6133|6196):/.test(line))
  .filter(line => !line.includes('node_modules') && !line.trim().startsWith('..'));

if (ours.length === 0 && otherErrors.length === 0) {
  console.log(`check-unused: no unused declarations in ${name}`);
  process.exit(0);
}

for (const line of ours) console.error(line);
if (otherErrors.length > 0) {
  console.error(`\n  ...and ${otherErrors.length} other type error(s); run npm run typecheck.`);
}
console.error(
  `\n  ${ours.length} unused declaration(s). Delete them — an alias nothing reads is not ` +
    `documentation, and this is how 1968 of them accumulated once already.`
);
process.exit(1);
