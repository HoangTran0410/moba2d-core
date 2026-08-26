import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { sharpEntryFrom } from '../../scripts/pack-webp.mjs';

/**
 * Where the WebP re-encoder looks for `sharp`.
 *
 * The plugin's own header has always said `sharp` is *the pack's* dependency
 * and not core's — and `await import('sharp')` did not implement that. Node
 * resolves a bare specifier from the importing file's **real** path, so the
 * moment a pack reaches core through a symlink (which is exactly what
 * `npm run pack:link` creates) the lookup moved into core's `node_modules`,
 * found nothing, and the build shipped 364 PNGs with a warning nobody reads.
 * Measured on the lol pack: 2.3MB of art where 0.87MB was expected, and its
 * own build test caught it only because that test exists.
 */
describe('sharpEntryFrom', () => {
  const made: string[] = [];

  afterEach(async () => {
    await Promise.all(made.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function packWithSharp(installed: boolean): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'pack-webp-'));
    made.push(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@moba2d/content-x' }));
    if (installed) {
      const sharpDir = join(root, 'node_modules', 'sharp');
      await mkdir(sharpDir, { recursive: true });
      await writeFile(
        join(sharpDir, 'package.json'),
        JSON.stringify({ name: 'sharp', version: '0.35.0', main: 'index.js' })
      );
      await writeFile(join(sharpDir, 'index.js'), 'module.exports = {};\n');
    }
    return root;
  }

  it("finds the pack's own sharp, wherever core happens to live", async () => {
    const root = await packWithSharp(true);

    expect(sharpEntryFrom(root)).toContain(join('node_modules', 'sharp'));
  });

  it('answers null for a pack that has not installed it, rather than throwing', async () => {
    // The build must still produce a correct pack — heavier, and warned
    // about. A contributor who cloned a pack to change one number should not
    // meet a native-module install failure as a wall.
    const root = await packWithSharp(false);

    expect(sharpEntryFrom(root)).toBeNull();
  });
});
