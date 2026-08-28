import {
  RelayHostTransport,
  type HostFrameEvent,
  type HostTransport,
  type PeerLink,
} from './transport';
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
  /**
   * How far this peer got. `open` is the ordinary case and the only one the
   * roster keeps quiet about; the other two exist so a room that nobody can
   * reach stops looking like a room nobody tried to enter — see
   * `transport.ts`'s `PeerLink`.
   */
  link: Exclude<PeerLink, 'gone'>;
}

/** The row a peer gets before it has told us its name. */
const CONNECTING_NAME = 'Đang kết nối…';
const ARRIVING_NAME = 'Đang vào…';

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

  /**
   * Passed straight through, and only when the wire underneath has one — the
   * relay has no frame for closing somebody else's socket, so its joiners are
   * removed by the `kicked` message alone.
   */
  dropPeer(peerId: string): void {
    this.inner.dropPeer?.(peerId);
    this.peers.delete(peerId);
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
  /**
   * Remove one joiner, by the id its row carries.
   *
   * The lobby's own half of a control the *match* already grew
   * (`HostSession.kickUnit`): a host who can see a row must be able to act on
   * it, and until this there was no way to remove anybody from a room at all —
   * not a stranger who wandered in off the public listing, and not the ghost
   * left by a phone that went into a tunnel.
   *
   * Answers whether the id matched, so a stale row cannot be reported as a
   * removal.
   */
  kick(peerId: string): boolean;
  close(): void;
}

interface Hosting {
  request: NetUrlRequest;
  transport: HeldHostTransport;
  peers: Map<string, Peer>;
  hostName: string;
  /**
   * "Membership changed" — the host's own screen *and* every client's, in that
   * order. Held on the state rather than left a closure inside `openRoom`
   * because `kickPeer` below has to reach it: writing out the broadcast half
   * by hand is how a kick came to remove a player from every screen except the
   * one that pressed the button.
   */
  announce: () => void;
}

let hosting: Hosting | null = null;

const sameRoom = (a: NetUrlRequest, b: NetUrlRequest): boolean =>
  a.room === b.room && a.server === b.server && a.transport === b.transport;

/**
 * Throw one joiner out of the room.
 *
 * Told, then dropped, and both halves are needed for different wires. The
 * `kicked` frame is what a *relay* joiner acts on — the relay has no way for
 * one client to close another's socket — and `dropPeer` is what makes an RTC
 * peer's own channel close so it cannot keep talking to a room that has
 * forgotten it. A transport that offers no `dropPeer` still gets the frame,
 * and the peer leaves on its own.
 *
 * The roster is rebroadcast last, so every remaining screen agrees about who
 * is in the room before anything else happens.
 */
const kickPeer = (state: Hosting, peerId: string): boolean => {
  if (!state.peers.has(peerId)) return false;
  try {
    state.transport.sendTo(peerId, encodeMessage({ t: 'kicked' }));
  } catch {
    /* already gone; the drop below is the rest of it */
  }
  state.transport.dropPeer?.(peerId);
  state.peers.delete(peerId);
  // `announce`, not a hand-written broadcast: it is the one place that knows
  // membership has to reach the host's own screen before anyone else's.
  state.announce();
  return true;
};

const rosterOf = (state: Hosting): LobbyPlayer[] => [
  { id: 'host', name: state.hostName, host: true },
  // `link` is the exception's field, so an ordinary peer carries none: the
  // list a client is shown, and every assertion about it, stays what it was.
  ...[...state.peers.values()].map(peer => ({
    id: peer.id,
    name: peer.name,
    ...(peer.link === 'open' ? {} : { link: peer.link }),
  })),
];

/**
 * Open the room and start listening.
 *
 * `onChange` fires whenever the membership changes, so the lobby screen can
 * re-render; it is called once on open too, so the host's own row appears
 * without waiting for anybody.
 */
