import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(repoRoot, 'node_modules/.bin/moba2d-write-manifest');

/**
 * `moba2d-write-manifest` writes the file core fetches *before* it runs any
 * of a pack's code — the one description of a pack that exists before the
 * pack does.
 *
 * It was a file the scaffold copied, and the copies had drifted in ways that
 * only ever surface in production:
 *
 *  - one hardcoded `icon: 'icon.png'` where the template tests for the file,
 *    so deleting `public/icon.png` would point a published manifest at a 404
 *    instead of letting core fall back to its monogram;
 *  - `coreRange` was a literal here *and* in the pack's own data half, with a
 *    paragraph in each saying the two must move together, and a pack test
 *    whose whole body regexed this file's source to compare the strings. The
 *    two are not equal in consequence: only the manifest's copy can refuse an
 *    install, and it is the one that wins. It is read off `data.manifest` now,
 *    so the second copy is gone rather than policed.
 */
let root: string | undefined;

const DATA = {
  manifest: { id: 'x', version: '2.1.0', coreRange: '>=1.4.0', assets: 'x' },
  champions: [
    { id: 'a', playable: true },
    { id: 'b', playable: true },
    { id: 'shelf', playable: false },
  ],
  maps: [{ id: 'm' }],
  items: { i1: {}, i2: {} },
};

/** A built pack: package.json, an installed core, and a `dist/pack.js`. */
const built = async (
  overrides: { data?: unknown; version?: string; core?: string } = {}
): Promise<string> => {
  root = await mkdtemp(join(tmpdir(), 'moba2d-write-manifest-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@moba2d/content-x',
      version: overrides.version ?? '2.1.0',
      // Every real pack declares it, and without it Node warns on stderr that
      // it had to reparse `dist/pack.js` as ESM — noise this asserts is absent.
      type: 'module',
      devDependencies: { '@moba2d/core': '*' },
    })
  );
  await mkdir(join(root, 'node_modules', '@moba2d', 'core'), { recursive: true });
  await writeFile(
    join(root, 'node_modules', '@moba2d', 'core', 'package.json'),
    JSON.stringify({ name: '@moba2d/core', version: overrides.core ?? '1.9.0' })
  );
  await mkdir(join(root, 'dist', 'assets'), { recursive: true });
  await writeFile(join(root, 'dist', 'assets', 'art-abc123.png'), 'x');
  await writeFile(
    join(root, 'dist', 'pack.js'),
    `export const data = ${JSON.stringify(overrides.data ?? DATA)};\n`
  );
  return root;
};

const run = (cwd: string, ...args: string[]) =>
  spawnSync(bin, ['--name=X Pack', ...args], { cwd, encoding: 'utf8' });

