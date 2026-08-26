import { describe, expect, it } from 'vitest';
import { contentsByPack, describeContents } from '@/scenes/packs/packContents';

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
