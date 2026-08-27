import { NetChannel, parseHostFrame, relayUrl } from './NetChannel';
import type { ClientTransport, HostFrameEvent, HostTransport } from './transport';

/**
 * WebRTC DataChannel transports — the player-facing wire (LAN design spec
 * §3 as revised): the signaling broker (the deployed Worker, or the dev
 * relay — both speak the same protocol) carries only the SDP/ICE handshake,
 * and everything after runs peer-to-peer. On one LAN that is ICE *host
 * candidates*: direct socket, sub-millisecond, no server in the loop — so
 * `iceServers` is deliberately empty. Internet play needs STUN/TURN and is
 * the spec roadmap's problem, not this file's.
 *
 * Two channels per peer, negotiated by the host:
 *
 *   - `r` — reliable/ordered: hello, events, orders. The session's whole
 *     correctness rides on these arriving, in order.
 *   - `u` — `ordered: false, maxRetransmits: 0`: snapshots. A snapshot is
 *     superseded by the next one 33ms later, so a retransmit would deliver
 *     the past; the interpolation buffer already drops stale arrivals by
 *     match time, which is what makes this lane safe.
 *
 * A peer counts as joined when `r` opens, and the signaling socket's own
 * `left` is ignored once it has — a client is expected to drop signaling
 * after the handshake; the DataChannels are the session.
 */

/** Signaling payloads riding the relay protocol's `data` field. */
type SignalPayload =
  { t: 'sdp'; d: RTCSessionDescriptionInit } | { t: 'ice'; c: RTCIceCandidateInit };

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

interface RtcPeer {
  connection: RTCPeerConnection;
  reliable: RTCDataChannel;
  unreliable: RTCDataChannel;
  open: boolean;
}

export class RtcHostTransport implements HostTransport {
  private peers = new Map<string, RtcPeer>();
  private queue: HostFrameEvent[] = [];
  private immediate: ((event: HostFrameEvent) => void) | null = null;

  private constructor(private readonly signal: NetChannel) {
    signal.setImmediate(raw => this.onSignal(raw));
  }

  static async connect(server: string, room: string, name: string): Promise<RtcHostTransport> {
    const signal = new NetChannel(
      `${relayUrl(server, room, 'host')}&name=${encodeURIComponent(name)}`
    );
    await signal.ready();
    const transport = new RtcHostTransport(signal);
    // Anything the socket queued before the immediate handler landed.
    for (const raw of signal.drain()) transport.onSignal(raw);
    return transport;
  }

  private emit(event: HostFrameEvent): void {
    if (this.immediate) this.immediate(event);
    else this.queue.push(event);
  }

  private onSignal(raw: string): void {
    const frame = parseHostFrame(raw);
    if (!frame) return;
    if (frame.sys === 'joined' && frame.id) {
      void this.offerTo(frame.id);
      return;
    }
    if (frame.sys === 'left' && frame.id) {
      // Pre-handshake abandon only: once the channels are up, the signaling
      // socket is disposable and its closing says nothing.
      const peer = this.peers.get(frame.id);
      if (peer && !peer.open) {
        peer.connection.close();
        this.peers.delete(frame.id);
      }
      return;
    }
    if (!frame.from || typeof frame.data !== 'string') return;
    const peer = this.peers.get(frame.from);
    if (!peer) return;
    let payload: SignalPayload;
    try {
      payload = JSON.parse(frame.data) as SignalPayload;
    } catch {
      return;
    }
    if (payload.t === 'sdp') {
      void peer.connection.setRemoteDescription(payload.d).catch(() => undefined);
    } else if (payload.t === 'ice') {
      void peer.connection.addIceCandidate(payload.c).catch(() => undefined);
    }
  }

  private async offerTo(peerId: string): Promise<void> {
    const connection = new RTCPeerConnection(RTC_CONFIG);
    const reliable = connection.createDataChannel('r');
    const unreliable = connection.createDataChannel('u', { ordered: false, maxRetransmits: 0 });
    const peer: RtcPeer = { connection, reliable, unreliable, open: false };
    this.peers.set(peerId, peer);

    const onFrame = (event: MessageEvent) => {
      if (typeof event.data === 'string') this.emit({ kind: 'frame', peerId, raw: event.data });
    };
    reliable.onmessage = onFrame;
    unreliable.onmessage = onFrame;
    reliable.onopen = () => {
      peer.open = true;
      this.emit({ kind: 'joined', peerId });
    };
    reliable.onclose = () => {
      if (!peer.open) return;
      peer.open = false;
      this.peers.delete(peerId);
      this.emit({ kind: 'left', peerId });
    };
    connection.onicecandidate = ice => {
      if (ice.candidate) this.signalTo(peerId, { t: 'ice', c: ice.candidate.toJSON() });
    };

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    this.signalTo(peerId, { t: 'sdp', d: offer });
  }

