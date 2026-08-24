import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { packStageLabel } from '@/scenes/packStageLabel';

/**
 * Every failure stage the app can produce has a Vietnamese label.
 *
 * `packStageLabel` is a plain lookup with a pass-through fallback, so a stage
 * nobody translated does not fail anything at runtime — it just prints
 * "shape" to a Vietnamese player, which is the exact bug the table was added
 * to fix, silently reintroduced. A unit test naming today's seven stages
 * would pass forever and never notice the eighth.
 *
 * So the closed class is enforced by scanning `src/` for every stage string
 * any code path can actually emit — the `PackLoadStage` union itself, every
 * `new PackLoadError('…')` argument, and every `stage: '…'` written into an
 * outcome object by hand — and asserting each one is translated. Adding a
 * stage without a label fails here, in milliseconds, rather than in front of
 * a player.
 */
const SRC = join(__dirname, '../../src');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|vue)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The union's own members, read off `packSource.ts` rather than duplicated:
 * `export type PackLoadStage = 'fetch' | 'manifest' | …`.
 */
function unionMembers(): string[] {
  const source = stripComments(readFileSync(join(SRC, 'content/packSource.ts'), 'utf8'));
  const declaration = source.match(/export type PackLoadStage\s*=([^;]+);/);
  expect(declaration, 'packSource.ts no longer declares PackLoadStage').not.toBeNull();
  return [...declaration![1].matchAll(/'([^']+)'/g)].map(match => match[1]);
}

/** Stage strings written as literals anywhere under `src/`. */
function literalStages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const patterns = [/new PackLoadError\(\s*'([^']+)'/g, /\bstage:\s*'([^']+)'/g];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        found.set(match[1], file.slice(SRC.length + 1));
      }
    }
  }
  return found;
}

describe('packStageLabel', () => {
  it('translates every member of the PackLoadStage union', () => {
    const untranslated: string[] = [];
    for (const stage of unionMembers()) {
      if (packStageLabel(stage) === stage) untranslated.push(stage);
    }
    expect(untranslated, 'PackLoadStage members with no Vietnamese label').toEqual([]);
  });

  it('translates every stage string any module under src/ writes by hand', () => {
    const literals = literalStages();
    expect(
      literals.size,
      'the scan found no stage literals at all — its patterns have rotted'
    ).toBeGreaterThan(0);
    const untranslated: string[] = [];
    for (const [stage, file] of literals) {
      if (packStageLabel(stage) === stage) untranslated.push(`${stage} (${file})`);
    }
    expect(untranslated, 'stage strings with no Vietnamese label').toEqual([]);
  });

  it('finds the two stages that are not in the union at all', () => {
    // The point of scanning literals rather than only the union: these two
    // reach the same banner and the same error line without being members.
    const literals = literalStages();
    expect([...literals.keys()]).toEqual(expect.arrayContaining(['registry', 'install']));
  });

  it('hands an unknown stage back unchanged rather than inventing a label', () => {
    expect(packStageLabel('something-nobody-has-written-yet')).toBe(
      'something-nobody-has-written-yet'
    );
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = "throw new PackLoadError('quarantine', 'nope');";
    const seen = [...sample.matchAll(/new PackLoadError\(\s*'([^']+)'/g)].map(m => m[1]);
    expect(seen).toEqual(['quarantine']);
    expect(packStageLabel('quarantine')).toBe('quarantine');
  });
});
