import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '@/seams/importScan';

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
 * That directory does not exist yet — Task 7 creates `PackInstallConfirm.vue`
 * there — so `existsSync` below makes its absence silent rather than a
 * failure, the same way `aboutFiles()` treats `scenes/about/`. Unlike that
 * function, this one's own "finds the files it claims to check" case does
 * NOT assert the directory contributed anything: doing so here would make
 * this test shape the code it is meant to check, forcing an empty
 * placeholder component into existence just to satisfy a population floor
 * this task has no file to put there. Task 7 adds that assertion in the same
 * commit that creates the directory's first file.
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
