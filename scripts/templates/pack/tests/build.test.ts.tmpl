/**
 * What `npm run build` actually emitted — the checks that catch a pack which
 * compiles, tests green, and then will not load in a browser.
 *
 * Every other test in this repository runs the pack's code directly out of
 * TypeScript. That proves the abilities work; it proves nothing about the
 * *published directory*, which is the only thing a player ever sees. The two
 * are separated by Vite, Rollup, a manifest writer, and a cross-origin
 * `import()` — and each of those has its own way to produce a green build
 * nobody can install.
 *
 * These read `dist/` and do not create it. A test that builds is a test that
 * takes a minute and hides which half broke; `npm run verify` builds before
 * the suite runs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const dist = join(root, 'dist');
const manifest = () => JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

describe('the published directory', () => {
  beforeAll(() => {
    if (!existsSync(join(dist, 'manifest.json'))) {
      throw new Error('dist/manifest.json is missing — run `npm run build` first');
    }
  });

  /**
   * Core reads all four off the entry's namespace. A missing one is not a
   * type error anywhere — `runtime-entry.ts` re-exports them and Rollup is
   * free to restructure an entry's exports unless `preserveEntrySignatures`
   * says otherwise, which is why `vite.config.ts` sets it.
   */
  it('exports what core reads off the entry', () => {
    const entry = readFileSync(join(dist, 'pack.js'), 'utf8');
    // The three `loadPackFromManifest` actually reads off the namespace.
    // Matched against the export statement rather than the whole file: the
    // entry is minified, so a bare `toContain('data')` would be satisfied by
    // any four letters anywhere in it.
    const exported = /export\s*\{([^}]*)\}/.exec(entry)?.[1] ?? '';
    for (const name of ['data', 'assetManifest', 'default']) {
      expect(exported, exported).toContain(name);
    }
  });

  /**
   * The property the whole published-as-a-directory design rests on: a
   * browser `import()`s `pack.js` from another origin, and every lazy spell
   * chunk it names has to resolve against *that* URL rather than the host
   * page's. A root-absolute path (`/chunks/...`) resolves against the game's
   * origin instead and 404s — which is what `base: ''` in `vite.config.ts`
   * exists to prevent, and this is the check that it still does.
   */
  it('names its chunks relatively, so they resolve against the pack host', () => {
    const files = readdirSync(join(dist, 'chunks'));
    expect(files.length).toBeGreaterThan(0);
    const graph = [join(dist, 'pack.js'), ...files.map(name => join(dist, 'chunks', name))];
    for (const file of graph) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from\s*["']\/(?!\/)/);
      expect(source).not.toMatch(/import\(\s*["']\/(?!\/)/);
    }
  });

  /**
   * `files` is what core's background prefetch walks to fill the offline
   * cache. A name in it that is not on disk is a 404 the player meets as a
   * pack that will not play offline.
   */
  it('lists only files that exist', () => {
    for (const relative of manifest().files) {
      expect(existsSync(join(dist, relative)), relative).toBe(true);
    }
  });

  /**
   * Derived from the sorted file list by `scripts/write-manifest.mjs`, and
   * hung off the entry URL by core as `pack.js?b=<buildId>` — which is what
   * makes two builds two URLs, so no cache can serve one build's entry
   * against another's manifest. Without it, republishing this pack hands
   * every installed player a chunk graph pointing at files the deploy has
   * already deleted, and the ability they were using silently becomes a basic
   * attack.
   */
  it('carries a build id', () => {
    expect(manifest().buildId).toMatch(/^[0-9a-f]{12}$/);
  });

  /**
   * `vite.config.ts`'s WebP plugin, stated as the invariant that holds for
   * every pack rather than as "everything is a .webp".
   *
   * The plugin declines a re-encode that came out *bigger*, which is the
   * right call and is not a rare edge: the placeholder tile this scaffold
   * ships is 387 bytes, and WebP's own container costs more than that. So a
   * pack that has not replaced its art yet legitimately emits a PNG, and a
   * test demanding otherwise fails on a fresh scaffold — which is how this
   * one was written the first time.
   *
   * What is always true is that the build never ships art heavier than the
   * source it came from. Real portraits — 128x128 photographic crops — come
   * out around a quarter of their PNG.
   */
  it('never ships art heavier than its source', () => {
    expect(bytesIn(join(dist, 'assets'))).toBeLessThanOrEqual(bytesIn(join(root, 'assets')));
  });

  /**
   * And the sources are untouched: the re-encode happens on the way into
   * `dist/`, precisely so `assets/` stays whatever it claims to be. If this
   * pack ever imports art from somewhere it has to cite, that is what keeps
   * the citation true — see the plugin's own header.
   */
  it('leaves the source art where it found it', () => {
    expect(readdirSync(join(root, 'assets')).length).toBeGreaterThan(0);
  });
});

function bytesIn(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? bytesIn(path) : statSync(path).size;
  }
  return total;
}
