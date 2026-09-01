import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSession } from '@/game/net/ClientSession';
import { resetNetRoleForTests } from '@/game/net/netRole';
import type Game from '@/game/Game';
import type { ClientTransport } from '@/game/net/transport';
import type { NetMessage } from '@/game/net/protocol';

/**
 * **The seed crosses the wire, and it crosses it early.**
 *
 * A LAN client builds its own jungle rather than receiving one — `ClientSession`
 * matches the two sides "by construction order" — so anything content
 * randomises has to start from a number the *host* chose, or the host's drake
 * and the client's drake are different creatures paying different buffs for the
 * same kill, with nothing in the protocol able to notice.
 *
 * `game/matchSeed.ts` has the reasoning. This is the wiring: what the host puts
 * in the handshake, and that the client takes it before anything can ask the
 * world a question.
 */

const hello = (seed?: number): Extract<NetMessage, { t: 'hello' }> => ({
  t: 'hello',
  tm: 0,
  mapId: 'm',
  rules: { cooldownMultiplier: 1, manaFree: false },
  you: { id: 'u1', team: 'blue', plan: {} },
  roster: [],
  ...(seed === undefined ? {} : { seed }),
});

describe('the match seed on a LAN client', () => {
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
      matchRules: { cooldownMultiplier: 1, manaFree: false },
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

  it('replaces the client’s own seed with the host’s', () => {
    new ClientSession(game, channel, hello(987_654));
    expect(game.matchSeed).toBe(987_654);
  });

  /**
   * `packs` is optional for the same reason and sets the precedent: a host on
   * an older build still hands out a usable hello. A client that gets no seed
   * keeps the one it drew, which is exactly how it behaved before the field
   * existed — so an old host is a stale drake order, never a crash.
   */
  it('keeps its own seed when an older host sends none', () => {
    new ClientSession(game, channel, hello(undefined));
    expect(game.matchSeed).toBe(111);
  });

  it('takes a seed of zero, rather than reading it as absent', () => {
    new ClientSession(game, channel, hello(0));
    expect(game.matchSeed).toBe(0);
  });
});

describe('the match seed a host offers', () => {
  it('is in the handshake the protocol describes', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../../../src/game/net/HostSession.ts', import.meta.url), 'utf8')
    );
    // Comments stripped, or this scan reads the explanation beside the line.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain('seed: this.game.matchSeed');
  });
});
