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
 * On top of the relay protocol it adds the one thing a LAN lobby needs:
 * **discovery by network**. `GET /rooms` answers the open rooms created from
 * the caller's public IP (`CF-Connecting-IP`) — two devices behind the same
 * NAT land on the same `RoomDirectory` instance and therefore see each
 * other's rooms, which is as close to "find each other by themselves" as
 * browsers get without mDNS. Each `SignalRoom` registers itself with its
 * host's IP directory while the host stays connected, heartbeating via a
 * Durable Object alarm and unregistering on host disconnect.
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/rooms') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(`ip:${ip}`));
      // `?announce=<code>&name=<n>`: the caller is *hosting* this room and
      // wants it listed for its network while it polls. Riding the same
      // request as the listing is the point, twice over: the lobby needs no
      // second timer, and — the bug this fixed — registration lands under the
      // *same* IP the listers on this machine/network query. The old design
      // registered only from the WebSocket at match start, so a room whose
      // host was still sitting in the menu did not exist anywhere, and a
      // dual-stack host could register under its IPv6 while a neighbour
      // listed under IPv4. (The WS registration remains, so an in-match room
      // can live in up to two per-family directories at once.)
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

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const room = url.searchParams.get('room');
      if (!room || room.length > 32) return new Response('bad room', { status: 400 });
      // The room DO registers itself with the right per-network directory —
      // it needs the caller's public IP, which only this outer Worker sees.
      const forwarded = new Request(request.url, request);
      forwarded.headers.set('x-lol2d-ip', request.headers.get('CF-Connecting-IP') ?? 'unknown');
      return env.ROOMS.get(env.ROOMS.idFromName(`room:${room}`)).fetch(forwarded);
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
    this.hostIp = '';
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
      this.hostIp = request.headers.get('x-lol2d-ip') ?? 'unknown';
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
    if (!this.code || !this.hostIp) return;
    const directory = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName(`ip:${this.hostIp}`));
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
        .map(([code, room]) => ({ code, name: room.name, ageMs: now - room.ts }));
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
