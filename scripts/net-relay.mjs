/**
 * The LAN relay — the one process a v1 net match needs beside two browsers,
 * because a browser cannot listen on a socket (LAN design spec §3; WebRTC
 * with QR signaling is the roadmap's serverless replacement).
 *
 * It knows nothing about the game. Rooms hold one host and any number of
 * joiners:
 *
 *   ws://<this machine>:8790/?room=r1&role=host    (the hosting browser)
 *   ws://<this machine>:8790/?room=r1&role=join    (each client browser)
 *
 * A joiner's frames are wrapped `{"from":<id>,"data":<frame>}` and handed to
 * the host; the host sends `{"to":<id>|"all","data":<frame>}` and the relay
 * unwraps, so joiners only ever see bare payloads. The host additionally
 * hears `{"sys":"joined"|"left","id":<id>}` when a joiner arrives or drops.
 *
 * Run: node scripts/net-relay.mjs [port]   (default 8790, binds 0.0.0.0 so
 * a phone on the same Wi-Fi can reach it — print shows the LAN addresses.)
 */
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';

const port = Number(process.argv[2] ?? process.env.PORT ?? 8790);

/** room -> { host: ws|null, joiners: Map<id, ws> } */
const rooms = new Map();
let nextClientId = 1;

/**
 * `GET /rooms` — the same listing+announce endpoint the Cloudflare broker
 * serves, minus the per-IP directories: this relay *is* one LAN, so one flat
 * list is the correct grouping. `?announce=<code>&name=<n>` lists the
 * caller's room while it keeps polling; an entry the polls stop refreshing
 * falls out in `ANNOUNCE_STALE_MS`, while a room whose host socket is live
 * stays listed as long as the socket does.
 */
const ANNOUNCE_STALE_MS = 15_000;
const announced = new Map(); // code -> { name, ts }

const httpServer = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://relay');
  const cors = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' };
  if (url.pathname !== '/rooms') {
    response.writeHead(404, cors).end('{}');
    return;
  }
  const announce = url.searchParams.get('announce');
  if (announce && announce.length <= 32) {
    announced.set(announce, { name: url.searchParams.get('name') ?? 'LAN game', ts: Date.now() });
  }
  const now = Date.now();
  const listed = new Map();
  for (const [code, entry] of announced) {
    if (now - entry.ts < ANNOUNCE_STALE_MS) {
      listed.set(code, { code, name: entry.name, ageMs: now - entry.ts });
    } else {
      announced.delete(code);
    }
  }
  for (const [code, room] of rooms) {
    if (room.host && room.listed !== false) {
      listed.set(code, { code, name: room.hostName ?? 'LAN game', ageMs: 0 });
    }
  }
  response.writeHead(200, cors).end(JSON.stringify([...listed.values()]));
});

const server = new WebSocketServer({ server: httpServer });
httpServer.listen(port, '0.0.0.0');

const roomOf = name => {
  if (!rooms.has(name)) rooms.set(name, { host: null, joiners: new Map() });
  return rooms.get(name);
};

const send = (socket, payload) => {
  if (socket && socket.readyState === socket.OPEN) socket.send(payload);
};

server.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', 'http://relay');
  const roomName = url.searchParams.get('room') ?? 'r1';
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'join';
  const room = roomOf(roomName);

  if (role === 'host') {
    // Last host wins: a refreshed hosting tab reclaims its room.
    if (room.host) room.host.close();
    room.host = socket;
    room.hostName = url.searchParams.get('name') ?? 'LAN game';
    // Parity with the deployed broker: `listed=0` is a room reachable by code
    // alone, so it never enters the `/rooms` answer.
    room.listed = url.searchParams.get('listed') !== '0';
    console.log(`[relay] host connected to room "${roomName}"`);
    // Joiners who arrived before the host did (the lobby allows it) — replay
    // them, or this host only ever hears about future arrivals.
    for (const id of room.joiners.keys()) send(socket, JSON.stringify({ sys: 'joined', id }));
    socket.on('message', data => {
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof frame?.data !== 'string') return;
      if (frame.to === 'all') {
        for (const joiner of room.joiners.values()) send(joiner, frame.data);
      } else if (typeof frame.to === 'string') {
        send(room.joiners.get(frame.to), frame.data);
      }
    });
    socket.on('close', () => {
      if (room.host === socket) room.host = null;
      console.log(`[relay] host left room "${roomName}"`);
    });
    return;
  }

  const id = `c${nextClientId++}`;
  room.joiners.set(id, socket);
  console.log(`[relay] ${id} joined room "${roomName}"`);
  send(room.host, JSON.stringify({ sys: 'joined', id }));
  socket.on('message', data => {
    send(room.host, JSON.stringify({ from: id, data: data.toString() }));
  });
  socket.on('close', () => {
    room.joiners.delete(id);
    send(room.host, JSON.stringify({ sys: 'left', id }));
    console.log(`[relay] ${id} left room "${roomName}"`);
  });
});

const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter(iface => iface && iface.family === 'IPv4' && !iface.internal)
  .map(iface => iface.address);
console.log(`[relay] listening on port ${port}`);
for (const address of lanAddresses) console.log(`[relay]   ws://${address}:${port}`);
