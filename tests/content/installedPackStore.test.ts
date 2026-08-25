import { describe, it, expect, beforeEach } from 'vitest';
import {
  readInstalledPacks,
  writeInstalledPacks,
  hasSeededDefaultPack,
  markDefaultPackSeeded,
  PACK_STORE_KEY,
  PACK_SEEDED_KEY,
} from '@/content/installedPackStore';

/**
 * The suite runs on `environment: 'node'`, so there is no localStorage
 * unless a test makes one. That is also the state a real player can be in —
 * storage disabled — and the store has to survive it rather than throw
 * during boot.
 */
const withStorage = () => {
  const map = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
};

describe('installedPackStore', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('answers an empty list when nothing is stored', () => {
    withStorage();
    expect(readInstalledPacks()).toEqual([]);
  });

  it('answers an empty list when localStorage is absent entirely', () => {
    expect(readInstalledPacks()).toEqual([]);
  });

  it('round-trips a record', () => {
    withStorage();
    const records = [{ manifestUrl: 'https://h/p/manifest.json', id: 'riot', version: '1.0.0' }];
    writeInstalledPacks(records);
    expect(readInstalledPacks()).toEqual(records);
  });

  it('drops entries that are not shaped like a record rather than throwing', () => {
    const map = withStorage();
    map.set(
      PACK_STORE_KEY,
      JSON.stringify([
        { manifestUrl: 'https://h/a/manifest.json', id: 'a', version: '1.0.0' },
        { manifestUrl: 42 },
        null,
        'nonsense',
        { id: 'no-url', version: '1.0.0' },
      ])
    );
    expect(readInstalledPacks()).toEqual([
      { manifestUrl: 'https://h/a/manifest.json', id: 'a', version: '1.0.0' },
    ]);
  });

  /**
   * The denominator, and the only part of it that has to survive a reload.
   *
   * The live prefetch record (`packCache.ts`) dies with the page — which is
   * correct, because the download dies with it too — but the packs screen
   * builds its rows out of this store alone and never re-fetches a manifest to
   * list what is installed. Without the count stored beside the name and the
   * icon, a row whose prefetch is not running this session can only show a
   * bare numerator, which is the bug this whole change is about.
   */
  it('round-trips the declared file count', () => {
    withStorage();
    const records = [
      { manifestUrl: 'https://h/p/manifest.json', id: 'riot', version: '1.0.0', fileCount: 592 },
    ];
    writeInstalledPacks(records);
    expect(readInstalledPacks()).toEqual(records);
  });

  it('keeps a declared count of zero, which is not the same as no count at all', () => {
    // A manifest with an empty `files` list saves nothing and can say so; a
    // record written before this field existed cannot, and must fall back.
    withStorage();
    writeInstalledPacks([
      { manifestUrl: 'https://h/p/manifest.json', id: 'p', version: '1.0.0', fileCount: 0 },
    ]);
    expect(readInstalledPacks()[0].fileCount).toBe(0);
  });

  it('drops a file count that is not a sane number', () => {
    const map = withStorage();
    // `1e999` is valid JSON and parses to Infinity — the one bad number
    // that survives `JSON.parse` and would survive a bare `typeof` check.
    for (const bad of ['"592"', '-1', 'null', '1e999', '1.5', 'true']) {
      map.set(
        PACK_STORE_KEY,
        `[{"manifestUrl":"https://h/p/manifest.json","id":"p","version":"1.0.0","fileCount":${bad}}]`
      );
      expect(readInstalledPacks()[0].fileCount, `accepted ${bad}`).toBeUndefined();
    }
  });

  it('answers an empty list for a stored blob that is not even JSON', () => {
    const map = withStorage();
    map.set(PACK_STORE_KEY, '{not json');
    expect(readInstalledPacks()).toEqual([]);
  });

  it('never throws out of writeInstalledPacks when storage refuses', () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(() => writeInstalledPacks([])).not.toThrow();
  });

  it('answers an empty list for stored JSON that is not an array', () => {
    const map = withStorage();
    for (const blob of [
      '{"manifestUrl":"https://h/p/manifest.json"}',
      '"a string"',
      '42',
      'null',
      'true',
    ]) {
      map.set(PACK_STORE_KEY, blob);
      expect(readInstalledPacks()).toEqual([]);
    }
  });

  it('hasSeededDefaultPack answers false when nothing is stored', () => {
    withStorage();
    expect(hasSeededDefaultPack()).toBe(false);
  });

  it('hasSeededDefaultPack answers false when localStorage is absent entirely', () => {
    expect(hasSeededDefaultPack()).toBe(false);
  });

  it('markDefaultPackSeeded makes hasSeededDefaultPack answer true', () => {
    withStorage();
    expect(hasSeededDefaultPack()).toBe(false);
    markDefaultPackSeeded();
    expect(hasSeededDefaultPack()).toBe(true);
  });

  it('hasSeededDefaultPack answers false for any stored value other than the marker', () => {
    const map = withStorage();
    for (const blob of ['0', 'true', 'yes', '']) {
      map.set(PACK_SEEDED_KEY, blob);
      expect(hasSeededDefaultPack()).toBe(false);
    }
  });

  it('never throws out of markDefaultPackSeeded when storage refuses', () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(() => markDefaultPackSeeded()).not.toThrow();
  });

  it('hasSeededDefaultPack never throws when storage itself throws on read', () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(() => hasSeededDefaultPack()).not.toThrow();
    expect(hasSeededDefaultPack()).toBe(false);
  });
});

/**
 * Which build is pinned — the field that makes "this pack is out of date"
 * answerable at all.
 *
 * `version` was already there for this, carrying a comment that said "so an
 * update can be noticed later", and it could never work: it is a number a
 * human has to remember to bump, and riot's stayed `1.0.0` across dozens of
 * publishes. `buildId` is derived by the pack's own manifest writer from its
 * file list, so it moves whether anyone remembers or not.
 */
describe('buildId', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('round-trips', () => {
    withStorage();
    writeInstalledPacks([
      { manifestUrl: 'https://h/p/manifest.json', id: 'riot', version: '1.0.0', buildId: 'abc123' },
    ]);
    expect(readInstalledPacks()[0].buildId).toBe('abc123');
  });

  /** Same defensive read as `name` and `icon`: this value is hand-editable. */
  it('is dropped when it is not a non-empty string', () => {
    const map = withStorage();
    map.set(
      PACK_STORE_KEY,
      JSON.stringify([
        { manifestUrl: 'https://h/p/manifest.json', id: 'riot', version: '1.0.0', buildId: 7 },
      ])
    );
    expect(readInstalledPacks()[0].buildId).toBeUndefined();
  });

  /**
   * A record written before pinning existed has none, and must still load.
   * Core reads its absence as "not pinned", falls back to the network, and
   * pins on the way through — so the upgrade costs one fetch, once.
   */
  it('is absent, not invalid, for a record from before it existed', () => {
    const map = withStorage();
    map.set(
      PACK_STORE_KEY,
      JSON.stringify([{ manifestUrl: 'https://h/p/manifest.json', id: 'riot', version: '1.0.0' }])
    );
    expect(readInstalledPacks()).toHaveLength(1);
    expect(readInstalledPacks()[0].buildId).toBeUndefined();
  });
});
