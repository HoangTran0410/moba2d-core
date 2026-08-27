/**
 * The host's side of the LAN lobby, and the handover that must not lose anyone.
 *
 * Reported: a client joins a room and the host sees nothing at all — a code on
 * screen with no way to tell whether the room was empty or full, so "wait for
 * everyone, then start" was done by shouting across the table. The cause was
 * that the host did not connect to the broker until Vào trận, so there was
 * nobody to notice a joiner.
 *
 * Opening the wire at Tạo phòng fixes the visibility and creates a sharper
 * problem in its place, which is most of what this file checks:
 * `HostSession` builds a champion for a client **only** when it sees that
 * client's `joined` event, and by the time the match starts those events have
 * already been delivered to the lobby. `setImmediate` replaces the handler and
 * replays nothing, so a plain handover would start the match believing the room
 * was empty while every waiting client sat on a channel nobody answered —
 * strictly worse than the bug being fixed. `HeldHostTransport` replays the
 * room on subscription; that replay is the assertion that matters here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostFrameEvent, HostTransport } from '../../../src/game/net/transport';
import type { NetUrlRequest } from '../../../src/game/net/netRole';

class FakeHostTransport implements HostTransport {
  private handler: ((event: HostFrameEvent) => void) | null = null;
  private queue: HostFrameEvent[] = [];
  readonly broadcasts: string[] = [];
  readonly addressed: { peerId: string; raw: string }[] = [];
  closed = false;

  /** The wire delivering something, whether or not anyone is listening yet. */
  arrive(event: HostFrameEvent): void {
    if (this.handler) this.handler(event);
    else this.queue.push(event);
  }

  setImmediate(handler: (event: HostFrameEvent) => void): void {
    this.handler = handler;
  }
  drain(): HostFrameEvent[] {
    return this.queue.splice(0);
  }
  sendTo(peerId: string, raw: string): void {
    this.addressed.push({ peerId, raw });
  }
  broadcast(raw: string): void {
    this.broadcasts.push(raw);
  }
  broadcastUnreliable(raw: string): void {
    this.broadcasts.push(raw);
  }
  close(): void {
    this.closed = true;
  }
}

let inner: FakeHostTransport;
const rtcCalls: { server: string; room: string; name: string }[] = [];
const relayCalls: { server: string; room: string; name: string }[] = [];

vi.mock('../../../src/game/net/RtcTransport', () => ({
  RtcHostTransport: {
    connect: (server: string, room: string, name: string) => {
      rtcCalls.push({ server, room, name });
      return Promise.resolve(inner);
    },
  },
}));

vi.mock('../../../src/game/net/transport', () => ({
  RelayHostTransport: {
    connect: (server: string, room: string, name: string) => {
      relayCalls.push({ server, room, name });
      return Promise.resolve(inner);
    },
  },
}));

// The real one reads `localStorage` through `PregameConfig`; the name is not
// what this file is about.
vi.mock('../../../src/game/net/lobbyName', () => ({ lobbyDisplayName: () => 'Ashe' }));

const { openRoom, takeHostedTransport, closeRoom } =
  await import('../../../src/game/net/lobbyHost');

const request = (over: Partial<NetUrlRequest> = {}): NetUrlRequest => ({
  mode: 'host',
  server: 'wss://broker',
  room: 'K7QP2',
  transport: 'rtc',
  ...over,
});

const iam = (name: string) => JSON.stringify({ t: 'iam', name });
const lastBroadcast = () => JSON.parse(inner.broadcasts[inner.broadcasts.length - 1]);

let seen: string[][];

beforeEach(() => {
  rtcCalls.length = 0;
  relayCalls.length = 0;
  inner = new FakeHostTransport();
  seen = [];
  closeRoom();
});

afterEach(() => closeRoom());

const open = () => openRoom(request(), list => seen.push(list.map(player => player.name)));

