import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(repoRoot, 'node_modules/.bin/moba2d-check-unused');

/**
 * `moba2d-check-unused` is `tsc --noUnusedLocals` with core's own files
 * filtered out — core ships raw TypeScript, so `node_modules/@moba2d/core/
 * src/**` is part of every pack's program, and a pack whose typecheck goes
 * red because of core's unused locals is a pack that turns the rule off.
 *
 * It was a file the scaffold copied. The three copies that existed differed
 * by exactly one thing: the package name in a single `console.log`, which is
 * read from `package.json` here.
 *
 * **The regression this file exists for is the move.** The old copy rooted
 * itself at `resolve(dirname(fileURLToPath(import.meta.url)), '..')`, and
 * through a `node_modules/.bin` symlink Node resolves `import.meta.url` to
 * the symlink's target — so that would have run `tsc -p tsconfig.json` inside
 * `node_modules/@moba2d/`, typechecking the wrong package or nothing at all.
 * The same trap cost `check-seams` its exit code once; see
 * `checkSeams.bin.test.ts`.
 */
let root: string | undefined;

/** A pack whose one source file is whatever is handed in. */
const pack = async (source: string): Promise<string> => {
  root = await mkdtemp(join(tmpdir(), 'moba2d-check-unused-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: '@moba2d/content-fixture', devDependencies: { '@moba2d/core': '*' } })
  );
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler' },
      include: ['src'],
    })
  );
  // A real typescript to resolve. Without one the check exits 1 saying so —
  // which is itself the fix this fixture uncovered: it used to shell out to
  // `npx tsc`, and npx falls back to macOS's own `tsc` (Turbo C++'s), which
  // prints a joke and exits 0. Every filter then matched nothing and the
  // check reported clean over a compiler that never ran.
  await mkdir(join(root, 'node_modules'));
  await symlink(join(repoRoot, 'node_modules', 'typescript'), join(root, 'node_modules', 'typescript'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'thing.ts'), source);
  return root;
};

const run = (cwd: string) => spawnSync(bin, [], { cwd, encoding: 'utf8' });

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('moba2d-check-unused bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  it('names the package it just checked, read from its package.json', async () => {
    const cwd = await pack('export const used = 1;\n');

    const result = run(cwd);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('@moba2d/content-fixture');
  });

  /**
   * A value alias nothing reads (TS6133) and a type alias nothing uses
   * (TS6196) — both, or the pass only ever sees half of what it looks for.
   */
  it('fails on a value nothing reads and a type nothing uses', async () => {
    const cwd = await pack(
      'type Dead = { a: number };\nfunction f() {\n  const unread = 1;\n}\nexport const kept = f;\n'
    );

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/TS6133/);
    expect(result.stdout + result.stderr).toMatch(/TS6196/);
    expect(result.stderr).toMatch(/unused declaration\(s\)/);
  });

  /**
   * A real type error is `npm run typecheck`'s, which runs first in verify —
   * but staying silent about it when this is run alone would be misleading.
   */
  it('mentions other type errors without claiming them', async () => {
    const cwd = await pack('export const wrong: number = "not a number";\n');

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/other type error\(s\); run npm run typecheck/);
  });

  /**
   * The failure mode the `npx tsc` fallback hid: no compiler, and a green
   * check anyway. It must be loud instead.
   */
  it('refuses to pass when the pack has no typescript to run', async () => {
    const cwd = await pack('export const used = 1;\n');
    await rm(join(cwd, 'node_modules'), { recursive: true, force: true });

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no local typescript/);
  });

  it('refuses to answer outside a pack', async () => {
    root = await mkdtemp(join(tmpdir(), 'moba2d-check-unused-nowhere-'));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/@moba2d\/core/);
  });
});
