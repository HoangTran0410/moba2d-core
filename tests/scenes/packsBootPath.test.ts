import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '@/seams/importScan';
import { DEFAULT_PACK_URL } from '@/content/runtimePacks';

/**
 * The packs screen is reached from the menu, before any match exists, so
 * nothing under it may statically import a `src/game/` runtime value — one
 * such import puts the whole match in the chunk a player downloads to read a
 * list of installed packs.
 *
 * It is a real risk here rather than a theoretical one, and more so than for
 * the About screen: installing a pack for real needs `buildContentApi()` and
 * `rebuildContentRegistry()`, which live in `runtimePacks.ts` — pinned to the
 * `game` chunk in `vite.config.ts` precisely because they do. The sanctioned
 * crossing is a dynamic `import()` at the moment a player presses install,
 * and this test plus `chunks:check`'s `PacksScene` rule are the two things
 * that keep it dynamic.
 */
const SRC = join(__dirname, '../../src');
const PACKS_DIR = join(SRC, 'scenes', 'packs');

/**
 * `PacksScene.ts`/`.vue` plus every file `scenes/packs/` holds.
 *
 * `existsSync` below makes the directory's absence silent rather than a
 * failure, the same way `aboutFiles()` treats `scenes/about/` — kept even
 * though Task 7 (`PackInstallConfirm.vue`) means the directory always exists
 * from this commit on, so a future removal of every file under it fails
 * loudly here rather than in a `readdirSync` throw.
 */
function packsFiles(): string[] {
  const files = ['scenes/PacksScene.ts', 'scenes/PacksScene.vue'];
  if (existsSync(PACKS_DIR)) {
    for (const name of readdirSync(PACKS_DIR)) {
      if (name.endsWith('.ts') || name.endsWith('.vue')) files.push(`scenes/packs/${name}`);
    }
  }
  return files;
}

/**
 * Static `import ... from '<spec>'` only, value ones — `import(` is dynamic,
 * `import type` (whole-statement or a fully type-prefixed inline clause) is
 * erased, and a side-effect `import 'x';` is not a shape this file has ever
 * checked for.
 */
function staticImports(source: string): string[] {
  return scanImports(source)
    .filter(({ kind }) => kind === 'value')
    .map(({ specifier }) => specifier);
}

const reachesGame = (specifier: string): boolean =>
  specifier.includes('@/game/') || specifier.includes('/game/');

/** The one `src/content/` module pinned to the `game` chunk — see this file's header. */
const reachesRuntimePacks = (specifier: string): boolean =>
  specifier === '@/content/runtimePacks' || specifier.endsWith('/content/runtimePacks');

describe('the packs screen boots without the game', () => {
  it('finds the files it claims to check', () => {
    const files = packsFiles();
    expect(files, 'scenes/PacksScene.ts left the list').toContain('scenes/PacksScene.ts');
    expect(files, 'scenes/PacksScene.vue left the list').toContain('scenes/PacksScene.vue');
    // Task 7's own assertion, added in the same commit that gives
    // `scenes/packs/` its first file (`PackInstallConfirm.vue`) — see this
    // function's own doc comment for why it did not exist before.
    expect(files.length, 'scenes/packs/ contributed no file').toBeGreaterThan(2);
    for (const file of files) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} is missing`).not.toThrow();
    }
  });

  it('no packs-screen module statically imports the game', () => {
    const offenders: string[] = [];

    for (const file of packsFiles()) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      for (const specifier of staticImports(source)) {
        if (reachesGame(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no packs-screen module statically imports runtimePacks', () => {
    const offenders: string[] = [];

    for (const file of packsFiles()) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      for (const specifier of staticImports(source)) {
        if (reachesRuntimePacks(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * `PacksScene.vue` cannot statically import `DEFAULT_PACK_URL` from
   * `@/content/runtimePacks` — that is exactly the crossing the case above
   * bans, since reaching that module at all would pin the packs screen to
   * the `game` chunk. So the URL is duplicated there as a literal (see that
   * component's own doc comment), and nothing at runtime catches the two
   * drifting apart.
   *
   * A *test* file is not bound by the same constraint: `vite.config.ts`'s
   * `manualChunks` only runs at build time, and Vitest never goes through
   * it, so this case can import the real constant directly. Without this
   * cross-check, a future edit to `DEFAULT_PACK_URL` would silently leave
   * the packs screen's empty-state hint pointing at a dead pack, with
   * nothing anywhere to catch it.
   */
  it('the duplicated DEFAULT_PACK_URL literal matches the real constant', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/PacksScene.vue'), 'utf8'));
    const match = source.match(/const DEFAULT_PACK_URL = '([^']*)'/);

    expect(match, 'PacksScene.vue no longer declares a DEFAULT_PACK_URL literal').not.toBeNull();
    expect(match![1]).toBe(DEFAULT_PACK_URL);
  });

  it('MenuScene reaches it only through a dynamic import', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/MenuScene.ts'), 'utf8'));
    expect(staticImports(source).some(specifier => /PacksScene/.test(specifier))).toBe(false);
    expect(source).toMatch(/import\(['"]\.\/PacksScene['"]\)/);
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = `
      import Champion from '@/game/gameObject/attackableUnits/Champion';
      import type Game from '@/game/Game';
      import { installPackNow } from '@/content/runtimePacks';
      const later = () => import('@/game/Game');
      const alsoLater = () => import('@/content/runtimePacks');
    `;
    const statics = staticImports(sample);
    expect(statics.filter(reachesGame)).toEqual(['@/game/gameObject/attackableUnits/Champion']);
    expect(statics.filter(reachesRuntimePacks)).toEqual(['@/content/runtimePacks']);
  });
});
