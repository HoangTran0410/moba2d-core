/**
 * lol2d-signal — the LAN signaling broker.
 *
 * Speaks **exactly the protocol of `scripts/net-relay.mjs`** so the browser
 * side needs one signaling client for both worlds:
 *
 *   - connect `wss://…/?room=<code>&role=host|join[&name=…]`
 *   - a joiner's frames reach the host wrapped `{"from":id,"data":frame}`;
 *     the host sends `{"to":id|"all","data":frame}` and joiners receive the
 *     bare frame; the host additionally hears `{"sys":"joined"|"left","id"}`.
 *
 * On top of the relay protocol it adds the one thing the lobby needs:
 * **discovery**. `GET /rooms` answers the open rooms, and each `SignalRoom`
 * registers itself while its host stays connected, heartbeating via a Durable
 * Object alarm and unregistering on host disconnect.
 *
 * ## Why that listing is no longer per-network
 *
 * It used to group by the caller's public IP (`CF-Connecting-IP`): two
 * devices behind one NAT landed on the same `RoomDirectory` and saw each
 * other's rooms, which was as close to "find each other by themselves" as
 * browsers get without mDNS. On a home router that works. On anything larger
 * it does not, and the failure is silent — measured on one corporate network,
 * twenty requests from a *single machine* left through **nine** different
 * public addresses spread across four unrelated /8s, so a room announced on
 * one poll was listed from a different directory on the next and nobody ever
 * saw anybody. Grouping by prefix does not rescue it either at that spread.
 *
 * So there is one directory. A listing is now "rooms that are open", not
 * "rooms near you" — which for a game this size is also the more useful
 * answer, since the alternative to seeing a stranger's room is seeing none.
 * A host that does not want to be found passes `listed=0` and is reachable by
 * code alone.
 *
 * The broker only ever carries the WebRTC handshake (SDP/ICE — a few KB per
 * join) or, for the `transport=ws` fallback, the game stream itself. After a
 * WebRTC handshake completes, traffic is peer-to-peer and this Worker sees
 * nothing.
 *
 * Outside core's `src/`, so core's tsconfig never sees it; wrangler's own
 * esbuild is the only compiler, against the Workers runtime globals.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const HEARTBEAT_MS = 30_000;
/** A room whose host has not heartbeated for this long is gone from listings. */
const STALE_MS = 90_000;
/**
 * An announce-sourced listing's own, much shorter leash. The lobby announces
 * on its 4s `/rooms` poll while the LAN box is open — before any match, or
 * any WebSocket, exists — so a closed tab must fall out of everyone's list in
 * seconds, not in `STALE_MS`. The WS-sourced entries keep the long leash: the
 * room DO heartbeats them every 30s and explicitly unregisters on host
 * disconnect.
 */
const ANNOUNCE_STALE_MS = 15_000;
/**
 * The one directory every room is listed in. A constant rather than a
 * per-caller name is the whole of the change described in this file's header
 * — see it for the measurement that retired `ip:${ip}`.
 */
const DIRECTORY_NAME = 'rooms:global';
/** A listing is something a person reads down, not a database dump. */
const LIST_LIMIT = 50;

/**
 * How long a minted TURN credential stays valid. Comfortably longer than a
 * match, because a credential that expires mid-handshake is a join that fails
 * for a reason nobody can see.
 */
const TURN_TTL_SECONDS = 3600;
/**
 * Minted credentials, cached per isolate and re-minted at half their life.
 *
 * Every peer connection asks, and a five-player room asks several times in a
 * few seconds; without this each one is an API round trip on the critical
 * path of somebody's join. Isolate-local on purpose — it is a cache, and an
 * evicted isolate simply mints again.
 */
let turnCache = null;

const iceServers = async env => {
  // Not configured is a normal state, not a failure: the client falls back to
  // its own STUN list and direct connections keep working. Only the peers who
  // need a relay lose anything.
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return [];
  if (turnCache && turnCache.expiresAt > Date.now()) return turnCache.servers;
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      }
    );
    if (!response.ok) return [];
    const body = await response.json();
    // The API answers with a single `iceServers` object; `flat` keeps this
    // honest if it ever answers with several.
    const servers = body?.iceServers ? [body.iceServers].flat() : [];
    if (servers.length) {
      turnCache = { servers, expiresAt: Date.now() + (TURN_TTL_SECONDS / 2) * 1000 };
    }
    return servers;
  } catch {
    // A minting outage must cost only the relay, never the join.
    return [];
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/rooms') {
      const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(DIRECTORY_NAME));
      // `?announce=<code>&name=<n>`: the caller is *hosting* this room and
      // wants it listed while it polls. Riding the same request as the listing
      // saves the lobby a second timer, and — the bug it fixed — makes a room
      // exist from the moment its code is on screen. The old design registered
      // only from the WebSocket at match start, so a host still sitting in the
      // menu was invisible even to a second tab on the same machine. (The WS
      // registration remains, and is what keeps an in-match room listed for
      // late joiners after the lobby screen has gone.)
      const announce = url.searchParams.get('announce');
      if (announce && announce.length <= 32) {
        await directory
          .fetch('https://directory/register', {
            method: 'POST',
            body: JSON.stringify({
              code: announce,
              name: url.searchParams.get('name') ?? 'LAN game',
              ttlMs: ANNOUNCE_STALE_MS,
            }),
          })
          .catch(() => undefined);
      }
      const listed = await directory.fetch('https://directory/list');
      return new Response(await listed.text(), {
        headers: { 'content-type': 'application/json', ...CORS },
      });
    }

    // The ICE servers a peer connection should use, credentials and all.
    //
    // Only exists because TURN credentials cannot live in the client: they are
    // minted from an account secret, and a static page served off Pages has
    // nowhere to keep one. This Worker already holds secrets and is already
    // the thing both peers talk to, so it is where the minting belongs.
    //
    // Answers `[]` — not an error — when no TURN key is configured, so a
    // deployment without one degrades to the client's own STUN defaults
    // instead of failing every join.
    if (url.pathname === '/ice') {
      return new Response(JSON.stringify(await iceServers(env)), {
        headers: { 'content-type': 'application/json', ...CORS },
      });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const room = url.searchParams.get('room');
      if (!room || room.length > 32) return new Response('bad room', { status: 400 });
      // Nothing to forward any more: the room DO used to need the caller's
      // public IP to pick its directory, and there is one directory now.
      return env.ROOMS.get(env.ROOMS.idFromName(`room:${room}`)).fetch(request);
    }

    return new Response('lol2d signaling broker — GET /rooms, or WebSocket ?room=&role=host|join', {
      headers: CORS,
    });
  },
};

