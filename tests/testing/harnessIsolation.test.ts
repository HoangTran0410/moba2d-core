import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { scanImports } from '@/seams/importScan';

/**
 * `src/testing/` is `@moba2d/core`'s second published surface — the
 * observer's half, next to `ContentApi`, the spell's half. It is a leaf, not
 * a hub, and this file is the two rules that keep it one.
 *
 * **No shipping source file may import it.** `src/testing/` imports `vi`
 * from `vitest`, which is only safe because nothing outside `src/testing/`
 * itself ever reaches it — that is what makes `peerDependencies.vitest` in
 * `package.json` genuinely `optional`, and a stray import from `src/game/`
 * (or anywhere else that ships) would put a test-only, optional dependency
 * on the app's real bundle path.
 *
 * **`src/testing/`'s own import graph must never reach a `.vue` file.** A
 * pack that has become its own repository runs its own Vitest suite against
 * `@moba2d/core/testing`, and that suite has no reason to install
 * `@vitejs/plugin-vue` — it is core's own `devDependency`, wired into
 * *core's* `vitest.config.ts`, not the published package. If `src/testing/`
 * ever grew a path to an `.vue` file, every separated pack's test run would
 * die on an esbuild parse error it has no way to explain, while core's own
 * suite — which does have the plugin — stayed green throughout. This
 * assertion is the only thing standing between that and "day it happens in
 * production."
 */

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const TESTING_DIR = join(SRC, 'testing');

function tsAndVueFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsAndVueFilesUnder(full));
    else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full);
  }
  return out;
}

/**
 * Whether a specifier names the `testing` path segment at all — `@/testing`,
 * `@/testing/spell`, `../testing/world`, `./testing/index`, or a bare
 * `testing`. Slash-bounded (matching `corePacksBoundary.test.ts`'s
 * `PACK_SPECIFIER` and `aboutBootPath.test.ts`'s `reachesGame`) so
 * `testingUtils` or `./contesting` do not false-match, but otherwise
 * deliberately loose rather than a full filesystem resolution: a specifier
 * is data a human wrote, and the only `testing` directory this repository
 * has is the one this file exists to keep sealed.
 */
const REACHES_TESTING = /(^|\/)testing(\/|$)/;

describe('the test harness is a leaf of the app', () => {
  it('no shipping source file imports src/testing', () => {
    const files = tsAndVueFilesUnder(SRC).filter(
      file => file !== TESTING_DIR && !file.startsWith(TESTING_DIR + sep)
    );
    // A floor, not a magic number: a glob or a walk that silently stopped
    // descending would make this whole test pass by scanning nothing.
    expect(files.length).toBeGreaterThanOrEqual(200);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const { specifier } of scanImports(source)) {
        if (REACHES_TESTING.test(specifier)) {
          offenders.push(`${file.slice(SRC.length + 1)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('src/testing reaches no .vue file, directly or transitively', () => {
    /**
     * Resolve a specifier to a file on disk — relative (`./x`, `../x`) or
     * `@/`-aliased (`@/game/...`, the same alias `vite.config.ts` and
     * `tsconfig.base.json` both point at `src/`). Anything else is a bare
     * package specifier (`vue`, `vitest`, `@moba2d/core/...`) and is not
     * this walk's to resolve — it cannot lead to a `.vue` file inside this
     * repository's own `src/` tree by construction.
     *
     * Whole-branch fix pass: this used to be relative-only, which meant it
     * never actually walked core's own internals — `src/testing/` reaches
     * `src/` throughout via `@/`, not by relative path, so the walk below
     * stopped at whichever files happened to use `../`. Population floor
     * raised from 4 to near the real measured count (see below) for the same
     * reason the first test's floor exists: a resolver that silently stopped
     * resolving would make this test pass by walking almost nothing, exactly
     * as this one did.
     */
    const resolveSpecifier = (from: string, specifier: string): string | null => {
      let base: string;
      if (specifier.startsWith('.')) {
        base = resolve(dirname(from), specifier);
      } else if (specifier.startsWith('@/')) {
        base = join(SRC, specifier.slice('@/'.length));
      } else {
        return null; // bare package specifier — not this repository's own file
      }
      for (const candidate of [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      }
      return null;
    };

    const entries = readdirSync(TESTING_DIR)
      .filter(name => name.endsWith('.ts'))
      .map(name => join(TESTING_DIR, name));

    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const { specifier } of scanImports(source)) {
        const target = resolveSpecifier(file, specifier);
        if (target) queue.push(target);
      }
    }

    // A floor, not a magic number: see the first test's own comment. Measured
    // at 128 once `@/` resolution actually walks core's internals (up from
    // 4, relative-only, which saw only 40 of those 128 through the graph's
    // own real specifiers). Floored below the exact count so a small,
    // legitimate refactor of `src/testing/` or the files it reaches does not
    // make this test flaky.
    expect(seen.size).toBeGreaterThanOrEqual(110);

    const vueFiles = [...seen].filter(file => file.endsWith('.vue'));
    expect(vueFiles.map(file => file.slice(ROOT.length + 1))).toEqual([]);
  });
});
