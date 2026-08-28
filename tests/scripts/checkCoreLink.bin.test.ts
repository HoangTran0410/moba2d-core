import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(repoRoot, 'node_modules/.bin/moba2d-check-core-link');

/**
 * `moba2d-check-core-link` catches the one `node_modules` state nobody
 * remembers to check for: a pack linked to a sibling core checkout, and an
 * `npm install` since replaced the symlink with the git copy — so typecheck
 * and tests silently run against the wrong core.
 *
 * It was a file the scaffold copied, byte-identical in every checkout that
 * had one, which is what made it a bin.
 *
 * **The regression this file exists for is the move itself.** The old copy
 * found its pack root with `resolve(dirname(fileURLToPath(import.meta.url)),
 * '..')`. Reached through a `node_modules/.bin` symlink Node resolves
 * `import.meta.url` to the symlink's *target*, so that expression answers
 * `node_modules/@moba2d/` — which has no `node_modules/@moba2d/core` under
 * it, so every pack would report as never-linked and the check would pass
 * always, silently, exactly like the `check-seams` bug
 * `checkSeams.bin.test.ts` records.
 */
let root: string | undefined;

/** A pack: a `package.json` naming core, plus whatever `@moba2d/` state. */
const pack = async (suffix: string): Promise<string> => {
  root = await mkdtemp(join(tmpdir(), `moba2d-core-link-${suffix}-`));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: '@moba2d/content-x', devDependencies: { '@moba2d/core': '*' } })
  );
  await mkdir(join(root, 'node_modules', '@moba2d'), { recursive: true });
  return root;
};

const scope = (cwd: string) => join(cwd, 'node_modules', '@moba2d');

const run = (cwd: string, ...args: string[]) => spawnSync(bin, args, { cwd, encoding: 'utf8' });

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('moba2d-check-core-link bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  it('passes silently for a pack that was never linked', async () => {
    const cwd = await pack('never');
    await mkdir(join(scope(cwd), 'core'));

    const result = run(cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  /**
   * The whole point, and the case the `import.meta.url` bug would have
   * silently passed: a real directory where a symlink used to be, with the
   * marker `pack:link` wrote still beside it.
   */
  it('fails when the link was stomped, naming the repair', async () => {
    const cwd = await pack('stomped');
    await mkdir(join(scope(cwd), 'core'));
    await writeFile(join(scope(cwd), '.core-link-target'), '/somewhere/moba2d-core\n');

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/link is GONE/);
    expect(result.stderr).toMatch(/pack:link/);
    expect(result.stderr).toContain('/somewhere/moba2d-core');
  });

  /** The parked npm copy outlives the symlink too, and says the same thing. */
  it('also fails on the parked copy alone, with no marker', async () => {
    const cwd = await pack('parked');
    await mkdir(join(scope(cwd), 'core'));
    await mkdir(join(scope(cwd), '.core-npm'));

    expect(run(cwd).status).toBe(1);
  });

  it('passes while the link is still a link', async () => {
    const cwd = await pack('linked');
    await mkdir(join(cwd, 'real-core'));
    await symlink(join(cwd, 'real-core'), join(scope(cwd), 'core'));
    await writeFile(join(scope(cwd), '.core-link-target'), join(cwd, 'real-core'));

    const result = run(cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  /**
   * `postinstall` runs this in the very install that did the damage, and an
   * install that fails there is worse than the drift it reports.
   */
  it('warns without failing under --warn-only', async () => {
    const cwd = await pack('warn');
    await mkdir(join(scope(cwd), 'core'));
    await writeFile(join(scope(cwd), '.core-link-target'), '/somewhere/moba2d-core');

    const result = run(cwd, '--warn-only');

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/link is GONE/);
  });

  /** Run from a subdirectory, the way a pack's own tooling might. */
  it('finds the pack root from inside the pack, not from its own location', async () => {
    const cwd = await pack('nested');
    await mkdir(join(scope(cwd), 'core'));
    await writeFile(join(scope(cwd), '.core-link-target'), '/somewhere/moba2d-core');
    await mkdir(join(cwd, 'spells', 'deep'), { recursive: true });

    expect(run(join(cwd, 'spells', 'deep')).status).toBe(1);
  });

  /**
   * Somewhere that is not a pack at all must say so, rather than walking to
   * the filesystem root and reporting a clean bill of health it never checked.
   */
  it('refuses to answer outside a pack', async () => {
    root = await mkdtemp(join(tmpdir(), 'moba2d-core-link-nowhere-'));

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/@moba2d\/core/);
  });
});
