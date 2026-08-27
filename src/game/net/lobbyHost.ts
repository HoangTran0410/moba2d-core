import { RelayHostTransport, type HostFrameEvent, type HostTransport } from './transport';
import { RtcHostTransport } from './RtcTransport';
import { decodeMessage, encodeMessage, type LobbyPlayer } from './protocol';
import type { NetUrlRequest } from './netRole';
import { lobbyDisplayName } from './lobbyName';

/**
 * The host's half of the LAN lobby: hold the room open, and know who is in it.
 *
 * Until this existed the host connected to the broker only at Vào trận, which
 * had two consequences a player meets immediately. A friend who joined first
 * had nothing to talk to (see `lobbyJoin.ts` for the timeout that produced),
 * and — the one reported here — **the host could not see that anybody had
 * arrived**. It sat looking at a room code with no way to tell whether the
 * room was empty or full, so "wait for everyone, then start" was a thing you
 * did by shouting across the table.
 *
 * So the transport opens at *Tạo phòng*. From then on the room is real: peers
 * connect, announce themselves with `iam`, and the host broadcasts the whole
 * list back as `lobby` so every screen shows the same people.
 *
 * ## The handover, and the `joined` events it must not lose
 *
 * `HostSession` builds a champion for a client when it sees that client's
 * `joined` event — that is the only trigger. Those events have already
 * happened by the time the match starts, and `setImmediate` replaces the
 * handler rather than replaying anything, so a naive handover would drop
 * every player who was waiting in the lobby: the match would start with an
 * empty room and the clients would sit for ever with a channel nobody answers.
 *
 * `HeldHostTransport` is the fix. It wraps the real transport, is the only
 * thing subscribed to it, and when `HostSession` finally subscribes it
 * **replays one `joined` per peer still present**. `HostSession` needs no
 * knowledge of any of this, and the two real transports need no change at all.
 */

interface Peer {
  id: string;
  name: string;
}

/**
 * The lobby's transport, wearing `HostTransport` so `HostSession` cannot tell
 * the difference — and replaying the room to it on the way in.
 */
class HeldHostTransport implements HostTransport {
  private handler: ((event: HostFrameEvent) => void) | null = null;
  private queue: HostFrameEvent[] = [];

  constructor(
    private readonly inner: HostTransport,
    private readonly peers: Map<string, Peer>,
    private readonly onLobbyChange: () => void
  ) {}

  /**
   * Whether the match has taken the room over.
   *
   * The lobby's own listener stays installed on the real transport for the
   * life of the connection — it is the only subscriber the wrapper has — so
   * this is what tells it to stop *consuming* membership and start passing it
   * through. Without it a player who joins **after** the host presses Vào trận
   * is absorbed into a lobby nobody is looking at any more, and never gets a
   * champion: exactly the "vào sau thì thả thẳng vào trận" case, silently
   * broken by the fix for the case before it.
   */
  get live(): boolean {
    return this.handler !== null;
  }

  /** Everything the lobby saw before this wrapper existed, plus everything after. */
  observe(event: HostFrameEvent): void {
    if (this.handler) {
      this.handler(event);
      return;
    }
    this.queue.push(event);
  }

  setImmediate(handler: (event: HostFrameEvent) => void): void {
    this.handler = handler;
    // The room as it stands. Without this the match starts believing it is
    // alone — see this file's header.
    for (const id of this.peers.keys()) handler({ kind: 'joined', peerId: id });
    for (const event of this.queue.splice(0)) handler(event);
  }

  drain(): HostFrameEvent[] {
    return this.queue.splice(0);
  }

  sendTo(peerId: string, raw: string): void {
    this.inner.sendTo(peerId, raw);
  }

  broadcast(raw: string): void {
    this.inner.broadcast(raw);
  }

  broadcastUnreliable(raw: string): void {
    this.inner.broadcastUnreliable(raw);
  }

  close(): void {
    this.inner.close();
    this.peers.clear();
    this.onLobbyChange();
  }
}

export interface HostedRoom {
  request: NetUrlRequest;
  /** Everyone in the room right now, the host first. */
  players(): LobbyPlayer[];
  close(): void;
}

