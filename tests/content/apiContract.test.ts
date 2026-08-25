import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { buildContentApi } from '../../src/content/ContentApi';

/**
 * `ContentApi`'s shape is versioned, and the version is core's minor.
 *
 * A pack's manifest declares `coreRange`, core checks it at install time
 * (`satisfiesCoreRange`), and a player is refused a pack their core is too old
 * for. That gate was **vacuous**: `__CORE_VERSION__` is core's `package.json`
 * version, which had read `1.0.0` since the first commit and had never moved —
 * `git log -p -- package.json` showed exactly one line ever written for it — so
 * `>=1.0.0` could not fail however far the API drifted. A pack built against a
 * newer core would install onto an older one and break at runtime, in a
 * player's browser, with the pack already published.
 *
 * The number that has to move is a *contract* number, not a release number,
 * and nobody remembers to move it by hand. So it is derived from something a
 * machine can see: the API's own surface, captured here and compared on every
 * run. Change the surface and this test fails until `npm run contract:bump`
 * has recorded both halves together.
 *
 * ## Why an addition bumps it too
 *
 * `coreRange` is a floor — "this pack needs core at least this new". A pack
 * that uses a member added in contract 5 needs core >= 1.5.0, so an *addition*
 * has to be visible in the number or a pack has no floor to name. The
 * conservatism is the point, not a rough edge.
 *
 * What a floor cannot express is the other direction: an old pack declaring
 * `>=1.3.0`, running on core 1.9.0, using a member 1.7.0 deleted. That is not
 * a hole this test can close — it is a promise core makes by not removing
 * things. The number tells a pack when core is too old; nothing tells it when
 * core has moved on without it.
 *
 * ## What counts as the surface
 *
 * Every reachable member path and its kind (`class`, `function`, `object`,
 * `number`, ...), sorted. Plain objects are namespaces and are walked;
 * classes are not, because a pack builds against the constructor `api` hands
 * out, and a method added to `Spell` is reached through `extends`, not
 * through this table. That is a deliberate narrowing: `Spell.prototype` is
 * not part of what this number promises.
 */
const SNAPSHOT = join(__dirname, 'apiSurface.snapshot.json');

/** `class X {}` and `function f() {}` are both `typeof === 'function'`. */
function kindOf(value: unknown): string {
  if (typeof value === 'function') {
    return /^\s*class\s/.test(Function.prototype.toString.call(value)) ? 'class' : 'function';
  }
  if (value === null) return 'null';
  return typeof value;
}

export function apiSurface(): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string, depth: number): void => {
    if (depth > 3 || node === null || typeof node !== 'object') return;
    for (const key of Object.keys(node as object).sort()) {
      const value = (node as Record<string, unknown>)[key];
      const path = prefix ? `${prefix}.${key}` : key;
      out.push(`${path}:${kindOf(value)}`);
      if (kindOf(value) === 'object') walk(value, path, depth + 1);
    }
  };
  walk(buildContentApi(), '', 0);
  return out;
}

interface Snapshot {
  contract: number;
  surface: string[];
}

describe('the ContentApi contract', () => {
  const surface = apiSurface();

  it('matches the recorded surface, or the contract has to move with it', () => {
    // `npm run contract:bump` writes both halves; this is the same writer, so
    // the file can never be produced by a path the check does not exercise.
    if (process.env.MOBA2D_WRITE_API_CONTRACT) {
      const contract = Number(process.env.MOBA2D_WRITE_API_CONTRACT);
      const written: Snapshot = { contract, surface };
      writeFileSync(SNAPSHOT, `${JSON.stringify(written, null, 2)}\n`);
      return;
    }

    const recorded: Snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    const added = surface.filter(entry => !recorded.surface.includes(entry));
    const removed = recorded.surface.filter(entry => !surface.includes(entry));

    expect(
      { added, removed },
      'ContentApi changed shape. Every pack names this surface, and `coreRange` ' +
        'is how a pack says which version of it it needs — run `npm run contract:bump`, ' +
        "which records the new surface and raises core's minor together."
    ).toEqual({ added: [], removed: [] });
  });

  it("is the same number as core's minor version, which is what a pack compares against", () => {
    const recorded: Snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    const version = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')).version;
    const minor = Number(/^\d+\.(\d+)\./.exec(version)?.[1]);

    expect(
      minor,
      `package.json says ${version}, the recorded contract is ${recorded.contract}. ` +
        '`__CORE_VERSION__` is that version string and `satisfiesCoreRange` reads it, so ' +
        'the two drifting apart is the gate going quiet again.'
    ).toBe(recorded.contract);
  });

  it('describes a surface big enough to be the real one', () => {
    // A walker that silently stopped finding things would make both checks
    // above pass against nothing.
    expect(surface.length).toBeGreaterThan(200);
    expect(surface).toContain('Spell:class');
    expect(surface).toContain('buffs.Slow:class');
    expect(surface).toContain('utils.Quadtree:object');
  });
});
