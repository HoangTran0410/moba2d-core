/**
 * Which ICE servers a peer connection is allowed to use.
 *
 * `RtcTransport.ts` shipped `{ iceServers: [] }` — host candidates only, on
 * the reasoning that one LAN needs no server in the loop. That reasoning has
 * a hole a corporate network falls straight through, and it was reported as
 * *"vào phòng rồi mà không thấy host, host cũng không thấy client"*: two
 * machines that could reach each other perfectly well (a `curl` between them
 * answered) still failed every handshake, because a host candidate is not the
 * machine's address — Chrome replaces it with a random `*.local` name and
 * leaves resolving it to mDNS multicast, which that wifi drops even while it
 * passes ordinary unicast.
 *
 * STUN closed the multicast half and not the rest: on that same network both
 * peers then gathered `srflx` candidates and *still* could not connect,
 * because the NAT hands out a different mapping per destination — nine public
 * addresses measured from one machine. The address STUN reports is good for
 * reaching the STUN server and nothing else, which is the textbook case for a
 * relay. TURN credentials are minted from an account secret that a static page
 * has nowhere to keep, so the **broker** mints them and this module asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iceOverride, resetIceCacheForTests, rtcConfig } from '../../../src/game/net/iceConfig';

const urlsOf = (config: RTCConfiguration | null): string[] =>
  (config?.iceServers ?? []).flatMap(server =>
    typeof server.urls === 'string' ? [server.urls] : [...server.urls]
  );

const TURN: RTCIceServer = {
  urls: ['stun:turn.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478'],
  username: 'minted',
  credential: 'secret',
};

/** The broker answering `GET /ice`, or failing to. */
const brokerOffers = (servers: RTCIceServer[] | null): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      servers === null
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve(servers) } as Response)
    )
  );
};

beforeEach(() => resetIceCacheForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  resetIceCacheForTests();
});

describe('what ?ice= asks for', () => {
  /**
   * `null` is "the URL said nothing", which is not the same as "the URL asked
   * for nothing" — the first sends `rtcConfig` to the broker, the second is
   * `none` and stops there.
   */
  it('answers null when the URL does not mention ICE', () => {
    expect(iceOverride('')).toBeNull();
    expect(iceOverride('?net=join&room=K7QP2')).toBeNull();
  });

  /**
   * The e2e drives two browser contexts on one machine, where loopback host
   * candidates are the whole answer and anything else is delay — and in CI, a
   * dependency on a third party being up. `none` is how that path keeps the
   * behaviour this module changed.
   */
  it('restores host-candidates-only on ?ice=none', () => {
    expect(iceOverride('?ice=none')?.iceServers).toEqual([]);
  });

  it('takes a STUN server verbatim', () => {
    expect(iceOverride('?ice=stun:1.2.3.4:3478')?.iceServers).toEqual([
      { urls: 'stun:1.2.3.4:3478' },
    ]);
  });

  /**
   * TURN carries credentials, and `RTCIceServer` wants them as their own
   * fields rather than inside the URL — so the compact `user:pass@host` form
   * a person can type into an address bar has to be taken apart here.
   */
  it('splits a TURN URL into its credentials', () => {
    expect(iceOverride('?ice=turn:ashe:hunt3r@1.2.3.4:3478')?.iceServers).toEqual([
      { urls: 'turn:1.2.3.4:3478', username: 'ashe', credential: 'hunt3r' },
    ]);
  });

  it('percent-decodes credentials, so a password may contain : and @', () => {
    const [server] = iceOverride('?ice=turn:a%40b:p%3Ass@1.2.3.4:3478')?.iceServers ?? [];
    expect(server).toEqual({ urls: 'turn:1.2.3.4:3478', username: 'a@b', credential: 'p:ss' });
  });

  it('takes several servers, comma separated', () => {
    expect(urlsOf(iceOverride('?ice=stun:1.2.3.4:3478,turn:u:p@5.6.7.8:3478'))).toEqual([
      'stun:1.2.3.4:3478',
      'turn:5.6.7.8:3478',
    ]);
  });

  /**
   * The one way to prove a TURN server is actually carrying the match rather
   * than sitting unused behind a direct path that happened to work.
   */
  it('forces relaying on the `relay` keyword, keeping the servers beside it', () => {
    const config = iceOverride('?ice=relay,turn:u:p@5.6.7.8:3478');
    expect(config?.iceTransportPolicy).toBe('relay');
    expect(urlsOf(config)).toEqual(['turn:5.6.7.8:3478']);
  });

  it('does not force relaying otherwise', () => {
    expect(iceOverride('?ice=stun:1.2.3.4:3478')?.iceTransportPolicy).toBeUndefined();
  });

  /**
   * A typo in a URL parameter must not cost the player their connection: the
   * unusable entry is dropped and whatever else was asked for still stands.
   */
  it('ignores an entry it cannot make sense of rather than failing the join', () => {
    expect(urlsOf(iceOverride('?ice=nonsense,stun:1.2.3.4:3478'))).toEqual(['stun:1.2.3.4:3478']);
  });

  it('still counts as an override when it parses to nothing', () => {
    // Not null — the URL *did* mention ICE, so the broker is not asked; it
    // just asked for something unusable and gets the defaults.
    expect(urlsOf(iceOverride('?ice=nonsense')).length).toBeGreaterThan(0);
    expect(urlsOf(iceOverride('?ice=')).length).toBeGreaterThan(0);
  });
});

