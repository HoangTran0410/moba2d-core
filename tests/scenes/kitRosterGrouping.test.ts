import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  groupShelvesByPack,
  packShelvesVisible,
  type KitShelf,
  type PackLabel,
} from '../../src/scenes/setup/pregameCatalog';

/**
 * The loadout picker's roster, cut into one section per pack.
 *
 * The roster draws every installed pack's champions into one alphabetical
 * grid, and before these sections nothing on it said where a champion came
 * from. That is the question a player has right after installing a pack
 * ("what did I just get?") and right before removing one ("what am I about to
 * lose?"), and it is the only place either question can be answered — the
 * packs screen knows the packs and not the champions.
 *
 * Grouping is a pure function of the roster it is handed and the labels it is
 * handed, which is why it lives in `pregameCatalog.ts` and not inside
 * `KitRoster.vue`: mounting a component to find out whether two champions from
 * one pack end up under one heading would test the grid as much as the rule.
 */
/** A champion tile: it has a kit, which is exactly what the grid draws. */
const shelf = (name: string, packId: string): KitShelf => ({
  name,
  packId,
  avatar: null,
  entries: [],
  kit: [{ entry: { id: `${packId}:${name}_Q` } as KitShelf['kit'][number]['entry'], slotIndex: 0 }],
  championName: name,
  nonChampionKind: null,
});

/** Đánh Thường / Phép Bổ Trợ: no kit, so the grid hides it and no pack owns it. */
const pinnedShelf = (name: string, packId: string): KitShelf => ({
  ...shelf(name, packId),
  kit: [],
  championName: null,
  nonChampionKind: 'summoner',
});

const labels = new Map<string, PackLabel>([
  ['riot', { id: 'riot', name: 'Liên Minh Huyền Thoại', icon: 'https://packs.example/icon.png' }],
  ['reference', { id: 'reference', name: 'Có sẵn trong game' }],
]);

describe('groupShelvesByPack', () => {
  it('puts every shelf of one pack under one group', () => {
    const { groups } = groupShelvesByPack(
      [shelf('Ahri', 'riot'), shelf('Vera', 'reference'), shelf('Zed', 'riot')],
      labels
    );
    expect(groups.map(group => group.pack.id)).toEqual(['riot', 'reference']);
    expect(groups[0].shelves.map(s => s.name)).toEqual(['Ahri', 'Zed']);
    expect(groups[1].shelves.map(s => s.name)).toEqual(['Vera']);
  });

  it('orders groups by where each pack first appears, not by id or name', () => {
    // 'reference' sorts before 'riot' both alphabetically and by label; the
    // only thing that puts it second is that its first shelf comes second.
    const { groups } = groupShelvesByPack(
      [shelf('Zed', 'riot'), shelf('Vera', 'reference')],
      labels
    );
    expect(groups.map(group => group.pack.id)).toEqual(['riot', 'reference']);
  });

  it('keeps the order the roster was already sorted into, inside a group', () => {
    const { groups } = groupShelvesByPack(
      [shelf('Aatrox', 'riot'), shelf('Ahri', 'riot'), shelf('Zed', 'riot')],
      labels
    );
    expect(groups[0].shelves.map(s => s.name)).toEqual(['Aatrox', 'Ahri', 'Zed']);
  });

  it('keeps the shelves that are not champion tiles out of every pack', () => {
    // Đánh Thường and Phép Bổ Trợ are pinned ahead of the roster and hidden by
    // the grid. Counting them under a pack is what made the first heading read
    // "60 tướng" over 58 visible tiles.
    const { pinned, groups } = groupShelvesByPack(
      [pinnedShelf('Đánh Thường', 'riot'), pinnedShelf('Phép Bổ Trợ', 'riot'), shelf('Ahri', 'riot')],
      labels
    );
    expect(pinned.map(s => s.name)).toEqual(['Đánh Thường', 'Phép Bổ Trợ']);
    expect(groups).toHaveLength(1);
    expect(groups[0].shelves.map(s => s.name)).toEqual(['Ahri']);
  });

  it('does not let a pinned shelf decide which pack leads', () => {
    // The pinned shelf belongs to `riot` and comes first, but the first
    // *champion* is `reference`'s — so `reference` heads the roster.
    const { groups } = groupShelvesByPack(
      [pinnedShelf('Đánh Thường', 'riot'), shelf('Vera', 'reference'), shelf('Ahri', 'riot')],
      labels
    );
    expect(groups.map(group => group.pack.id)).toEqual(['reference', 'riot']);
  });

  it('carries the label through, logo included', () => {
    const { groups } = groupShelvesByPack([shelf('Ahri', 'riot')], labels);
    expect(groups[0].pack.name).toBe('Liên Minh Huyền Thoại');
    expect(groups[0].pack.icon).toBe('https://packs.example/icon.png');
  });

  it('names an unlabelled pack by its own id rather than hiding it', () => {
    const { groups } = groupShelvesByPack([shelf('Nobody', 'mystery')], labels);
    expect(groups).toHaveLength(1);
    expect(groups[0].pack).toEqual({ id: 'mystery', name: 'mystery' });
    expect(groups[0].shelves.map(s => s.name)).toEqual(['Nobody']);
  });

  it('leaves no empty group behind when the search box filtered a pack out', () => {
    // The caller passes the *filtered* roster, so a pack with nothing left
    // must not survive as a bare heading.
    const { groups } = groupShelvesByPack([shelf('Ahri', 'riot')], labels);
    expect(groups.map(group => group.pack.id)).toEqual(['riot']);
  });

  it('is empty for an empty roster', () => {
    expect(groupShelvesByPack([], labels)).toEqual({ pinned: [], groups: [] });
  });
});

