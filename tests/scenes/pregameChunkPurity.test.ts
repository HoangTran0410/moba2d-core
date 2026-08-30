import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports } from '@/seams/index';

/**
 * The `pregame` carve-out, checked from the inside.
 *
 * `vite.config.ts` pins **every file under `src/game/config/`** to the
 * `pregame` chunk, by path, because that directory is the setup screen's data
 * layer — a match's config, its saved kits, its spell catalogue, its zoom
 * bounds. The rule is a path test, so a file dropped into that directory joins
 * the menu's first paint whether or not it belongs there.
 *
 * `mapTuning.ts` is what that cost. It reads core's own defaults for
 * everything a map may retune, so it value-imported `Wallet`, `Minion`,
 * `Monster` and `Turret` — four engine modules, and through them the whole
 * match. `chunks:check` reported it as `pregame statically imports game`, and
 * that check only runs after a full build, on a machine that ran one.
 *
 * `pregameBootPath.test.ts` could not see it: that file scans the *scenes*
 * that reach into `src/game/`, and the carve-out's own residents are the other
 * half of the same promise. This is that half — a source scan, in the suite,
 * naming the file and the specifier.
 *
 * The fix that pattern points at is already in the tree twice:
 * `game/items/itemStats.ts` and now `game/config/tuningDefaults.ts` are bare
 * tables with no imports, read from both sides of the boundary. A default that
 * belongs to a class lives beside the class *by re-export*, and the value
 * lives where the reader that cannot afford the engine can reach it.
 */

const CONFIG_DIR = join(__dirname, '../../src/game/config');

/**
 * What a file in the carve-out may value-import from `src/game/`.
 *
 * Only its own neighbours: everything under `src/game/config/` is in the same
 * chunk, so an edge between two of them cannot cross a boundary. `constants`
 * is carved in beside them by the same rule in `vite.config.ts`.
 *
 * A path added here without the matching line in that config is the failure
 * this list exists to make deliberate rather than silent.
 */
const SAME_CHUNK = /^(?:\.\/|\.\.\/config\/|@\/game\/config\/|@\/game\/constants)/;

const files = (): string[] =>
  readdirSync(CONFIG_DIR).filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'));

/** Static value imports only — `import type` is erased and crosses nothing. */
const valueImports = (name: string): string[] =>
  scanImports(readFileSync(join(CONFIG_DIR, name), 'utf8'))
    .filter(entry => entry.kind === 'value')
    .map(entry => entry.specifier);

describe('the pregame chunk carries no engine', () => {
  it('reads enough files to be worth running', () => {
    // Vacuous the day someone moves the directory, and this is the only place
    // that would notice.
    expect(files().length).toBeGreaterThan(5);
    expect(files()).toContain('mapTuning.ts');
  });

  it('never value-imports the match out of src/game/config', () => {
    const crossings: string[] = [];
    for (const name of files()) {
      for (const specifier of valueImports(name)) {
        const reachesGame = specifier.startsWith('@/game/') || specifier.includes('/game/');
        if (!reachesGame) continue;
        if (SAME_CHUNK.test(specifier)) continue;
        crossings.push(`${name}: ${specifier}`);
      }
    }

    expect(crossings).toEqual([]);
  });

  it('and the defaults module it leans on imports nothing at runtime', () => {
    // `tuningDefaults.ts` is the whole reason the case above can pass: it holds
    // the numbers four engine classes used to define, and it holds them without
    // reaching for any of them. One value import here puts the match back on
    // the menu, silently.
    expect(valueImports('tuningDefaults.ts')).toEqual([]);
  });
});