/** One room: the relay protocol over Durable Object WebSockets. */
export class SignalRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.host = null;
    this.joiners = new Map();
    this.nextJoiner = 1;
    this.code = '';
    this.hostName = '';
    /** A `listed=0` host is reachable by code alone — see the file header. */
    this.listed = true;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'join';
    this.code = url.searchParams.get('room') ?? this.code;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (role === 'host') {
      // Last host wins — a refreshed hosting tab reclaims its room.
      if (this.host) this.host.close();
      this.host = server;
      this.hostName = url.searchParams.get('name') ?? 'LAN game';
      this.listed = url.searchParams.get('listed') !== '0';
      server.addEventListener('message', event => this.fromHost(String(event.data)));
      server.addEventListener('close', () => {
        if (this.host === server) {
          this.host = null;
          this.directory('unregister');
        }
      });
      // Joiners who arrived before this host did — the lobby lets a friend
      // press Vào while the host is still in the menu, and a refreshed
      // hosting tab reclaims a room its joiners never left. Without the
      // replay, a host socket only ever hears about *future* arrivals and
      // the early ones sit invisible forever.
      for (const id of this.joiners.keys()) {
        this.safeSend(server, JSON.stringify({ sys: 'joined', id }));
      }
      await this.directory('register');
      await this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    } else {
      const id = `c${this.nextJoiner++}`;
      this.joiners.set(id, server);
      this.toHost(JSON.stringify({ sys: 'joined', id }));
      server.addEventListener('message', event =>
        this.toHost(JSON.stringify({ from: id, data: String(event.data) }))
      );
      server.addEventListener('close', () => {
        this.joiners.delete(id);
        this.toHost(JSON.stringify({ sys: 'left', id }));
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Heartbeat: keep this room listed while the host is connected. */
  async alarm() {
    if (!this.host) return;
    await this.directory('register');
    await this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  fromHost(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof frame?.data !== 'string') return;
    if (frame.to === 'all') {
      for (const joiner of this.joiners.values()) this.safeSend(joiner, frame.data);
    } else if (typeof frame.to === 'string') {
      const joiner = this.joiners.get(frame.to);
      if (joiner) this.safeSend(joiner, frame.data);
    }
  }

  toHost(raw) {
    if (this.host) this.safeSend(this.host, raw);
  }

  safeSend(socket, raw) {
    try {
      socket.send(raw);
    } catch {
      /* peer already gone */
    }
  }

  async directory(action) {
    if (!this.code) return;
    // A private room still unregisters: it may have been public a moment ago,
    // under a host that reclaimed the code with `listed=0`.
    if (action === 'register' && !this.listed) return;
    const directory = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName(DIRECTORY_NAME));
    await directory
      .fetch(`https://directory/${action}`, {
        method: 'POST',
        body: JSON.stringify({ code: this.code, name: this.hostName }),
      })
      .catch(() => undefined);
  }
}

/**
 * One instance per public IP: the rooms visible to a given network. Kept in
 * memory on purpose — a listing is ephemeral by nature, an evicted instance
 * repopulates from the next heartbeat within 30s, and nothing else reads it.
 */
export class RoomDirectory {
  constructor() {
    this.rooms = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/list') {
      const now = Date.now();
      const listed = [...this.rooms.entries()]
        .filter(([, room]) => now - room.ts < (room.ttlMs ?? STALE_MS))
        .map(([code, room]) => ({ code, name: room.name, ageMs: now - room.ts }))
        // Freshest first, then capped: one directory serves everybody now, so
        // the answer needs an order and a bound it did not need per-network.
        .sort((a, b) => a.ageMs - b.ageMs)
        .slice(0, LIST_LIMIT);
      return new Response(JSON.stringify(listed), {
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = await request.json().catch(() => null);
    if (body?.code) {
      if (url.pathname === '/register') {
        // A WS registration (no ttlMs, the long leash) must not be shortened
        // by a menu announce for the same room racing it — keep the longest
        // leash either writer asked for.
        const previous = this.rooms.get(body.code);
        const ttlMs =
          previous && (previous.ttlMs ?? STALE_MS) > (body.ttlMs ?? STALE_MS)
            ? previous.ttlMs
            : body.ttlMs;
        this.rooms.set(body.code, { name: body.name ?? 'LAN game', ts: Date.now(), ttlMs });
      } else if (url.pathname === '/unregister') {
        this.rooms.delete(body.code);
      }
    }
    return new Response('ok');
  }
}