describe('the configuration a peer connection is built with', () => {
  it('offers more than host candidates when the broker has nothing to add', async () => {
    brokerOffers([]);
    const urls = urlsOf(await rtcConfig('wss://broker', ''));
    expect(urls.length, 'the default is still host-candidates-only').toBeGreaterThan(0);
    expect(urls.every(url => /^stuns?:/.test(url))).toBe(true);
  });

  /**
   * Gathering asks every server in the list, so the list is a latency budget
   * as much as a redundancy one. Two or three is the working range.
   */
  it('keeps the default list short enough to gather quickly', async () => {
    brokerOffers([]);
    expect(urlsOf(await rtcConfig('wss://broker', '')).length).toBeLessThanOrEqual(3);
  });

  /** The whole point of the third tier: a relay the client could not know about. */
  it('prefers what the broker mints, TURN and all', async () => {
    brokerOffers([TURN]);
    expect((await rtcConfig('wss://broker', '')).iceServers).toEqual([TURN]);
  });

  /**
   * A broker older than the `/ice` route, or one with no TURN key configured,
   * is a normal state — not a reason to refuse the STUN tier and fail joins
   * that would have worked without it.
   */
  it('falls back to STUN when the broker is unreachable', async () => {
    brokerOffers(null);
    expect(urlsOf(await rtcConfig('wss://broker', '')).length).toBeGreaterThan(0);
  });

  it('does not ask the broker at all when the URL overrides ICE', async () => {
    brokerOffers([TURN]);
    expect((await rtcConfig('wss://broker', '?ice=none')).iceServers).toEqual([]);
    expect(fetch, 'an override still paid for a round trip').not.toHaveBeenCalled();
  });

  /**
   * A five-player room builds several peer connections within a few seconds
   * and each one asks. One request serves them all, or every join pays a round
   * trip on its own critical path.
   */
  it('asks once and shares the answer across peers', async () => {
    brokerOffers([TURN]);
    const answers = await Promise.all([
      rtcConfig('wss://broker', ''),
      rtcConfig('wss://broker', ''),
      rtcConfig('wss://broker', ''),
    ]);
    for (const answer of answers) expect(answer.iceServers).toEqual([TURN]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks the broker it was given, at /ice', async () => {
    brokerOffers([TURN]);
    await rtcConfig('wss://moba2d-signal.example.dev', '');
    expect(fetch).toHaveBeenCalledWith('https://moba2d-signal.example.dev/ice');
  });
});