describe('the host holding its room open', () => {
  it('lists itself the moment the room opens', async () => {
    const room = await open();

    expect(rtcCalls).toEqual([{ server: 'wss://broker', room: 'K7QP2', name: 'Trận của Ashe' }]);
    expect(room.players()).toEqual([{ id: 'host', name: 'Ashe', host: true }]);
    expect(seen).toEqual([['Ashe']]);
    // Nothing to broadcast to: an empty room needs no message.
    expect(inner.broadcasts).toEqual([]);
  });

  it('shows a joiner, names it when it announces, and tells everyone', async () => {
    const room = await open();

    inner.arrive({ kind: 'joined', peerId: 'c1' });
    expect(room.players().map(p => p.name)).toEqual(['Ashe', 'Đang vào…']);

    inner.arrive({ kind: 'frame', peerId: 'c1', raw: iam('Ngẫu nhiên') });

    expect(room.players()).toEqual([
      { id: 'host', name: 'Ashe', host: true },
      { id: 'c1', name: 'Ngẫu nhiên' },
    ]);
    expect(seen[seen.length - 1]).toEqual(['Ashe', 'Ngẫu nhiên']);
    // And the same list goes out, so the client's screen matches the host's.
    expect(lastBroadcast()).toEqual({
      t: 'lobby',
      players: [
        { id: 'host', name: 'Ashe', host: true },
        { id: 'c1', name: 'Ngẫu nhiên' },
      ],
    });
  });

  it('drops a joiner that leaves', async () => {
    const room = await open();
    inner.arrive({ kind: 'joined', peerId: 'c1' });
    inner.arrive({ kind: 'frame', peerId: 'c1', raw: iam('Ngẫu nhiên') });

    inner.arrive({ kind: 'left', peerId: 'c1' });

    expect(room.players()).toEqual([{ id: 'host', name: 'Ashe', host: true }]);
  });

  it('picks up anything the transport queued before it subscribed', async () => {
    // `connect` resolves, a peer lands, and only then does `openRoom` install
    // its handler — the window `RtcHostTransport.connect` documents for its own
    // socket drain.
    inner.arrive({ kind: 'joined', peerId: 'early' });
    const room = await open();

    expect(room.players().map(p => p.id)).toEqual(['host', 'early']);
  });

  // ------------------------------------------------------------- handover

  it('replays one joined per waiting peer when the match subscribes', async () => {
    await open();
    inner.arrive({ kind: 'joined', peerId: 'c1' });
    inner.arrive({ kind: 'frame', peerId: 'c1', raw: iam('A') });
    inner.arrive({ kind: 'joined', peerId: 'c2' });
    inner.arrive({ kind: 'frame', peerId: 'c2', raw: iam('B') });

    const held = takeHostedTransport(request());
    expect(held).not.toBeNull();

    const delivered: HostFrameEvent[] = [];
    held!.setImmediate(event => delivered.push(event));

    // Exactly the two, exactly once each: `joined` is the only thing that
    // makes `HostSession` build a champion for a client, so a missing one is a
    // player who joined a match that never gave them a body, and a duplicate
    // is two bodies for one player.
    expect(delivered).toEqual([
      { kind: 'joined', peerId: 'c1' },
      { kind: 'joined', peerId: 'c2' },
    ]);
  });

  it('does not replay a peer that left before the match started', async () => {
    await open();
    inner.arrive({ kind: 'joined', peerId: 'c1' });
    inner.arrive({ kind: 'joined', peerId: 'c2' });
    inner.arrive({ kind: 'left', peerId: 'c1' });

    const delivered: HostFrameEvent[] = [];
    takeHostedTransport(request())!.setImmediate(event => delivered.push(event));

    expect(delivered).toEqual([{ kind: 'joined', peerId: 'c2' }]);
  });

  it('keeps passing events through after the handover', async () => {
    await open();
    const held = takeHostedTransport(request())!;
    const delivered: HostFrameEvent[] = [];
    held.setImmediate(event => delivered.push(event));

    inner.arrive({ kind: 'joined', peerId: 'late' });
    inner.arrive({ kind: 'frame', peerId: 'late', raw: '{"t":"move","x":1,"y":2}' });

    expect(delivered).toEqual([
      { kind: 'joined', peerId: 'late' },
      { kind: 'frame', peerId: 'late', raw: '{"t":"move","x":1,"y":2}' },
    ]);
    // And it is still the same wire underneath.
    held.broadcast('x');
    expect(inner.broadcasts[inner.broadcasts.length - 1]).toBe('x');
  });

  it('hands the room over once, and only to the room it was opened for', async () => {
    await open();

    expect(takeHostedTransport(request({ room: 'OTHER' }))).toBeNull();
    expect(takeHostedTransport(request({ transport: 'ws' }))).toBeNull();
    expect(takeHostedTransport(request())).not.toBeNull();
    expect(takeHostedTransport(request()), 'the same room was taken twice').toBeNull();
  });

  it('closes the wire when the host gives the room up', async () => {
    const room = await open();
    inner.arrive({ kind: 'joined', peerId: 'c1' });

    room.close();

    expect(inner.closed).toBe(true);
    expect(takeHostedTransport(request())).toBeNull();
  });

  it('uses the relay when the URL asked for it', async () => {
    await openRoom(request({ transport: 'ws' }), () => {});
    expect(relayCalls).toHaveLength(1);
    expect(rtcCalls).toHaveLength(0);
  });
});