  private signalTo(peerId: string, payload: SignalPayload): void {
    this.signal.send(JSON.stringify({ to: peerId, data: JSON.stringify(payload) }));
  }

  setImmediate(handler: (event: HostFrameEvent) => void): void {
    this.immediate = handler;
  }

  drain(): HostFrameEvent[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  sendTo(peerId: string, raw: string): void {
    const peer = this.peers.get(peerId);
    if (peer?.open && peer.reliable.readyState === 'open') peer.reliable.send(raw);
  }

  broadcast(raw: string): void {
    for (const peer of this.peers.values()) {
      if (peer.open && peer.reliable.readyState === 'open') peer.reliable.send(raw);
    }
  }

  broadcastUnreliable(raw: string): void {
    for (const peer of this.peers.values()) {
      if (!peer.open) continue;
      if (peer.unreliable.readyState === 'open') peer.unreliable.send(raw);
      else if (peer.reliable.readyState === 'open') peer.reliable.send(raw);
    }
  }

  close(): void {
    for (const peer of this.peers.values()) peer.connection.close();
    this.peers.clear();
    this.signal.close();
  }
}

export class RtcClientTransport implements ClientTransport {
  private queue: string[] = [];
  closed = false;

  private constructor(
    private readonly connection: RTCPeerConnection,
    private readonly reliable: RTCDataChannel
  ) {}

  static async connect(
    server: string,
    room: string,
    timeoutMs = 15_000
  ): Promise<RtcClientTransport> {
    const signal = new NetChannel(relayUrl(server, room, 'join'));
    await signal.ready();

    const connection = new RTCPeerConnection(RTC_CONFIG);
    connection.onicecandidate = ice => {
      if (ice.candidate) signal.send(JSON.stringify({ t: 'ice', c: ice.candidate.toJSON() }));
    };

    let transport: RtcClientTransport | null = null;
    const channels: RTCDataChannel[] = [];
    const opened = new Promise<RtcClientTransport>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('net: WebRTC handshake timed out — is the host still up?')),
        timeoutMs
      );
      connection.ondatachannel = ({ channel }) => {
        channels.push(channel);
        if (channel.label === 'r') {
          channel.onopen = () => {
            clearTimeout(timer);
            transport = new RtcClientTransport(connection, channel);
            for (const each of channels) {
              each.onmessage = event => {
                if (typeof event.data === 'string') transport?.push(event.data);
              };
            }
            resolve(transport);
          };
        } else {
          // A channel that opened before `r` still needs its handler once
          // the transport exists; the loop above covers it.
          channel.onmessage = event => {
            if (typeof event.data === 'string') transport?.push(event.data);
          };
        }
        channel.onclose = () => {
          if (transport) transport.closed = true;
        };
      };

      const handleSignal = (raw: string): void => {
        let payload: SignalPayload;
        try {
          payload = JSON.parse(raw) as SignalPayload;
        } catch {
          return;
        }
        if (payload.t === 'sdp') {
          void (async () => {
            await connection.setRemoteDescription(payload.d);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            signal.send(JSON.stringify({ t: 'sdp', d: answer }));
          })().catch(reject);
        } else if (payload.t === 'ice') {
          void connection.addIceCandidate(payload.c).catch(() => undefined);
        }
      };
      signal.setImmediate(handleSignal);
      // The offer may have raced the handler installation.
      for (const raw of signal.drain()) handleSignal(raw);
    });

    const ready = await opened;
    // The handshake is done; the DataChannels are the session now, and the
    // host ignores signaling `left` for an open peer by design.
    signal.close();
    return ready;
  }

  private push(raw: string): void {
    this.queue.push(raw);
  }

  send(raw: string): void {
    if (this.reliable.readyState === 'open') this.reliable.send(raw);
  }

  drain(): string[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  async waitFor<T>(accept: (raw: string) => T | null, timeoutMs = 15_000): Promise<T> {
    const startedAt = Date.now();
    for (;;) {
      const index = this.queue.findIndex(raw => accept(raw) !== null);
      if (index >= 0) {
        const [raw] = this.queue.splice(index, 1);
        return accept(raw) as T;
      }
      if (this.closed) throw new Error('net: peer connection closed while waiting');
      if (Date.now() - startedAt > timeoutMs) throw new Error('net: timed out waiting for host');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  close(): void {
    this.closed = true;
    this.connection.close();
  }
}
