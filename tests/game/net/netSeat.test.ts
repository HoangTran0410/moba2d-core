import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { netSeat, resetNetSeatForTests } from '@/game/net/netSeat';
import { decodeMessage, encodeMessage } from '@/game/net/protocol';

/**
 * The two halves of "this is the same player as before".
 *
 * A peer id names a *connection*; reconnecting mints a new one, which is why a
 * returning player was handed a second champion while their first went on
 * standing in the match — *"vô phòng lại thì thành lan 2 luôn, lan 1 hồi nãy
 * vẫn sống trong game"*. The seat is the other half, and both ends of it are
 * easy to break silently: a seat that is not stable across loads reclaims
 * nothing, and a seat the decoder drops reclaims nothing either. Neither
 * failure shows up as an error — both just quietly spawn a second champion.
 */
const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
};

describe('the seat that survives a reconnect', () => {
  beforeEach(() => {
    resetNetSeatForTests();
    vi.stubGlobal('localStorage', fakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetNetSeatForTests();
  });

  /**
   * The reconnect *is* a page load — the overlay reloads rather than building
   * a second in-place resync — so a seat held only in memory would be gone at
   * precisely the moment it is needed.
   */
  it('is the same across a page load, which is what a reconnect is', () => {
    const first = netSeat();
    resetNetSeatForTests(); // a fresh page, same browser
    expect(netSeat()).toBe(first);
  });

  it('is not shared between browsers', () => {
    const mine = netSeat();
    resetNetSeatForTests();
    vi.stubGlobal('localStorage', fakeStorage()); // somebody else's machine
    expect(netSeat()).not.toBe(mine);
  });

  /**
   * Private mode throws on the first touch. A player there simply cannot
   * reclaim across a reload — which is what they had before seats existed —
   * rather than failing to join at all.
   */
  it('still answers in a browser that refuses storage', () => {
    vi.stubGlobal('localStorage', {
      getItem(): string {
        throw new Error('blocked');
      },
    });
    expect(netSeat()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the seat on the wire', () => {
  it('survives the encode/decode round trip that every frame makes', () => {
    const decoded = decodeMessage(
      encodeMessage({ t: 'iam', name: 'Hoàng', seat: 'abc123', packs: ['https://p.test/m.json'] })
    );
    expect(decoded).toEqual({
      t: 'iam',
      name: 'Hoàng',
      seat: 'abc123',
      packs: ['https://p.test/m.json'],
    });
  });

  /**
   * A client built before seats existed sends `iam` without one. It must still
   * decode — dropping the frame would cost the lobby its player list, and the
   * host would sit out `SEAT_GRACE_MS` on every join for nothing.
   */
  it('accepts an iam from a client too old to have a seat', () => {
    expect(decodeMessage(encodeMessage({ t: 'iam', name: 'Cũ' }))).toEqual({
      t: 'iam',
      name: 'Cũ',
    });
  });

  /** It is used as a map key on the host; an unbounded string off the wire is not. */
  it('bounds a seat and a pack list arriving from another machine', () => {
    const decoded = decodeMessage(
      JSON.stringify({
        t: 'iam',
        name: 'x',
        seat: 'z'.repeat(500),
        packs: Array.from({ length: 40 }, (_, i) => `https://p.test/${i}.json`),
      })
    );
    expect(decoded).toMatchObject({ t: 'iam' });
    const iam = decoded as { seat: string; packs: string[] };
    expect(iam.seat.length).toBe(64);
    expect(iam.packs.length).toBe(16);
  });

  it('drops a packs field that is not a list of strings', () => {
    const decoded = decodeMessage(JSON.stringify({ t: 'iam', name: 'x', packs: 'not-a-list' }));
    expect(decoded).toEqual({ t: 'iam', name: 'x' });
  });

  /** The host's own liveness beat — the smallest frame either side sends. */
  it('carries a ping', () => {
    expect(decodeMessage(encodeMessage({ t: 'ping' }))).toEqual({ t: 'ping' });
  });
});