const manifestIn = (cwd: string) =>
  JSON.parse(readFileSync(join(cwd, 'dist', 'manifest.json'), 'utf8'));

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('moba2d-write-manifest bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  it('writes what core reads before running a line of the pack', async () => {
    const cwd = await built();

    const result = run(cwd);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const manifest = manifestIn(cwd);
    expect(manifest.id).toBe('x');
    expect(manifest.name).toBe('X Pack');
    expect(manifest.version).toBe('2.1.0');
    expect(manifest.entry).toBe('pack.js');
    expect(manifest.assets).toBe('assets/');
  });

  /** The duplicate this move exists to delete. */
  it('takes coreRange from the built pack rather than a literal of its own', async () => {
    const cwd = await built({
      data: { ...DATA, manifest: { ...DATA.manifest, coreRange: '>=1.7.0' } },
    });
    run(cwd);

    expect(manifestIn(cwd).coreRange).toBe('>=1.7.0');
  });

  /**
   * `data.manifest.assets` is the pack's asset *namespace* (`'lol'`), which
   * `PackRegistry` qualifies keys with. The manifest's `assets` is a
   * *directory* under `dist`. Two fields, one name, different questions —
   * and conflating them would break every asset URL at once.
   */
  it('does not mistake the asset namespace for the asset directory', async () => {
    const cwd = await built();
    run(cwd);

    expect(manifestIn(cwd).assets).toBe('assets/');
  });

  it('counts only playable champions, plus maps and items', async () => {
    const cwd = await built();
    run(cwd);

    const manifest = manifestIn(cwd);
    expect(manifest.champions).toBe(2);
    expect(manifest.maps).toBe(1);
    expect(manifest.items).toBe(2);
  });

  /**
   * The drift that cost the most: a hardcoded `'icon.png'` publishes a
   * manifest pointing at a 404 the day the file goes, and core's monogram
   * fallback — which only fires on an *absent* key — never runs.
   */
  it('omits the icon key entirely when there is no icon', async () => {
    const cwd = await built();
    run(cwd);

    expect('icon' in manifestIn(cwd)).toBe(false);
  });

  it('declares the icon when the build actually emitted one', async () => {
    const cwd = await built();
    await writeFile(join(cwd, 'dist', 'icon.png'), 'png');
    run(cwd);

    expect(manifestIn(cwd).icon).toBe('icon.png');
  });

  /**
   * Derived from the sorted file list, never declared: `version` is a number
   * a human has to remember to bump, and the largest pack there is stayed
   * `1.0.0` across dozens of publishes while its chunks rehashed every time.
   */
  it('derives a buildId that moves when a content hash moves', async () => {
    const cwd = await built();
    run(cwd);
    const first = manifestIn(cwd).buildId;

    await writeFile(join(cwd, 'dist', 'assets', 'art-abc123.png'), 'x');
    await rm(join(cwd, 'dist', 'assets', 'art-abc123.png'));
    await writeFile(join(cwd, 'dist', 'assets', 'art-def456.png'), 'x');
    run(cwd);

    expect(manifestIn(cwd).buildId).not.toBe(first);
    expect(first).toHaveLength(12);
  });

  it('lists every emitted file except the manifest itself', async () => {
    const cwd = await built();
    run(cwd);

    const { files } = manifestIn(cwd);
    expect(files).toContain('pack.js');
    expect(files).toContain('assets/art-abc123.png');
    expect(files).not.toContain('manifest.json');
    expect([...files].sort()).toEqual(files);
  });

  /** A range core's parser cannot read is a pack nobody can install. */
  it('refuses a coreRange core cannot parse', async () => {
    const cwd = await built({
      data: { ...DATA, manifest: { ...DATA.manifest, coreRange: '^1' } },
    });

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not a shape core can parse/);
  });

  /** A floor above what compiled the pack promises members that do not exist. */
  it('refuses a floor above the core it was built against', async () => {
    const cwd = await built({
      data: { ...DATA, manifest: { ...DATA.manifest, coreRange: '>=9.0.0' } },
    });

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/above the core this pack was built against/);
  });

  /**
   * `version` is the one value still stated twice — npm owns package.json's,
   * the data half states its own — so they are compared rather than chosen
   * between. Picking one silently makes the other a lie the next reader
   * trusts.
   */
  it('refuses a version the two halves disagree about', async () => {
    const cwd = await built({ version: '3.0.0' });

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/version disagrees/);
  });

  it('refuses to guess a display name', async () => {
    const cwd = await built();

    const result = spawnSync(bin, [], { cwd, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--name=/);
  });

  /** A pack that grows `data.manifest.name` needs no flag and no flag day. */
  it('prefers a name the pack declares over the flag', async () => {
    const cwd = await built({
      data: { ...DATA, manifest: { ...DATA.manifest, name: 'Declared Name' } },
    });
    run(cwd);

    expect(manifestIn(cwd).name).toBe('Declared Name');
  });

  it('says what is missing when it is run before the build', async () => {
    const cwd = await built();
    await rm(join(cwd, 'dist'), { recursive: true });

    const result = run(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/vite build/);
  });
});
