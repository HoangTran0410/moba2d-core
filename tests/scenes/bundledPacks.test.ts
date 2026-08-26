import { describe, expect, it, vi } from 'vitest';

vi.mock('@/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { bundledPackRows } from '@/scenes/packs/bundledPacks';
import type { PackContents } from '@/scenes/packs/packContents';
import { BUNDLED_PACK_SUMMARIES } from '@/content/install';

const counts = (entries: Record<string, PackContents>) => new Map(Object.entries(entries));

/**
 * What the packs screen says about content that came with the game.
 *
 * The screen used to list only packs installed by URL, and told everyone else
 * "Chưa cài pack nào — game đang chạy với đúng một tướng mặc định" — a
 * sentence that is simply false in every shipped build, where a pack of
 * dozens of champions is compiled in. Listing them is the fix, and these rows
 * are what it lists.
 */
describe('bundledPackRows', () => {
  it('names every pack that came with the build, in install order', () => {
    const rows = bundledPackRows(
      [
        { id: 'lol', version: '1.0.0', linked: false },
        { id: 'reference', version: '1.2.0', linked: false },
      ],
      counts({})
    );

    expect(rows.map(row => row.id)).toEqual(['lol', 'reference']);
    expect(rows[1].version).toBe('1.2.0');
  });

  it('carries each pack its own share of the registry', () => {
    const rows = bundledPackRows(
      [
        { id: 'lol', version: '1.0.0', linked: false },
        { id: 'reference', version: '1.0.0', linked: false },
      ],
      counts({
        lol: { champions: 58, maps: 1, items: 42 },
        reference: { champions: 1, maps: 1, items: 0 },
      })
    );

    expect(rows[0].contents).toBe('58 tướng · 1 map · 42 trang bị');
    expect(rows[1].contents).toBe('1 tướng · 1 map');
  });

  it('marks a linked pack, because it is not the same thing as a shipped one', () => {
    // A player looking at a roster nobody else's copy of the game has should
    // be able to see why from the screen that lists it.
    const rows = bundledPackRows(
      [
        { id: 'lol', version: '1.0.0', linked: true },
        { id: 'reference', version: '1.0.0', linked: false },
      ],
      counts({})
    );

    expect(rows.map(row => row.linked)).toEqual([true, false]);
  });

  /**
   * The same derivation over what this build actually bundles.
   *
   * Everything above runs on hand-written objects, which proves the joining
   * and proves nothing about whether `BUNDLED_PACK_SUMMARIES` has the shape
   * the rule reads — a renamed `version`, a summary list that forgot the
   * reference pack, and every case above stays green while the screen renders
   * `vundefined`. Asserted without naming a pack, so it holds in a core-only
   * checkout and in one with packs linked or compiled in alike.
   */
  it("reads this build's own bundled packs, whatever they are", () => {
    const rows = bundledPackRows(BUNDLED_PACK_SUMMARIES, counts({}));

    // The reference pack is never absent — `install.ts` imports it plainly.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.id, 'a bundled pack with no id').toBeTruthy();
      expect(row.version, `${row.id} has no version to show`).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof row.linked, `${row.id} has no linked answer`).toBe('boolean');
    }
  });
});
