#!/usr/bin/env node
/**
 * The thing that runs before you push a spell, so a frame-eater never lands.
 *
 *   moba2d-perf-guard                 # spells changed against upstream
 *   moba2d-perf-guard --static-only   # skip the browser, ~1s
 *   moba2d-perf-guard --strict        # a static finding fails too
 *   MOBA2D_PERF_GUARD_SKIP=1 git push # the escape hatch, for when you mean it
 *
 * Called from each repository's own versioned `scripts/git-hooks/pre-push` —
 * core's and every pack's, because the packs are separate repositories and a
 * spell can be pushed from any of them. It is wired into the versioned hook
 * rather than written into `.git/hooks` by an installer, which is how the first
 * attempt got this wrong: all four repositories set `core.hooksPath`, so git
 * never read `.git/hooks/pre-push` and the guard reported itself installed
 * without ever having run.
 *
 * ## Two passes, because they answer different questions
 *
 * **Static** (`perf-scan.mjs`) reads the shape and costs a second. It knows an
 * effect *looks* expensive: a hand-rolled particle array, a body of two hundred
 * primitives, a composite-op switch paid per wearer. It cannot know how many of
 * them are ever alive at once.
 *
 * **Dynamic** (`tests/e2e/measure-spell-cost.mjs`) casts the ability in a real
 * match until the board is full of it and measures the frame. It answers the
 * only question that decides a teamfight — *microseconds per live instance per
 * frame* — and it is the one that can fail a push.
 *
 * What it refuses on is calibrated against a sampled population of the packs'
 * own abilities rather than picked: the median ability costs ~0.7ms a frame
 * under saturation, the 90th percentile ~2.2ms. Over 3ms is called heavy and
 * reported; a refusal needs 150us per live instance or twice that aggregate,
 * *and* a second measurement agreeing — because the same ability measured
 * twice moved by up to 68%, and a gate decided by one noisy run refuses good
 * work. It did: a branch that made three abilities 35-64% cheaper was blocked
 * by this.
 *
 * They disagree usefully, which is why both are here. A summoned pet reads as
 * the third-heaviest body in three packs and measures fine, because there is
 * only ever one of it. An effect that reads as ordinary measures over budget
 * because a wave-clear puts fifty on screen. Neither pass alone would have said
 * so.
 *
 * The dynamic pass needs core's dev checkout (Vite, Playwright, a browser). A
 * pack that has one — every linked development checkout does — gets both; a
 * pack that does not is told, and gets the static pass rather than nothing.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource } from './perf-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(HERE, '..');

const argv = process.argv.slice(2);
const has = name => argv.includes(`--${name}`);
const valueOf = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};

if (process.env.MOBA2D_PERF_GUARD_SKIP) {
  console.log('perf-guard: skipped (MOBA2D_PERF_GUARD_SKIP)');
  process.exit(0);
}

const repo = resolve(valueOf('repo', process.cwd()));
// `stderr: 'pipe'` so a probe that is *expected* to fail (no upstream yet) does
// not print git's own fatal above our own explanation of it.
const git = (...a) =>
  execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * What this push is actually adding.
 *
 * Upstream when the branch has one. When it does not — the case that matters,
 * because a *first* push of a branch is exactly when a whole feature's worth of
 * spells arrives at once — fall back to where it left the trunk, not to
 * `HEAD~1`. That was the original fallback and it was close to useless: it saw
 * the last commit only, so a branch of a dozen commits was gated on whichever
 * one happened to be on top, and putting an unrelated commit last was enough to
 * walk the guard past everything before it.
 */
const range = (() => {
  try {
    git('rev-parse', '--abbrev-ref', '@{u}');
    return '@{u}...HEAD';
  } catch {
    /* no upstream yet — this branch has never been pushed */
  }
  for (const trunk of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      const base = git('merge-base', trunk, 'HEAD');
      if (base) return `${base}..HEAD`;
    } catch {
      /* that trunk does not exist here */
    }
  }
  return 'HEAD~1..HEAD';
})();

let changed = [];
try {
  changed = git('diff', '--name-only', range).split('\n').filter(Boolean);
} catch {
  console.log('perf-guard: no comparable history, nothing to check');
  process.exit(0);
}

/** A spell file in any pack, or core's own drawable game objects. */
const isSpellish = file =>
  /\.ts$/.test(file) &&
  !/\.test\.ts$/.test(file) &&
  (/(^|\/)spells\//.test(file) || /^src\/game\/gameObject\//.test(file));

const touched = changed.filter(isSpellish).filter(file => existsSync(join(repo, file)));
if (touched.length === 0) {
  console.log('perf-guard: no spell files in this push');
  process.exit(0);
}

console.log(`\nperf-guard: ${touched.length} spell file(s) in this push\n`);

// ---------------------------------------------------------------- static pass
let staticFindings = 0;
for (const file of touched) {
  const findings = scanSource(readFileSync(join(repo, file), 'utf8'));
  if (findings.length === 0) continue;
  staticFindings += findings.length;
  console.log(`  ${file}`);
  for (const finding of findings.sort((a, b) => b.weight - a.weight)) {
    console.log(`    [${finding.rule}] ${finding.note}`);
  }
}
console.log(
  staticFindings === 0
    ? '  static: clean\n'
    : `  static: ${staticFindings} finding(s) — see npm run perf:scan for the rules\n`
);

// --------------------------------------------------------------- dynamic pass
const MAX_SPELLS = Number(valueOf('max-spells', 6));
const spells = [...new Set(touched.map(f => basename(f, '.ts')))]
  .filter(name => /^[A-Za-z][\w]*_[A-Za-z0-9]+$/.test(name))
  .slice(0, MAX_SPELLS);

const driver = join(CORE, 'tests/e2e/measure-spell-cost.mjs');
const canMeasure = existsSync(driver) && existsSync(join(CORE, 'node_modules/playwright'));

if (has('static-only') || spells.length === 0 || !canMeasure) {
  if (!canMeasure && !has('static-only') && spells.length > 0) {
    // A published core ships `src` and these scripts but not `tests/`, and a
    // pack's own `node_modules` has no browser — so this is the ordinary case
    // outside a development workspace, not a misconfiguration to shout about.
    console.log(
      '  dynamic: skipped — no core dev checkout with Playwright beside this repo.\n' +
        `  From a core checkout:  npm run perf:spell -- ${spells.join(' ')}\n`
    );
  }
  process.exit(has('strict') && staticFindings > 0 ? 1 : 0);
}

console.log(`  dynamic: casting ${spells.join(', ')} — this takes about a minute\n`);
const run = spawnSync(
  process.execPath,
  [
    driver,
    ...spells,
    '--budget',
    String(valueOf('budget', 150)),
    '--delta-budget',
    String(valueOf('delta-budget', 3)),
    '--delta-fail',
    String(valueOf('delta-fail', 6)),
  ],
  { cwd: CORE, stdio: 'inherit' }
);

if (run.status !== 0) {
  console.error(
    '\nperf-guard: refused. Push again with MOBA2D_PERF_GUARD_SKIP=1 if this is\n' +
      'a cost you have decided to pay.\n'
  );
  process.exit(1);
}
process.exit(has('strict') && staticFindings > 0 ? 1 : 0);
