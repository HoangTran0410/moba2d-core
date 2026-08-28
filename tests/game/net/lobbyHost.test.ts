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
import type { HostFrameEvent, HostTransport, PeerLink } from '../../../src/game/net/transport';
import type { NetUrlRequest } from '../../../src/game/net/netRole';

class FakeHostTransport implements HostTransport {
  private handler: ((event: HostFrameEvent) => void) | null = null;
  private linkWatcher: ((peerId: string, link: PeerLink) => void) | null = null;
  private queue: HostFrameEvent[] = [];
  readonly broadcasts: string[] = [];
  readonly addressed: { peerId: string; raw: string }[] = [];
  closed = false;

  /** The wire delivering something, whether or not anyone is listening yet. */
  arrive(event: HostFrameEvent): void {
    if (this.handler) this.handler(event);
    else this.queue.push(event);
  }

  watchPeerLink(handler: (peerId: string, link: PeerLink) => void): void {
    this.linkWatcher = handler;
  }

  /** The wire reporting handshake progress, the way `RtcHostTransport` does. */
  link(peerId: string, link: PeerLink): void {
    this.linkWatcher?.(peerId, link);
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
type HostCall = { server: string; room: string; name: string; listed?: boolean };
const rtcCalls: HostCall[] = [];
const relayCalls: HostCall[] = [];

vi.mock('../../../src/game/net/RtcTransport', () => ({
  RtcHostTransport: {
    connect: (server: string, room: string, name: string, listed?: boolean) => {
      rtcCalls.push({ server, room, name, listed });
      return Promise.resolve(inner);
    },
  },
}));

vi.mock('../../../src/game/net/transport', () => ({
  RelayHostTransport: {
    connect: (server: string, room: string, name: string, listed?: boolean) => {
      relayCalls.push({ server, room, name, listed });
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

    expect(rtcCalls).toEqual([
      { server: 'wss://broker', room: 'K7QP2', name: 'Trận của Ashe', listed: true },
    ]);
    expect(room.players()).toEqual([{ id: 'host', name: 'Ashe', host: true }]);
    expect(seen).toEqual([['Ashe']]);
    // Nothing to broadcast to: an empty room needs no message.
    expect(inner.broadcasts).toEqual([]);
  });

  /**
   * The listing became everybody's, so not being in it had to become a choice.
   *
   * `/rooms` used to group rooms by the host's public IP, which meant "only my
   * network sees my room" came free. It also meant nobody saw anybody on a
   * network that leaves through a pool of addresses — measured at nine of them
   * from one machine — so the grouping went, and with it that accidental
   * privacy. `listed` is the deliberate replacement, and it has to reach the
   * *socket*: the room DO registers itself on the host's connect, so a room
   * kept out of the poll's announce would be advertised by the WebSocket
   * regardless.
   */
  it('advertises the room by default, and keeps a private one off the wire', async () => {
    await openRoom(request(), () => {});
    expect(rtcCalls[0].listed).toBe(true);

    closeRoom();
    rtcCalls.length = 0;
    inner = new FakeHostTransport();

    await openRoom(request(), () => {}, { listed: false });
    expect(rtcCalls[0].listed, 'a private room still told the broker to list it').toBe(false);
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

  /**
   * The room the host could not see, which is the report this whole block is
   * about the second half of.
   *
   * `joined` is emitted by `RtcHostTransport` only when the reliable channel
   * **opens**, and on a network that blocks peer-to-peer it never does: the
   * offer goes out, the answer comes back, ICE finds no route, and the event
   * that would put the joiner on the list is never sent. The host therefore
   * showed an empty room — indistinguishable from nobody having pressed Vào —
   * while a client sat two desks away believing it was in.
   *
   * A room that cannot say "somebody is trying" cannot tell a quiet network
   * from a quiet friend. So the wire reports the handshake itself, and the
   * roster carries it: a peer appears when its offer goes out and is *marked*
   * when the link dies, rather than existing only in the success case.
   */
  it('shows a peer while it is still shaking hands, and marks one whose link dies', async () => {
    const room = await open();

    inner.link('c1', 'connecting');
    expect(room.players()).toEqual([
      { id: 'host', name: 'Ashe', host: true },
      { id: 'c1', name: 'Đang kết nối…', link: 'connecting' },
    ]);

    inner.link('c1', 'failed');
    expect(room.players()[1].link, 'a dead handshake looked the same as a live one').toBe('failed');
    // Still listed: a row that vanishes says "nobody came", which is the
    // lie being fixed.
    expect(room.players()).toHaveLength(2);

    // And it goes when the joiner's own socket does.
    inner.link('c1', 'gone');
    expect(room.players()).toEqual([{ id: 'host', name: 'Ashe', host: true }]);
  });

  it('marks a peer open once its channel carries it, and says nothing more', async () => {
    const room = await open();
    inner.link('c2', 'connecting');

    inner.arrive({ kind: 'joined', peerId: 'c2' });
    inner.arrive({ kind: 'frame', peerId: 'c2', raw: iam('Ngẫu nhiên') });

    // `link` is the exception's field: an ordinary peer carries none, so the
    // list a client is shown stays exactly what it was.
    expect(room.players()).toEqual([
      { id: 'host', name: 'Ashe', host: true },
      { id: 'c2', name: 'Ngẫu nhiên' },
    ]);
    expect(lastBroadcast().players[1].link).toBeUndefined();
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
