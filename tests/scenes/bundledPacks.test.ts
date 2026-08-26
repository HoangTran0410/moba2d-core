import { describe, expect, it, vi } from 'vitest';

vi.mock('@/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { bundledPackRows } from '@/scenes/packs/bundledPacks';
import { BUNDLED_PACK_DATA } from '@/content/install';
import type { ContentPackData } from '@/content/ContentPack';

const champion = (id: string, playable: boolean) => ({
  id,
  name: id,
  image: null,
  spells: [],
  playable,
});

const pack = (id: string, version: string, champions: unknown[] = []): ContentPackData =>
  ({
    manifest: { id, version, coreRange: '*' },
    champions,
  }) as unknown as ContentPackData;

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
    const rows = bundledPackRows([pack('lol', '1.0.0'), pack('reference', '1.2.0')]);

    expect(rows.map(row => row.id)).toEqual(['lol', 'reference']);
    expect(rows[1].version).toBe('1.2.0');
  });

  it('counts only champions the pregame screen would actually offer', () => {
    // A roster row is not the same thing as a champion: a pack's own shelves
    // — the bare basic attack, the summoner-spell group — are rows with
    // `playable: false`, and counting them tells a player they have more
    // champions than the game will let them pick.
    const rows = bundledPackRows([
      pack('lol', '1.0.0', [
        champion('Yasuo', true),
        champion('Ahri', true),
        champion('Đánh Thường', false),
      ]),
    ]);

    expect(rows[0].champions).toBe(2);
  });

  it('survives a pack that ships no roster at all', () => {
    const rows = bundledPackRows([pack('maps-only', '1.0.0')]);

    expect(rows[0].champions).toBe(0);
  });

  /**
   * The same derivation over what this build actually bundles.
   *
   * Everything above runs on hand-written objects, which proves the counting
   * rule and proves nothing about whether `BUNDLED_PACK_DATA` has the shape
   * the rule reads — a renamed `manifest.version`, a roster moved off
   * `champions`, and every case above stays green while the screen renders
   * `vundefined`. Asserted without naming a pack, so it holds in a core-only
   * checkout and in one with packs linked or compiled in alike.
   */
  it("reads this build's own bundled packs, whatever they are", () => {
    const rows = bundledPackRows(BUNDLED_PACK_DATA);

    // The reference pack is never absent — `install.ts` imports it plainly.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.id, 'a bundled pack with no id').toBeTruthy();
      expect(row.version, `${row.id} has no version to show`).toMatch(/^\d+\.\d+\.\d+/);
      expect(Number.isInteger(row.champions), `${row.id} champion count is not a number`).toBe(
        true
      );
    }
    // And at least one of them actually offers a champion, or the screen's
    // whole claim ("game đang chạy với nội dung đi kèm ở trên") is empty.
    expect(rows.some(row => row.champions > 0)).toBe(true);
  });
});
