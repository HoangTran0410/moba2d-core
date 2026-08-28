import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carryRenamedStorage } from '@/managers/storageRename';

/**
 * The rename's one irreversible edge.
 *
 * Renaming a `localStorage` prefix is not a refactor a type checker can grade:
 * every test passes, the build ships, and the failure lands entirely on people
 * who already played — an empty pack list, no saved kits, default match
 * settings, and their real data still in the browser under a name nothing
 * reads. The pack list is the one that bites hardest, because
 * `installRuntimePacks()` treats empty as *never seeded* and offers the
 * default pack again.
 *
 * So the carry gets tests, and they are about the ways it could be subtly
 * wrong — clobbering newer data, taking keys that were never ours, throwing in
 * a browser with storage off — rather than the one way it is obviously right.
 */
const fakeStorage = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    _map: map,
  };
};

describe('carrying saved data across the project rename', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('moves every key that was ours, without being told their names', () => {
    const storage = fakeStorage({
      'lol2d:packs:v1': '[{"manifestUrl":"https://example.test/pack.json"}]',
      'lol2d:savedKits:v1': '[{"name":"Tự Ghép Chiêu"}]',
      'lol2d:pregameConfig:v1': '{"ai":{"count":3}}',
    });
    vi.stubGlobal('localStorage', storage);

    carryRenamedStorage();

    expect(storage.getItem('moba2d:packs:v1')).toBe(
      '[{"manifestUrl":"https://example.test/pack.json"}]'
    );
    expect(storage.getItem('moba2d:savedKits:v1')).toBe('[{"name":"Tự Ghép Chiêu"}]');
    expect(storage.getItem('moba2d:pregameConfig:v1')).toBe('{"ai":{"count":3}}');
  });

  /**
   * A player who has already played a renamed build has newer data under the
   * new key. The old one is a fossil, and copying it over the top would silently
   * undo whatever they have done since — installing a pack, saving a kit.
   */
  it('never overwrites data the renamed build already wrote', () => {
    const storage = fakeStorage({
      'lol2d:packs:v1': '["the old one"]',
      'moba2d:packs:v1': '["what they have now"]',
    });
    vi.stubGlobal('localStorage', storage);

    carryRenamedStorage();

    expect(storage.getItem('moba2d:packs:v1')).toBe('["what they have now"]');
  });

  /** Somebody else's key that merely starts with a letter we like. */
  it('leaves keys that were never ours alone', () => {
    const storage = fakeStorage({ 'lol2dsomethingelse': 'x', 'other:thing': 'y' });
    vi.stubGlobal('localStorage', storage);

    carryRenamedStorage();

    expect([...storage._map.keys()].sort()).toEqual(['lol2dsomethingelse', 'other:thing']);
  });

  it('boots anyway in a browser that refuses storage', () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new Error('storage blocked');
      },
    });

    expect(() => carryRenamedStorage()).not.toThrow();
  });
});
