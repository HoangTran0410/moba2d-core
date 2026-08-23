import { describe, it, expect, beforeEach } from 'vitest';
import {
  readInstalledPacks,
  writeInstalledPacks,
  PACK_STORE_KEY,
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
});
