import { afterEach, describe, expect, it, vi } from 'vitest';
import { feelHaptic, hapticPattern, vibrate } from '../../../src/game/input/haptics';
import { DEATH_SHAKE_TRAUMA, KILL_SHAKE_TRAUMA } from '../../../src/game/render/hitFeedback';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/**
 * The thumb reads the same trauma number the camera does, and gets three
 * shapes it can tell apart: a pulse scaled to the hit, two taps for a kill,
 * one long shudder for a death. Everything goes through `vibrate`, which is
 * where support and the player's toggle are checked.
 */
describe('hapticPattern', () => {
  it('keeps chip damage off the hand, then scales a single pulse to the bite', () => {
    expect(hapticPattern('hit', 0)).toBeNull();
    expect(hapticPattern('hit', 0.09)).toBeNull();
    expect(hapticPattern('hit', 0.35)).toEqual([30]);
    expect(hapticPattern('hit', DEATH_SHAKE_TRAUMA)).toEqual([60]);
    expect(hapticPattern('hit', 1)).toEqual([60]);
  });

  it('gives a kill two short taps and a death one long shudder', () => {
    const kill = hapticPattern('kill', KILL_SHAKE_TRAUMA)!;
    const death = hapticPattern('death', DEATH_SHAKE_TRAUMA)!;
    expect(kill).toHaveLength(3);
    expect(death).toHaveLength(3);
    expect(kill[0] + kill[2]).toBeLessThan(death[0]);
    expect(death[2]).toBeGreaterThan(death[0]);
  });
});

describe('vibrate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is silent where the device cannot buzz', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
    expect(() => vibrate(10)).not.toThrow();
  });

  it('buzzes by default, a number as a number and a pattern as an array', () => {
    const buzz = vi.fn();
    vi.stubGlobal('navigator', { vibrate: buzz });
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
    vibrate(10);
    feelHaptic('kill', KILL_SHAKE_TRAUMA);
    expect(buzz).toHaveBeenNthCalledWith(1, 10);
    expect(buzz).toHaveBeenNthCalledWith(2, [15, 40, 15]);
  });

  it('respects the stored toggle', () => {
    const buzz = vi.fn();
    const storage = new MemoryStorage();
    storage.setItem('moba2d.haptics', 'off');
    vi.stubGlobal('navigator', { vibrate: buzz });
    vi.stubGlobal('window', { localStorage: storage });
    vibrate(10);
    feelHaptic('death', DEATH_SHAKE_TRAUMA);
    expect(buzz).not.toHaveBeenCalled();
  });

  it('drops a hit below the haptic floor without touching the device', () => {
    const buzz = vi.fn();
    vi.stubGlobal('navigator', { vibrate: buzz });
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
    feelHaptic('hit', 0.05);
    expect(buzz).not.toHaveBeenCalled();
  });
});
