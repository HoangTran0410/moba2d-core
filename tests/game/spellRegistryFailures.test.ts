/**
 * A module that never arrives and an id nobody declared are not the same
 * thing, and `loadSpells` answered both with silence.
 *
 * The silence is correct for the second. A persisted loadout slot naming a
 * spell this build dropped, or a mid-match re-roll that outran its own chunk,
 * both degrade to `BasicAttack` in `preset.ts` on purpose — neither is worth
 * interrupting a match for.
 *
 * It is wrong for the first, and that is what a player reported: the riot pack
 * was republished under new content hashes, an installed browser still held
 * the previous `pack.js`, the chunk it named 404'd, and Rammus's Q became a
 * basic attack with nothing on screen to say so. The only evidence was a red
 * line in a console the player has no reason to open.
 *
 * Deliberately a file of its own rather than a block inside
 * `spellRegistry.test.ts`: that file imports `packs/riot/spells/index`, so
 * `scripts/pack-dependent-tests.mjs` excludes it from every run in a checkout
 * without the riot pack — which is now every ordinary checkout. A test added
 * there would never have run. Everything here is built from a synthetic pack.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: {
    get: vi.fn((key: string) => ({ key, url: `url:${key}` })),
    getAsset: vi.fn(() => undefined),
    placeholder: vi.fn(() => ({ url: 'x' })),
  },
}));

import { lazy } from '../../src/content/ContentPack';
import { contentRegistry } from '../../src/content/registry';
import {
  isSpellLoaded,
  loadSpells,
  resetSpellRegistryForTests,
} from '../../src/game/spellRegistry';

/** A pack whose one spell resolves, and one whose spell never arrives. */
const install = (id: string, load: () => Promise<unknown>): void => {
  contentRegistry().install({
    manifest: { id, version: '1.0.0', coreRange: '*' },
    spells: { Alpha_Q: lazy(load as never) },
  } as never);
};

describe('loadSpells reports what did not arrive', () => {
  beforeEach(() => {
    resetSpellRegistryForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('names an id whose module rejected', async () => {
    install('brokenpack', () => Promise.reject(new Error('404')));
    const failed = await loadSpells(['brokenpack:Alpha_Q']);
    expect(failed).toEqual(['brokenpack:Alpha_Q']);
  });

  it('stays quiet about an id no pack declared', async () => {
    const failed = await loadSpells(['nosuchpack:Alpha_Q']);
    expect(failed).toEqual([]);
  });

  it('separates the two in one call', async () => {
    install('brokenpack', () => Promise.reject(new Error('404')));
    install('goodpack', () => Promise.resolve(class {}));
    const failed = await loadSpells([
      'brokenpack:Alpha_Q',
      'goodpack:Alpha_Q',
      'nosuchpack:Alpha_Q',
    ]);
    expect(failed).toEqual(['brokenpack:Alpha_Q']);
    expect(isSpellLoaded('goodpack:Alpha_Q')).toBe(true);
  });

  /**
   * The progress bar must still reach its own total. `onSettled` firing once
   * per id whatever happened is what makes it a count rather than a promise
   * that some of them worked, and a bar frozen short of its total on a dropped
   * chunk would be worse than no bar at all.
   */
  it('still settles a failed id, so a progress count can complete', async () => {
    install('brokenpack', () => Promise.reject(new Error('404')));
    const settled: string[] = [];
    await loadSpells(['brokenpack:Alpha_Q', 'nosuchpack:Alpha_Q'], id => settled.push(id));
    expect(settled.sort()).toEqual(['brokenpack:Alpha_Q', 'nosuchpack:Alpha_Q']);
  });
});
