import { NetChannel, hostSignalUrl, parseHostFrame, relayUrl } from './NetChannel';

/**
 * The seam between the sessions and the wire, so WebRTC DataChannels and
 * the dev WebSocket relay are two implementations of one contract:
 *
 *   - `RelayClientTransport` / `RelayHostTransport` — everything through
 *     `scripts/net-relay.mjs` (or the deployed broker in `transport=ws`
 *     fallback mode): simple, ordered, one hop through a server.
 *   - `RtcHostTransport` / `RtcClientTransport` (`RtcTransport.ts`) — the
 *     broker carries only the SDP/ICE handshake, then traffic runs
 *     peer-to-peer over two DataChannels: `r` reliable/ordered for events,
 *     orders and the hello, `u` unordered with `maxRetransmits: 0` for
 *     snapshots, which supersede each other anyway (the interpolation
 *     buffer already drops stale arrivals by match time).
 *
 * Sessions never see which one they got.
 */

export interface ClientTransport {
  send(raw: string): void;
  drain(): string[];
  /** Return frames to the head of the queue — see `NetChannel.pushBack`. */
  pushBack(raws: string[]): void;
  waitFor<T>(accept: (raw: string) => T | null, timeoutMs?: number): Promise<T>;
  close(): void;
  readonly closed: boolean;
}

export type HostFrameEvent =
  | { kind: 'joined'; peerId: string }
  | { kind: 'left'; peerId: string }
  | { kind: 'frame'; peerId: string; raw: string };

/**
 * How far a peer has got towards being able to speak — the *handshake*, which
 * `HostFrameEvent` deliberately says nothing about.
 *
 * `joined` fires when a peer can carry a frame, and that is the only thing a
 * session ever wants to know. A **lobby** wants one thing more: whether
 * somebody is trying. On a network that blocks peer-to-peer, ICE never
 * completes, `joined` never fires, and the host's screen is identical to one
 * where nobody pressed Vào — the failure reported as *"host không thấy
 * client"*. These states are what let the room tell those two apart.
 *
 *   - `connecting` — an offer has gone out to this peer.
 *   - `open` — the reliable channel carries frames; `joined` says this too.
 *   - `failed` — ICE gave up. The peer is real and cannot be reached.
 *   - `gone` — it abandoned the handshake (its signaling socket closed).
 */
export type PeerLink = 'connecting' | 'open' | 'failed' | 'gone';

export interface HostTransport {
  /** Deliver every future event straight to `handler`; earlier ones stay for one `drain`. */
  setImmediate(handler: (event: HostFrameEvent) => void): void;
  /**
   * Handshake progress, for the lobby's roster — optional because only a wire
   * that *has* a handshake can report one. A relay peer is connected the
   * instant it exists, so `RelayHostTransport` implements nothing here and its
   * rooms simply never show a `connecting` row.
   */
  watchPeerLink?(handler: (peerId: string, link: PeerLink) => void): void;
  drain(): HostFrameEvent[];
  /**
   * Hang up on one peer, for the host's own kick.
   *
   * Optional for the same reason `watchPeerLink` is: it is a property of a
   * wire that holds a connection per peer. Dropping a *relay* joiner would
   * mean asking the relay to close somebody else's socket, which its protocol
   * has no frame for — so `RelayHostTransport` implements nothing here, and a
   * kick there is the sweep alone: the champion goes, and the client finds out
   * the way it finds out about anything else, from the event stream.
   */
  dropPeer?(peerId: string): void;
  sendTo(peerId: string, raw: string): void;
  broadcast(raw: string): void;
  /** Snapshot path — may drop or reorder; falls back to `broadcast` where the wire has no such lane. */
  broadcastUnreliable(raw: string): void;
  close(): void;
}

/** The relay's client side is exactly `NetChannel` — joiners speak bare payloads. */
export class RelayClientTransport extends NetChannel implements ClientTransport {
  static async connect(server: string, room: string): Promise<RelayClientTransport> {
    const transport = new RelayClientTransport(relayUrl(server, room, 'join'));
    await transport.ready();
    return transport;
  }
}

const toHostEvent = (raw: string): HostFrameEvent | null => {
  const frame = parseHostFrame(raw);
  if (!frame) return null;
  if (frame.sys === 'joined' && frame.id) return { kind: 'joined', peerId: frame.id };
  if (frame.sys === 'left' && frame.id) return { kind: 'left', peerId: frame.id };
  if (frame.from && typeof frame.data === 'string') {
    return { kind: 'frame', peerId: frame.from, raw: frame.data };
  }
  return null;
};

export class RelayHostTransport implements HostTransport {
  private constructor(private readonly channel: NetChannel) {}

  static async connect(
    server: string,
    room: string,
    name: string,
    listed = true
  ): Promise<RelayHostTransport> {
    const channel = new NetChannel(hostSignalUrl(server, room, name, listed));
    await channel.ready();
    return new RelayHostTransport(channel);
  }

  setImmediate(handler: (event: HostFrameEvent) => void): void {
    this.channel.setImmediate(raw => {
      const event = toHostEvent(raw);
      if (event) handler(event);
    });
  }

  drain(): HostFrameEvent[] {
    const events: HostFrameEvent[] = [];
    for (const raw of this.channel.drain()) {
      const event = toHostEvent(raw);
      if (event) events.push(event);
    }
    return events;
  }

  sendTo(peerId: string, raw: string): void {
    this.channel.send(JSON.stringify({ to: peerId, data: raw }));
  }

  broadcast(raw: string): void {
    this.channel.send(JSON.stringify({ to: 'all', data: raw }));
  }

  broadcastUnreliable(raw: string): void {
    // One ordered socket — the relay has no lossy lane to offer.
    this.broadcast(raw);
  }

  close(): void {
    this.channel.close();
  }
}
