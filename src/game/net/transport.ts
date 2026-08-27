import { NetChannel, parseHostFrame, relayUrl } from './NetChannel';

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
  waitFor<T>(accept: (raw: string) => T | null, timeoutMs?: number): Promise<T>;
  close(): void;
  readonly closed: boolean;
}

export type HostFrameEvent =
  | { kind: 'joined'; peerId: string }
  | { kind: 'left'; peerId: string }
  | { kind: 'frame'; peerId: string; raw: string };

export interface HostTransport {
  /** Deliver every future event straight to `handler`; earlier ones stay for one `drain`. */
  setImmediate(handler: (event: HostFrameEvent) => void): void;
  drain(): HostFrameEvent[];
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

  static async connect(server: string, room: string, name: string): Promise<RelayHostTransport> {
    const channel = new NetChannel(
      `${relayUrl(server, room, 'host')}&name=${encodeURIComponent(name)}`
    );
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