/** What a host chooses about its room that is not part of the URL's request. */
export interface HostRoomOptions {
  /**
   * Whether the room appears in `GET /rooms`. Default `true`.
   *
   * The listing is one directory for everybody now — grouping it by the host's
   * public IP found nobody on a network that leaves through a pool of
   * addresses — so "only people I tell can join" stopped being a side effect
   * of the grouping and became this.
   */
  listed?: boolean;
}

export const openRoom = async (
  request: NetUrlRequest,
  onChange: (players: LobbyPlayer[]) => void,
  options: HostRoomOptions = {}
): Promise<HostedRoom> => {
  closeRoom();

  const hostName = lobbyDisplayName();
  const peers = new Map<string, Peer>();
  // The same name the room is advertised under in the `/rooms` listing, so a
  // player choosing a room in the list and the players inside it agree.
  const roomName = `Trận của ${hostName}`;
  // Typed as the interface, not the union of the two classes: `watchPeerLink`
  // is optional *on the contract*, and only a union widened to that contract
  // lets the relay simply not have it.
  const listed = options.listed !== false;
  const inner: HostTransport =
    request.transport === 'ws'
      ? await RelayHostTransport.connect(request.server, request.room, roomName, listed)
      : await RtcHostTransport.connect(request.server, request.room, roomName, listed);

  const state: Hosting = {
    request,
    peers,
    hostName,
    transport: null as unknown as HeldHostTransport,
    announce: () => undefined,
  };
  const announce = (): void => {
    onChange(rosterOf(state));
    // Everyone sees the same list. Broadcast rather than per-peer: it is at
    // most a handful of names and one message serves every screen.
    if (peers.size)
      state.transport.broadcast(encodeMessage({ t: 'lobby', players: rosterOf(state) }));
  };
  state.announce = announce;
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
      const known = peers.get(event.peerId);
      if (known) {
        // Already on the list from `watchPeerLink` — the handshake it was
        // showing has now succeeded.
        known.link = 'open';
        if (known.name === CONNECTING_NAME) known.name = ARRIVING_NAME;
      } else {
        peers.set(event.peerId, { id: event.peerId, name: ARRIVING_NAME, link: 'open' });
      }
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

  /**
   * The handshake, which `onEvent` never hears a word about.
   *
   * A peer ICE cannot reach produces no `joined` and no `left` — the two
   * events the room is built out of — so before this the host rendered a
   * blocked network and an empty room identically. These states are the
   * difference, and they stop at the handover: once the match owns the room,
   * membership is the match's business (`HeldHostTransport.live`).
   */
  inner.watchPeerLink?.((peerId, link) => {
    if (held.live) return;
    if (link === 'gone') {
      if (peers.delete(peerId)) announce();
      return;
    }
    // `open` arrives as `joined` too, and that is the branch that owns it —
    // acting here as well would announce the same change twice.
    if (link === 'open') return;
    const peer = peers.get(peerId);
    if (peer) peer.link = link;
    else peers.set(peerId, { id: peerId, name: CONNECTING_NAME, link });
    announce();
  });

  // Anything the transport queued between `connect` and this line.
  for (const event of inner.drain()) onEvent(event);

  hosting = state;
  announce();

  return {
    request,
    players: () => rosterOf(state),
    kick: peerId => kickPeer(state, peerId),
    close: closeRoom,
  };
};

/**
 * Remove a joiner from whatever room this page is hosting.
 *
 * A free function beside `closeRoom` rather than a method on the handle
 * `openRoom` returns, because the caller is `LanScene.vue` and the handle is
 * not what it keeps: the room lives in this module's own `hosting`, and the
 * scene reaches it the same way it reaches `closeRoom` — a dynamic import,
 * which is also what keeps this file out of the menu's chunk.
 *
 * `false` when nothing matched, so a stale row cannot be reported as a
 * removal.
 */
export const kickFromRoom = (peerId: string): boolean =>
  hosting === null ? false : kickPeer(hosting, peerId);

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
