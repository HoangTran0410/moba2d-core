/**
 * Which ICE servers a peer connection may use — and why it is no longer none.
 *
 * `RtcTransport.ts` was built with `{ iceServers: [] }`, deliberately: on one
 * LAN, ICE host candidates are a direct socket with no server in the loop, and
 * "internet play needs STUN/TURN" was left to a later roadmap. The hole in
 * that reasoning is that **a host candidate is not the machine's address**.
 * Chrome replaces the local IP with a random `<uuid>.local` name and leaves
 * resolving it to mDNS multicast — so "the two machines can reach each other"
 * and "the two machines can complete an ICE handshake" are different
 * questions, and a corporate wifi answers them differently: it forwards
 * ordinary unicast (proven with a `curl` between the two machines) and drops
 * multicast. With no other candidate type on offer, ICE had nothing to try.
 *
 * ## Three tiers, because each one leaves somebody out
 *
 * 1. **Host candidates** — free, direct, sub-millisecond. Need mDNS.
 * 2. **STUN** (`DEFAULT_ICE_SERVERS`) — free, still direct. A server-reflexive
 *    candidate carries a real address, so it works where multicast does not.
 *    It stops working when the NAT will not hairpin, or hands out a different
 *    mapping per destination: measured on one corporate network, requests from
 *    a single machine left through nine different public addresses, which is
 *    a symmetric NAT saying that the address STUN reported is good for
 *    reaching the STUN server and nothing else. Both peers gathered `srflx`
 *    and neither could use the other's.
 * 3. **TURN** — a relay, so it always works, and it costs somebody bandwidth.
 *    Credentials are minted from an account secret, which a static page has
 *    nowhere to keep, so the **broker mints them**: `GET /ice` on the
 *    signaling Worker answers the full list, TURN included. A broker with no
 *    TURN key configured answers `[]` and tier 2 stands.
 *
 * ## Why it is overridable
 *
 * A default that depends on somebody else's server is fine until the day it
 * is not. `?ice=` is the escape hatch, in the same spirit as `?signal=`, and
 * it wins outright — no broker fetch, no defaults merged in:
 *
 *   - `?ice=none` — host candidates only, this file's own history. The e2e
 *     wants it: two browser contexts on one machine settle on loopback host
 *     candidates, where anything else is delay and, in CI, a dependency on a
 *     third party being reachable.
 *   - `?ice=stun:host:port` — one server, verbatim.
 *   - `?ice=turn:user:pass@host:port` — TURN, credentials split out of the URL
 *     into the fields `RTCIceServer` actually wants. Percent-encode a user or
 *     password containing `:` or `@`.
 *   - `?ice=relay,…` — `iceTransportPolicy: 'relay'`, the only way to prove a
 *     TURN server is carrying the match rather than sitting unused behind a
 *     direct path that happened to work.
 *
 * Entries are comma separated and an unusable one is dropped rather than
 * thrown, because a typo in an address bar must not cost somebody a match.
 */

/**
 * The servers used when nothing overrides them and the broker offers nothing.
 *
 * STUN only, and that is the honest limit of what a default can promise —
 * TURN means somebody's bandwidth and cannot be a hardcoded freeloading
 * default. Two providers rather than one so a single outage is not a dead
 * join, and only two because gathering asks every entry and a slow one holds
 * the handshake.
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

/** `turn:user:pass@host:port` → the shape `RTCPeerConnection` wants. */
const parseEntry = (entry: string): RTCIceServer | null => {
  const scheme = entry.slice(0, entry.indexOf(':'));
  if (scheme !== 'stun' && scheme !== 'stuns' && scheme !== 'turn' && scheme !== 'turns') {
    return null;
  }
  const rest = entry.slice(scheme.length + 1);
  if (!rest) return null;

  // Credentials are optional, and only TURN has anywhere to put them. Split on
  // the *last* `@` so a percent-decoded one in the username cannot confuse it
  // — though anyone encoding properly never gets here with a bare `@`.
  const at = rest.lastIndexOf('@');
  if (at < 0) return { urls: `${scheme}:${rest}` };

  const credentials = rest.slice(0, at);
  const host = rest.slice(at + 1);
  if (!host) return null;
  const colon = credentials.indexOf(':');
  if (colon < 0) return null;
  return {
    urls: `${scheme}:${host}`,
    username: decodeURIComponent(credentials.slice(0, colon)),
    credential: decodeURIComponent(credentials.slice(colon + 1)),
  };
};

/**
 * What `?ice=` asks for, or `null` for "nothing was asked" — which is the
 * difference between a URL that wants silence (`none`) and one that simply
 * does not mention ICE, and therefore wants the broker asked.
 */
export const iceOverride = (search: string = window.location.search): RTCConfiguration | null => {
  const raw = new URLSearchParams(search).get('ice');
  if (raw === null) return null;

  const parts = raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  // Explicit, and not the same as "nothing usable was given": this is the one
  // way back to the behaviour that predates this module.
  if (parts.includes('none')) return { iceServers: [] };

  const relayOnly = parts.includes('relay');
  const servers = parts
    .filter(part => part !== 'relay')
    .map(parseEntry)
    .filter((server): server is RTCIceServer => server !== null);

  // A list that parsed to nothing is a typo, not a request for silence — but
  // it is still an override, so it answers with the defaults rather than
  // falling through to a broker the URL was trying to bypass.
  return {
    iceServers: servers.length ? servers : DEFAULT_ICE_SERVERS,
    ...(relayOnly ? { iceTransportPolicy: 'relay' as const } : {}),
  };
};

/** `wss://broker` → `https://broker/ice`, the way `roomsUrlOf` reaches `/rooms`. */
const iceUrlOf = (signalUrl: string): string =>
  `${signalUrl.replace(/^ws/, 'http').replace(/\/+$/, '')}/ice`;

/**
 * One fetch per broker per session, shared by every peer connection.
 *
 * A five-player room builds several connections within a few seconds and each
 * one asks; without sharing, every join pays an API round trip on its own
 * critical path. The promise is cached rather than its result so simultaneous
 * askers wait on the same request.
 */
let asked: { url: string; servers: Promise<RTCIceServer[]> } | null = null;

const brokerIceServers = (signalUrl: string): Promise<RTCIceServer[]> => {
  if (asked?.url === signalUrl) return asked.servers;
  const servers = (async () => {
    try {
      const response = await fetch(iceUrlOf(signalUrl));
      if (!response.ok) return [];
      const body: unknown = await response.json();
      return Array.isArray(body) ? (body as RTCIceServer[]) : [];
    } catch {
      // A broker with no `/ice` route is every deployment older than this
      // file, and an unreachable one is a network problem the join is about
      // to report anyway. Neither is a reason to refuse the STUN tier.
      return [];
    }
  })();
  asked = { url: signalUrl, servers };
  return servers;
};

/** Forget the cached answer — for tests, and for a change of broker. */
export const resetIceCacheForTests = (): void => {
  asked = null;
};

/**
 * The configuration every `RTCPeerConnection` in this game is built with.
 *
 * Async because tier 3 lives on the broker: TURN credentials are minted from a
 * secret and expire, so they cannot be a constant compiled into a static page.
 * The await costs one round trip per session, shared across peers, and only on
 * the first connection.
 */
export const rtcConfig = async (
  signalUrl: string,
  search: string = window.location.search
): Promise<RTCConfiguration> => {
  const override = iceOverride(search);
  if (override) return override;
  const offered = await brokerIceServers(signalUrl);
  return { iceServers: offered.length ? offered : DEFAULT_ICE_SERVERS };
};
