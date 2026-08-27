import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSession } from '@/game/net/ClientSession';
import { resetNetRoleForTests } from '@/game/net/netRole';
import type Game from '@/game/Game';
import type { ClientTransport } from '@/game/net/transport';
import type { NetMessage } from '@/game/net/protocol';

/**
 * Shopping from a LAN client.
 *
 * Unlike a cast, a purchase has **no local half**: the intercept answers
 * `true`, so nothing is bought on this end. That is not caution, it is the
 * only correct answer — the gold, the fountain rule and the component maths
 * are the host's, and a client that spent its own copy of a wallet the host
 * never debited would show an item that disappears on the next `bag` event.
 */
describe('a net client using the shop', () => {
  let sent: string[];
  let session: ClientSession;

  const frames = (): NetMessage[] => sent.map(raw => JSON.parse(raw) as NetMessage);

  beforeEach(() => {
    vi.stubGlobal('window', {});
    sent = [];
    const channel = {
      send: (raw: string) => sent.push(raw),
      drain: () => [],
      pushBack: () => {},
      waitFor: () => new Promise(() => {}),
      close: () => {},
      closed: false,
    } as unknown as ClientTransport;
    const game = {
      matchTimeMs: 0,
      matchRules: { cooldownMultiplier: 1, manaFree: false },
      player: { name: 'me' },
      turrets: [],
      monsters: [],
      net: null,
    } as unknown as Game;
    session = new ClientSession(game, channel, {
      t: 'hello',
      tm: 0,
      mapId: 'm',
      rules: { cooldownMultiplier: 1, manaFree: false },
      you: { id: 'u1', team: 'blue', plan: {} },
      roster: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetNetRoleForTests();
  });

  it('sends a buy and refuses the local half', () => {
    expect(session.interceptShop({ kind: 'buy', itemId: 'lol:bf-sword' })).toBe(true);
    expect(frames()).toEqual([{ t: 'buy', itemId: 'lol:bf-sword' }]);
  });

  it('sends a sell and refuses the local half', () => {
    expect(session.interceptShop({ kind: 'sell', slot: 3 })).toBe(true);
    expect(frames()).toEqual([{ t: 'sell', slot: 3 }]);
  });

  it('sends a drag as a swap — the host owns the arrangement too', () => {
    // Not a purchase, but the same rule: the bag the client draws is the one
    // the host last reported, so rearranging it locally is a picture that the
    // next `bag` event contradicts.
    expect(session.interceptShop({ kind: 'swap', a: 0, b: 4 })).toBe(true);
    expect(frames()).toEqual([{ t: 'swap', a: 0, b: 4 }]);
  });

  it('tags an item active with its row, and leaves a kit cast untagged', () => {
    session.interceptCast(1, { x: 5, y: 6 }, 'press', 'item');
    session.interceptCast(1, { x: 5, y: 6 }, 'press');
    session.interceptCastCancel(1, 'item');
    expect(frames()).toEqual([
      { t: 'cast', slot: 1, x: 5, y: 6, row: 'item' },
      { t: 'cast', slot: 1, x: 5, y: 6 },
      { t: 'stop', slot: 1, row: 'item' },
    ]);
  });
});
