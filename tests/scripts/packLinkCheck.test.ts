import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repoRoot, 'scripts', 'pack-link.mjs');

/**
 * The gate that stops a working state from being committed.
 *
 * Linking a pack rewrites `src/generated/installedPacks.ts`, which is tracked.
 * Committed by accident, it names a package nobody else has, and the next
 * person to clone core gets `TS2307: Cannot find module
 * '@moba2d/content-lol/pack'` — about a package they have never heard of.
 * `packs:check` cannot catch it *while the link is still there*, because the
 * barrel and the filesystem genuinely agree; the disagreement only appears on
 * a machine that has already pulled the mistake.
 *
 * So the check is "is anything linked", not "does the barrel match", and it
 * runs first in `verify` — the command standing immediately before a commit.
 * Running first is half the value: the four core test files that assume a
 * core-only checkout go red under any link, and read as "the pack broke core"
 * rather than "you are still linked". Failing before them means nobody has to
 * make that inference.
 */
describe('pack-link --check', () => {
  const made: string[] = [];

  afterEach(async () => {
    await Promise.all(made.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function coreWith(links: { name: string; outside: boolean }[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'link-check-'));
    made.push(root);
    const coreRoot = join(root, 'moba2d-core');
    const scope = join(coreRoot, 'node_modules', '@moba2d');
    await mkdir(scope, { recursive: true });
    for (const link of links) {
      const target = link.outside
        ? join(root, link.name)
        : join(coreRoot, 'packs', link.name);
      await mkdir(target, { recursive: true });
      await symlink(target, join(scope, `content-${link.name}`), 'dir');
    }
    await writeFile(join(coreRoot, 'package.json'), JSON.stringify({ name: '@moba2d/core' }));
    return coreRoot;
  }

  const check = (coreRoot: string) =>
    spawnSync(process.execPath, [script, '--check'], { cwd: coreRoot, encoding: 'utf8' });

  it('passes a checkout with nothing linked for development', async () => {
    const coreRoot = await coreWith([{ name: 'reference', outside: false }]);

    const result = check(coreRoot);

    expect(result.status).toBe(0);
  });

  it('fails, naming the pack and the way out', async () => {
    const coreRoot = await coreWith([
      { name: 'reference', outside: false },
      { name: 'lol', outside: true },
    ]);

    const result = check(coreRoot);

    expect(result.status).toBe(1);
    const said = `${result.stdout}${result.stderr}`;
    expect(said).toContain('lol');
    expect(said).toContain('pack:unlink');
  });
});
