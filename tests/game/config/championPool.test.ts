import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAMPION_POOL_KEY,
  EMPTY_POOL,
  packInPool,
  poolOf,
  readChampionPool,
  setPackInPool,
  writeChampionPool,
} from '../../../src/game/config/championPool';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('the champion pool store', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is every pack when nothing was stored, or when the blob is garbage', () => {
    expect(readChampionPool()).toEqual(EMPTY_POOL);
    storage.setItem(CHAMPION_POOL_KEY, '{not json');
    expect(readChampionPool()).toEqual(EMPTY_POOL);
    storage.setItem(CHAMPION_POOL_KEY, JSON.stringify({ disabledPacks: 'lol' }));
    expect(readChampionPool()).toEqual(EMPTY_POOL);
  });

  it('keeps only real, distinct pack ids', () => {
    storage.setItem(CHAMPION_POOL_KEY, JSON.stringify({ disabledPacks: ['lol', 3, '', 'lol', 'dota'] }));
    expect(readChampionPool().disabledPacks).toEqual(['lol', 'dota']);
  });

  it('switches a pack out and back in, persisted', () => {
    expect(setPackInPool('naruto', false).disabledPacks).toEqual(['naruto']);
    expect(readChampionPool().disabledPacks).toEqual(['naruto']);
    expect(packInPool(readChampionPool(), 'naruto')).toBe(false);
    expect(packInPool(readChampionPool(), 'lol')).toBe(true);
    expect(setPackInPool('naruto', true).disabledPacks).toEqual([]);
    expect(readChampionPool()).toEqual({ disabledPacks: [] });
  });

  it('survives storage that throws — private mode, a full quota', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('nope');
      },
      setItem() {
        throw new Error('nope');
      },
    });
    expect(readChampionPool()).toEqual(EMPTY_POOL);
    expect(() => writeChampionPool({ disabledPacks: ['lol'] })).not.toThrow();
  });
});

describe('poolOf', () => {
  const kits = [
    { name: 'Ahri', packId: 'lol' },
    { name: 'Zed', packId: 'lol' },
    { name: 'Pudge', packId: 'dota' },
    { name: 'Naruto', packId: 'naruto' },
  ];

  it('is every kit when nothing is disabled — the same array, no copy', () => {
    expect(poolOf(kits, [])).toBe(kits);
  });

  it('drops the disabled packs’ kits', () => {
    expect(poolOf(kits, ['lol']).map(k => k.name)).toEqual(['Pudge', 'Naruto']);
    expect(poolOf(kits, ['lol', 'naruto']).map(k => k.name)).toEqual(['Pudge']);
  });

  it('never comes back empty: with every pack disabled, the roll is from all of them', () => {
    expect(poolOf(kits, ['lol', 'dota', 'naruto']).map(k => k.name)).toEqual(['Ahri', 'Zed', 'Pudge', 'Naruto']);
    expect(poolOf(kits, ['a-pack-nobody-has'])).toHaveLength(4);
    expect(poolOf([], ['lol'])).toEqual([]);
  });
});