/**
 * The fold. With several packs installed the roster used to open as every
 * champion of every pack at once; each pack is now a collapsible section,
 * folded by default, and a live search unfolds everything the filter kept.
 * The rule is pure so it can be pinned without mounting the grid.
 */
describe('packShelvesVisible', () => {
  const none = new Set<string>();

  it('shows everything when a single pack is installed — there are no headings to fold', () => {
    expect(packShelvesVisible('lol', none, false, 1)).toBe(true);
  });

  it('starts folded once there is more than one pack', () => {
    expect(packShelvesVisible('lol', none, false, 2)).toBe(false);
  });

  it('unfolds the pack the player opened, and only that one', () => {
    const expanded = new Set(['lol']);
    expect(packShelvesVisible('lol', expanded, false, 2)).toBe(true);
    expect(packShelvesVisible('dota', expanded, false, 2)).toBe(false);
  });

  it('a live search unfolds every section the filter kept', () => {
    expect(packShelvesVisible('lol', none, true, 2)).toBe(true);
    expect(packShelvesVisible('dota', none, true, 2)).toBe(true);
  });
});

/**
 * Source pins, in the style of `loadoutSearch.test.ts` — nothing here mounts.
 * The rule above only matters if the grid actually consults it, hides with CSS
 * rather than dropping shelves from the DOM (the e2e drives count
 * `.kit-shelf`), and never hides the shelf the parent opened.
 */
describe('the roster grid honours the fold', () => {
  const source = readFileSync(resolve(__dirname, '../../src/scenes/setup/KitRoster.vue'), 'utf8');
  const css = readFileSync(resolve(__dirname, '../../styles/pregame-scene.css'), 'utf8');

  it('consults packShelvesVisible for both the heading state and the rows', () => {
    expect(source).toMatch(/packShelvesVisible\(/);
    expect(source).toMatch(/'pack-collapsed': packId !== null && !packOpen\(packId\)/);
  });

  it('the heading is the fold handle, with its state readable', () => {
    expect(source).toMatch(/kit-pack-heading[\s\S]*?:aria-expanded="packOpen\(heading\.pack\.id\)"/);
  });

  it('hides with CSS and never hides an open shelf', () => {
    expect(css).toMatch(/\.kit-shelf\.pack-collapsed:not\(\.open\)\s*\{\s*display:\s*none/);
  });
});
