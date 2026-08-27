import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  lstat,
  realpath,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { linkPack, unlinkPack, linkedPacks } from '../../scripts/pack-link.mjs';
// @ts-expect-error — same.
import { devLinkedPacks } from '../../scripts/lib/devLinks.mjs';

/**
 * Wiring a pack in this checkout into this checkout's core.
 *
 * The monorepo-only half of local development, and the *narrow* half: almost
 * nobody writing a pack has a copy of core to link it into — see
 * `scripts/pack-serve.mjs` for what they use instead. This exists because the
 * two repositories that do sit side by side here are, without it, connected in
 * neither direction: core cannot see the pack at all, and the pack's own tests
 * run against a copy of core npm fetched from GitHub rather than the checkout
 * next to it.
 */
describe('moba2d-pack-link', () => {
  const made: string[] = [];

  afterEach(async () => {
    await Promise.all(made.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function workspace(): Promise<{ coreRoot: string; packDir: string }> {
    const root = await mkdtemp(join(tmpdir(), 'pack-link-'));
    made.push(root);
    const coreRoot = join(root, 'moba2d-core');
    const packDir = join(root, 'my-pack');
    await mkdir(join(coreRoot, 'node_modules', '@moba2d'), { recursive: true });
    await writeFile(join(coreRoot, 'package.json'), JSON.stringify({ name: '@moba2d/core' }));
    await mkdir(join(packDir, 'generated'), { recursive: true });
    await writeFile(
      join(packDir, 'package.json'),
      JSON.stringify({ name: '@moba2d/content-my-pack' })
    );
    await writeFile(join(packDir, 'pack.ts'), '');
    await writeFile(join(packDir, 'generated', 'assetManifest.ts'), '');
    return { coreRoot, packDir };
  }

  const linkTarget = async (path: string): Promise<string> => {
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    return realpath(path);
  };

  it('links both directions, because both were broken', async () => {
    const { coreRoot, packDir } = await workspace();

    await linkPack({ coreRoot, packDir });

    // Core can now see the pack: this is the exact shape
    // `scripts/installed-packs.mjs` reads to answer "what is installed".
    expect(await linkTarget(join(coreRoot, 'node_modules/@moba2d/content-my-pack'))).toBe(
      await realpath(packDir)
    );
    // And the pack's tests now run against the core sitting beside it, not a
    // published copy that only looks like it.
    expect(await linkTarget(join(packDir, 'node_modules/@moba2d/core'))).toBe(
      await realpath(coreRoot)
    );
  });

  it('keeps the npm-installed core aside, so unlinking needs no network', async () => {
    const { coreRoot, packDir } = await workspace();
    const installed = join(packDir, 'node_modules', '@moba2d', 'core');
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, 'package.json'), JSON.stringify({ version: '1.4.0' }));

    await linkPack({ coreRoot, packDir });
    await unlinkPack({ coreRoot, name: 'my-pack', packDir });

    const restored = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    expect(restored.version).toBe('1.4.0');
    expect((await lstat(installed)).isSymbolicLink()).toBe(false);
  });

  it('unlinks the pack from core, leaving the checkout as it found it', async () => {
    const { coreRoot, packDir } = await workspace();
    await linkPack({ coreRoot, packDir });

    await unlinkPack({ coreRoot, name: 'my-pack', packDir });

    expect(await linkedPacks(coreRoot)).toEqual([]);
  });

  it('is safe to run twice — a re-link after npm install is the normal case', async () => {
    const { coreRoot, packDir } = await workspace();

    await linkPack({ coreRoot, packDir });
    await linkPack({ coreRoot, packDir });

    expect(await linkedPacks(coreRoot)).toEqual(['my-pack']);
    // The aside copy must not have been overwritten by the symlink the first
    // run left behind: that would put a link where the real directory was and
    // make unlinking restore nothing.
    expect(await linkTarget(join(packDir, 'node_modules/@moba2d/core'))).toBe(
      await realpath(coreRoot)
    );
  });

  it("never counts core's own reference pack as something it linked", async () => {
    // Found by running it: `content-reference` is a symlink too — npm's own
    // workspace link — so a bare "every linked content-* package" reading
    // swept up core's own pack and `--all` unlinked it, emptying the barrel
    // of the one pack that is never optional. `installed-packs.mjs` has the
    // same exclusion, for the same reason.
    const { coreRoot, packDir } = await workspace();
    await mkdir(join(coreRoot, 'packs', 'reference'), { recursive: true });
    await symlink(
      join(coreRoot, 'packs', 'reference'),
      join(coreRoot, 'node_modules', '@moba2d', 'content-reference'),
      'dir'
    );
    await linkPack({ coreRoot, packDir });

    expect(await linkedPacks(coreRoot)).toEqual(['my-pack']);

    await unlinkPack({ coreRoot, name: 'reference' });

    expect(
      (await lstat(join(coreRoot, 'node_modules/@moba2d/content-reference'))).isSymbolicLink()
    ).toBe(true);
  });

  it("tells a development link from npm's own by where it points, not by name", async () => {
    // The distinction that matters is *outside the checkout*, not a list of
    // names: a pack npm linked from `packs/` is a committed, ordinary part of
    // this repository, and a pack linked from a sibling directory is one
    // person's working state that must never be committed. Name matching got
    // the reference pack right by luck and would get the next in-tree pack
    // wrong.
    const { coreRoot, packDir } = await workspace();
    await mkdir(join(coreRoot, 'packs', 'in-tree'), { recursive: true });
    await symlink(
      join(coreRoot, 'packs', 'in-tree'),
      join(coreRoot, 'node_modules', '@moba2d', 'content-in-tree'),
      'dir'
    );
    // And a pack npm actually installed — a real directory, no link at all.
    await mkdir(join(coreRoot, 'node_modules', '@moba2d', 'content-fetched'), { recursive: true });

    await linkPack({ coreRoot, packDir });

    expect(devLinkedPacks(coreRoot).map((pack: { name: string }) => pack.name)).toEqual([
      'my-pack',
    ]);
  });

  /**
   * The state the gate was blind to, and the one that cost an afternoon: the
   * pack directory is renamed out from under the link.
   *
   * `devLinkedPacks` used to skip a dangling link, so `links:check` — the one
   * line in `verify` whose entire job is to notice a link — printed *"links
   * ok: no pack is linked for development"* about a checkout where every test
   * file failed to collect on `@moba2d/content-my-pack/pack`. And because
   * `--all` asks this same function what to unlink, the documented repair
   * could not clean it up either.
   */
  it('reports a link whose pack has been renamed away, and can still unlink it', async () => {
    const { coreRoot, packDir } = await workspace();
    await linkPack({ coreRoot, packDir });
    // The rename, which is exactly what happened: the sibling checkout kept
    // its contents and changed its name.
    await rm(packDir, { recursive: true, force: true });

    const [dangling] = devLinkedPacks(coreRoot) as {
      name: string;
      target: string;
      missing: boolean;
    }[];
    expect(dangling, 'a dangling link read as no link at all').toBeDefined();
    expect(dangling.name).toBe('my-pack');
    expect(dangling.missing).toBe(true);
    // Where it *meant* to point — the whole clue, and the only place the old
    // path survives once the directory is gone.
    expect(await realpath(dangling.target).catch(() => dangling.target)).toBe(packDir);

    // And `--all` can reach it, which it could not while this read as nothing.
    expect(await linkedPacks(coreRoot)).toEqual(['my-pack']);
    await unlinkPack({ coreRoot, name: 'my-pack' });
    expect(await linkedPacks(coreRoot)).toEqual([]);
  });

  it('still ignores a broken link that points inside the checkout', async () => {
    // A deleted `packs/…` is a repository problem, not one person's working
    // state — a different question, with a different answer, and not this
    // function's. Without the distinction, a half-finished in-tree pack would
    // start failing `links:check` with advice about unlinking it.
    const { coreRoot } = await workspace();
    await symlink(
      join(coreRoot, 'packs', 'gone'),
      join(coreRoot, 'node_modules', '@moba2d', 'content-gone'),
      'dir'
    );

    expect(devLinkedPacks(coreRoot)).toEqual([]);
  });

  it('refuses a directory that is not a content pack, by name', async () => {
    const { coreRoot } = await workspace();
    const stranger = await mkdtemp(join(tmpdir(), 'not-a-pack-'));
    made.push(stranger);
    await writeFile(join(stranger, 'package.json'), JSON.stringify({ name: 'some-app' }));

    await expect(linkPack({ coreRoot, packDir: stranger })).rejects.toThrow(/@moba2d\/content-/);
  });

  it('refuses a pack missing a file the barrel will need, naming the file', async () => {
    const { coreRoot, packDir } = await workspace();
    await rm(join(packDir, 'generated', 'assetManifest.ts'));

    // The alternative is an unresolved specifier in `tsc`'s output three steps
    // later, with nothing in the message naming the pack or the file.
    await expect(linkPack({ coreRoot, packDir })).rejects.toThrow(/assetManifest\.ts/);
  });
});