interface Hosting {
  request: NetUrlRequest;
  transport: HeldHostTransport;
  peers: Map<string, Peer>;
  hostName: string;
}

let hosting: Hosting | null = null;

const sameRoom = (a: NetUrlRequest, b: NetUrlRequest): boolean =>
  a.room === b.room && a.server === b.server && a.transport === b.transport;

const rosterOf = (state: Hosting): LobbyPlayer[] => [
  { id: 'host', name: state.hostName, host: true },
  ...[...state.peers.values()].map(peer => ({ id: peer.id, name: peer.name })),
];

/**
 * Open the room and start listening.
 *
 * `onChange` fires whenever the membership changes, so the lobby screen can
 * re-render; it is called once on open too, so the host's own row appears
 * without waiting for anybody.
 */
export const openRoom = async (
  request: NetUrlRequest,
  onChange: (players: LobbyPlayer[]) => void
): Promise<HostedRoom> => {
  closeRoom();

  const hostName = lobbyDisplayName();
  const peers = new Map<string, Peer>();
  // The same name the room is advertised under in the `/rooms` listing, so a
  // player choosing a room in the list and the players inside it agree.
  const roomName = `Trận của ${hostName}`;
  const inner =
    request.transport === 'ws'
      ? await RelayHostTransport.connect(request.server, request.room, roomName)
      : await RtcHostTransport.connect(request.server, request.room, roomName);

  const state: Hosting = {
    request,
    peers,
    hostName,
    transport: null as unknown as HeldHostTransport,
  };
  const announce = (): void => {
    onChange(rosterOf(state));
    // Everyone sees the same list. Broadcast rather than per-peer: it is at
    // most a handful of names and one message serves every screen.
    if (peers.size)
      state.transport.broadcast(encodeMessage({ t: 'lobby', players: rosterOf(state) }));
  };
  const held = new HeldHostTransport(inner, peers, announce);
  state.transport = held;

  const onEvent = (event: HostFrameEvent): void => {
    // Once the match has the room, everything is the match's — a late joiner's
    // `joined` most of all, because that is what gives them a champion. See
    // `HeldHostTransport.live`.
    if (held.live) {
      held.observe(event);
      return;
    }
    // While the lobby owns the wire it *consumes* membership rather than
    // queueing it: the peer map is the record, and `setImmediate` replays it.
    // Queueing as well would hand `HostSession` two `joined` events per peer.
    if (event.kind === 'joined') {
      if (!peers.has(event.peerId))
        peers.set(event.peerId, { id: event.peerId, name: 'Đang vào…' });
      announce();
      return;
    }
    if (event.kind === 'left') {
      if (peers.delete(event.peerId)) announce();
      return;
    }
    const message = decodeMessage(event.raw);
    if (message?.t === 'iam') {
      const peer = peers.get(event.peerId);
      if (peer) {
        peer.name = message.name;
        announce();
      }
      return;
    }
    // Anything else is not the lobby's business — a frame from a client that
    // has raced ahead. Hold it for the session that will want it.
    held.observe(event);
  };

  inner.setImmediate(onEvent);
  // Anything the transport queued between `connect` and this line.
  for (const event of inner.drain()) onEvent(event);

  hosting = state;
  announce();

  return {
    request,
    players: () => rosterOf(state),
    close: closeRoom,
  };
};

/**
 * The open room's transport, for `HostSession.attach` — taken, so a second
 * call finds nothing and the session that has it keeps it.
 *
 * `null` for a host that never went through the lobby: a hand-typed
 * `?net=host&room=…` straight into Chơi still connects for itself.
 */
export const takeHostedTransport = (request: NetUrlRequest): HostTransport | null => {
  if (!hosting || !sameRoom(hosting.request, request)) return null;
  const transport = hosting.transport;
  hosting = null;
  return transport;
};

/** Give the room up — Huỷ phòng, or leaving the lobby without starting. */
export const closeRoom = (): void => {
  hosting?.transport.close();
  hosting = null;
};
