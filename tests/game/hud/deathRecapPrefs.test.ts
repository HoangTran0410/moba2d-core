import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RECAP_COLLAPSED_KEY,
  loadRecapCollapsed,
  saveRecapCollapsed,
} from '../../../src/game/hud/deathRecapPrefs';

/** The collapse toggle's memory — see the module's own header. */
describe('the death recap collapse preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakeStorage = () => {
    const bag = new Map<string, string>();
    return {
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => void bag.set(key, value),
      removeItem: (key: string) => void bag.delete(key),
      bag,
    };
  };

  it('defaults to expanded when nothing is stored', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(loadRecapCollapsed()).toBe(false);
  });

  it('round-trips: collapse survives a reload, expanding clears the key', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);

    saveRecapCollapsed(true);
    expect(loadRecapCollapsed()).toBe(true);
    expect(storage.bag.has(RECAP_COLLAPSED_KEY)).toBe(true);

    saveRecapCollapsed(false);
    expect(loadRecapCollapsed()).toBe(false);
    expect(storage.bag.has(RECAP_COLLAPSED_KEY)).toBe(false);
  });

  it('reads as expanded and swallows the write when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadRecapCollapsed()).toBe(false);
    expect(() => saveRecapCollapsed(true)).not.toThrow();
  });
});
