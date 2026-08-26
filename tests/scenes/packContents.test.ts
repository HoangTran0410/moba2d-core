import { describe, expect, it } from 'vitest';
import {
  contentsByPack,
  describeContents,
  describeDeclaredContents,
} from '@/scenes/packs/packContents';

const registry = (
  champions: { packId: string; playable: boolean }[] = [],
  maps: { packId: string }[] = [],
  items: { packId: string }[] = []
) => ({ champions: () => champions, maps: () => maps, items: () => items });

describe('contentsByPack', () => {
  it('splits one registry into per-pack counts', () => {
    const counts = contentsByPack(
      registry(
        [
          { packId: 'lol', playable: true },
          { packId: 'lol', playable: true },
          { packId: 'reference', playable: true },
        ],
        [{ packId: 'lol' }],
        [{ packId: 'lol' }, { packId: 'lol' }, { packId: 'reference' }]
      )
    );

    expect(counts.get('lol')).toEqual({ champions: 2, maps: 1, items: 2 });
    expect(counts.get('reference')).toEqual({ champions: 1, maps: 0, items: 1 });
  });

  it('counts only champions the pregame screen would offer', () => {
    // A pack's shelves — the bare basic attack, the summoner-spell group —
    // are roster rows with `playable: false`.
    const counts = contentsByPack(
      registry([
        { packId: 'lol', playable: true },
        { packId: 'lol', playable: false },
      ])
    );

    expect(counts.get('lol')?.champions).toBe(1);
  });

  it('has nothing to say about a pack that declared nothing', () => {
    expect(contentsByPack(registry()).get('lol')).toBeUndefined();
  });
});

describe('describeContents', () => {
  it('reads as one line', () => {
    expect(describeContents({ champions: 58, maps: 1, items: 42 })).toBe(
      '58 tướng · 1 map · 42 trang bị'
    );
  });

  it('drops what a pack does not ship rather than printing a zero', () => {
    // "0 tướng · 3 map · 0 trang bị" makes a map pack read as a broken
    // champion pack.
    expect(describeContents({ champions: 0, maps: 3, items: 0 })).toBe('3 map');
  });

  it('says nothing for a pack that contributes nothing, so the row draws no line', () => {
    expect(describeContents({ champions: 0, maps: 0, items: 0 })).toBe('');
    expect(describeContents(undefined)).toBe('');
  });
});

/**
 * The same sentence, from a manifest instead of from the registry.
 *
 * The install confirmation is the one screen that has to describe a pack it
 * has not run — all it holds is the JSON. Sharing the wording with the
 * installed rows is the point: a player reads "58 tướng · 1 map · 42 trang bị"
 * before installing and the identical line afterwards, rather than two
 * phrasings of one fact.
 */
describe('describeDeclaredContents', () => {
  it('reads the three counts a manifest may declare', () => {
    expect(describeDeclaredContents({ champions: 58, maps: 1, items: 42 })).toBe(
      '58 tướng · 1 map · 42 trang bị'
    );
  });

  it('says only what a manifest actually declared', () => {
    // `maps` and `items` were added after packs were already published, so
    // every existing manifest has champions and nothing else. That line must
    // read as it always did, not as "58 tướng · 0 map · 0 trang bị".
    expect(describeDeclaredContents({ champions: 58 })).toBe('58 tướng');
  });

  it('says nothing for a manifest that declared none of them', () => {
    expect(describeDeclaredContents({})).toBe('');
  });
});
