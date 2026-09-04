#!/usr/bin/env node
/**
 * Puts the perf guard on `git push`, in this repository or in a pack.
 *
 *   node scripts/install-perf-hook.mjs            # here
 *   node scripts/install-perf-hook.mjs ../lol ../naruto ../dota
 *   node scripts/install-perf-hook.mjs --uninstall ../lol
 *
 * A `pre-push` hook rather than `pre-commit`, deliberately. A commit is a
 * private act and often a checkpoint mid-thought; a minute of browser on every
 * one of those is how a guard gets uninstalled by the end of the week. A push
 * is where the work leaves, and it is the last honest moment to say "this
 * ability costs the frame more than you meant it to".
 *
 * The hook it writes finds the guard rather than hard-coding a path, because a
 * pack is its own repository and reaches core two different ways depending on
 * how it was set up: linked into `node_modules` for development, or sitting
 * beside it in the workspace. If neither is there — a checkout with no core to
 * measure against — the hook says so and lets the push through, because a
 * guard that blocks work it cannot actually check is just an outage.
 */
import { existsSync, writeFileSync, chmodSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MARK = '# moba2d-perf-guard';

const HOOK = `#!/bin/sh
${MARK} — installed by scripts/install-perf-hook.mjs
# Measures any spell file this push touches. MOBA2D_PERF_GUARD_SKIP=1 to bypass.
for candidate in \\
  "node_modules/@moba2d/core/scripts/perf-guard.mjs" \\
  "../moba2d-core/scripts/perf-guard.mjs" \\
  "scripts/perf-guard.mjs"
do
  if [ -f "$candidate" ]; then
    exec node "$candidate" --repo "$(pwd)"
  fi
done
echo "perf-guard: no core checkout to measure against, skipping"
exit 0
`;

const uninstall = process.argv.includes('--uninstall');
const targets = process.argv.slice(2).filter(a => !a.startsWith('--'));
const repos = (targets.length ? targets : ['.']).map(t => resolve(t));

let changed = 0;
for (const repo of repos) {
  const hooks = join(repo, '.git', 'hooks');
  if (!existsSync(hooks)) {
    console.log(`  skip  ${repo} — not a git repository`);
    continue;
  }
  const path = join(hooks, 'pre-push');

  if (uninstall) {
    if (existsSync(path) && readFileSync(path, 'utf8').includes(MARK)) {
      unlinkSync(path);
      console.log(`  removed  ${path}`);
      changed++;
    } else {
      console.log(`  skip  ${path} — not ours`);
    }
    continue;
  }

  // Never clobber a hook somebody else wrote; say so and let them merge it.
  if (existsSync(path) && !readFileSync(path, 'utf8').includes(MARK)) {
    console.log(
      `  skip  ${path} — a pre-push hook is already there and is not ours.\n` +
        '        Add this line to it by hand:\n' +
        '          node ../moba2d-core/scripts/perf-guard.mjs --repo "$(pwd)" || exit 1'
    );
    continue;
  }

  writeFileSync(path, HOOK);
  chmodSync(path, 0o755);
  console.log(`  installed  ${path}`);
  changed++;
}
console.log(`\n${changed} hook(s) ${uninstall ? 'removed' : 'installed'}.`);
