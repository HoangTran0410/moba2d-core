import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkTsFiles } from '../../src/seams/shared';

/**
 * The seam walker's own ground rules, written down after it took a machine
 * out: `readdirSync({ recursive: true })` follows directory symlinks and
 * filters `node_modules` only after reading it, so a linked monorepo —
 * `pack:link` puts `node_modules/@moba2d/core -> ../core` in the pack while
 * core's workspace self-link points back — was an infinite cycle the listing
 * allocated into until the heap died. The walk prunes before it steps.
 */
describe('walkTsFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seam-walk-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists .ts files recursively, relative to the root', () => {
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(root, 'top.ts'), '');
    writeFileSync(join(root, 'nested', 'deep.ts'), '');
    writeFileSync(join(root, 'nested', 'not-code.md'), '');

    expect(walkTsFiles(root)).toEqual(['nested/deep.ts', 'top.ts']);
  });

  it('never steps into node_modules, at any depth', () => {
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    mkdirSync(join(root, 'nested', 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'dep', 'index.ts'), '');
    writeFileSync(join(root, 'nested', 'node_modules', 'index.ts'), '');
    writeFileSync(join(root, 'own.ts'), '');

    expect(walkTsFiles(root)).toEqual(['own.ts']);
  });

  it('terminates on a symlink cycle instead of walking it for ever', () => {
    // the linked-monorepo shape: a directory whose symlink points back above
    // itself, which the old recursive readdir followed until OOM
    mkdirSync(join(root, 'pack'), { recursive: true });
    writeFileSync(join(root, 'pack', 'spell.ts'), '');
    symlinkSync(root, join(root, 'pack', 'loop'));

    expect(walkTsFiles(join(root, 'pack'))).toEqual(['spell.ts']);
  });
});
