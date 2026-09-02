import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSession } from '@/game/net/ClientSession';
import { resetNetRoleForTests } from '@/game/net/netRole';
import type Game from '@/game/Game';
import type { ClientTransport } from '@/game/net/transport';
import type { NetMessage } from '@/game/net/protocol';

/**
 * The recall rule on the wire: `hello.rules.recall`. Absent — a host from
 * before the rule existed — means on, the same fallback `toMatchRules` uses.
 */
const hello = (recall?: boolean): Extract<NetMessage, { t: 'hello' }> => ({
  t: 'hello',
  tm: 0,
  mapId: 'm',
  rules: { cooldownMultiplier: 1, manaFree: false, ...(recall === undefined ? {} : { recall }) },
  you: { id: 'u1', team: 'blue', plan: {} },
  roster: [],
});

describe('the recall rule on a LAN client', () => {
  let game: Game;

  const channel = {
    send: () => {},
    drain: () => [],
    pushBack: () => {},
    waitFor: () => new Promise(() => {}),
    close: () => {},
    closed: false,
  } as unknown as ClientTransport;

  beforeEach(() => {
    vi.stubGlobal('window', {});
    game = {
      matchTimeMs: 0,
      matchSeed: 111,
      matchRules: { cooldownMultiplier: 1, manaFree: false, recall: true },
      player: { name: 'me' },
      turrets: [],
      monsters: [],
      net: null,
    } as unknown as Game;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetNetRoleForTests();
  });

  it('takes the host’s recall rule', () => {
    new ClientSession(game, channel, hello(false));
    expect(game.matchRules.recall).toBe(false);
  });

  it('reads an older host that sends no recall field as recall on', () => {
    game.matchRules.recall = false;
    new ClientSession(game, channel, hello());
    expect(game.matchRules.recall).toBe(true);
  });
});
