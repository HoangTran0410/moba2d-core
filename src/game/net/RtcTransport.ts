import { NetChannel, hostSignalUrl, parseHostFrame, relayUrl } from './NetChannel';
import { rtcConfig } from './iceConfig';
import type { ClientTransport, HostFrameEvent, HostTransport, PeerLink } from './transport';

/**
 * WebRTC DataChannel transports — the player-facing wire (LAN design spec
 * §3 as revised): the signaling broker (the deployed Worker, or the dev
 * relay — both speak the same protocol) carries only the SDP/ICE handshake,
 * and everything after runs peer-to-peer. On one LAN that is ideally ICE
 * *host candidates*: direct socket, sub-millisecond, no server in the loop.
 *
 * `iceServers` was empty for exactly that reason, and **that was the bug**.
 * A host candidate is not the machine's address: Chrome hands out a random
 * `*.local` name and leaves resolving it to mDNS multicast, which a corporate
 * wifi drops while cheerfully forwarding the unicast that made the two
 * machines look reachable. With nothing else on offer, ICE ran out of options
 * and both lobbies waited for ever. `iceConfig.ts` owns the list now, defaults
 * to STUN, and keeps host-candidates-only one parameter away (`?ice=none`) —
 * which is what the e2e uses, loopback being the one place the old reasoning
 * actually holds.
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
  private linkWatcher: ((peerId: string, link: PeerLink) => void) | null = null;

  private constructor(
    private readonly signal: NetChannel,
    /** Kept for `offerTo`: the ICE list, TURN included, is minted by the broker. */
    private readonly server: string
  ) {
    signal.setImmediate(raw => this.onSignal(raw));
  }

  static async connect(
    server: string,
    room: string,
    name: string,
    listed = true
  ): Promise<RtcHostTransport> {
    const signal = new NetChannel(hostSignalUrl(server, room, name, listed));
    await signal.ready();
    const transport = new RtcHostTransport(signal, server);
    // Anything the socket queued before the immediate handler landed.
    for (const raw of signal.drain()) transport.onSignal(raw);
    return transport;
  }

  private emit(event: HostFrameEvent): void {
    if (this.immediate) this.immediate(event);
    else this.queue.push(event);
  }

  watchPeerLink(handler: (peerId: string, link: PeerLink) => void): void {
    this.linkWatcher = handler;
  }

  /**
   * Not queued, unlike `emit`. A link state is a fact about *now* — a lobby
   * that subscribes late wants the room as it stands, which it gets from the
   * peer map, not a history of handshakes that have since resolved.
   */
  private reportLink(peerId: string, link: PeerLink): void {
    this.linkWatcher?.(peerId, link);
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
        // Nothing goes out as a `HostFrameEvent` — this peer never `joined`,
        // so a session was never told it existed. The lobby was, and has a row
        // on screen to take down.
        this.reportLink(frame.id, 'gone');
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
    const connection = new RTCPeerConnection(await rtcConfig(this.server));
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
      this.reportLink(peerId, 'open');
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
    // ICE giving up is the only way this host ever learns that a peer it can
    // see on the signaling socket cannot be reached over the wire — the state
    // a blocked network leaves every join in, and the one the room used to
    // render as an empty list.
    connection.oniceconnectionstatechange = () => {
      if (peer.open) return;
      if (connection.iceConnectionState === 'failed') this.reportLink(peerId, 'failed');
    };

    // Announced before the offer, not after: `createOffer` is a round trip
    // through the ICE agent, and on a slow gathering pass the room would
    // otherwise sit empty for the part of the wait that most needs a name.
    this.reportLink(peerId, 'connecting');

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

  /**
   * Hang up on one peer — the host's kick, and the only way a client that is
   * still running learns it has been removed.
   *
   * Closing the connection fires the client's own `onclose`, so it reports a
   * lost link and stops, rather than sitting on a channel nobody reads and
   * showing a match that has moved on without it. The peer is dropped from the
   * map first so `reliable.onclose` here has nothing left to emit a `left`
   * for: `HostSession.kickUnit` has already done everything a `left` would.
   */
  dropPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    peer.connection.close();
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

  /**
   * `timeoutMs` may be `Infinity`, and the LAN lobby passes exactly that.
   *
   * A joiner who is *waiting for the host to start* has nothing to time out
   * against: the broker replays `sys:joined` to a host that connects late (both
   * the deployed Worker and `scripts/net-relay.mjs` do), so the offer arrives
   * whenever the host presses Vào trận — a minute later, or ten. The 15-second
   * default is right for the other caller, `clientBoot`, where the host is
   * supposed to already be there and silence means something is wrong.
   *
   * `setTimeout` is *not* given `Infinity`: a delay above 2^31-1 wraps and the
   * timer fires immediately, which would turn "wait forever" into "fail at
   * once". The timer is only created when the deadline is finite.
   *
   * `abort` cancels a wait in progress — the lobby's Huỷ button. Without it a
   * cancelled join leaves an open signaling socket the broker still counts as
   * a joiner, so the host would see a phantom in the room for ever.
   */
  static async connect(
    server: string,
    room: string,
    options: { timeoutMs?: number; abort?: AbortSignal } = {}
  ): Promise<RtcClientTransport> {
    const { timeoutMs = 15_000, abort } = options;
    const signal = new NetChannel(relayUrl(server, room, 'join'));
    await signal.ready();

    // Before the socket work below, because a `RTCPeerConnection` cannot be
    // handed servers after it is built and gathering has begun.
    const connection = new RTCPeerConnection(await rtcConfig(server));
    connection.onicecandidate = ice => {
      if (ice.candidate) signal.send(JSON.stringify({ t: 'ice', c: ice.candidate.toJSON() }));
    };

    let transport: RtcClientTransport | null = null;
    const channels: RTCDataChannel[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let onAbort: (() => void) | null = null;
    const stopWaiting = (): void => {
      if (timer !== null) clearTimeout(timer);
      if (watchdog !== null) clearInterval(watchdog);
      if (onAbort) abort?.removeEventListener('abort', onAbort);
    };
    const opened = new Promise<RtcClientTransport>((resolve, reject) => {
      if (Number.isFinite(timeoutMs)) {
        timer = setTimeout(
          () => reject(new Error('net: WebRTC handshake timed out — is the host still up?')),
          timeoutMs
        );
      }
      // An unbounded wait needs *some* way to end other than success, or a
      // broker that drops the socket leaves the lobby spinning for ever with
      // nothing to say. The channel reports its own close; poll it rather than
      // growing `NetChannel` an event for one caller.
      watchdog = setInterval(() => {
        if (signal.closed) reject(new Error('net: signaling closed before the host answered'));
      }, 500);
      // The host answered and the two still cannot reach each other: ICE ran
      // and found no route. Distinguished from the deadline above because the
      // player can do something about exactly one of them — this is the
      // network, not the host, and saying "is the host still up?" about it
      // sends people to look in the wrong place.
      connection.oniceconnectionstatechange = () => {
        if (transport) return;
        if (connection.iceConnectionState === 'failed') {
          reject(new Error('net: no route to the host — this network blocks direct connections'));
        }
      };
      if (abort) {
        onAbort = () => {
          signal.close();
          connection.close();
          reject(new Error('net: join cancelled'));
        };
        if (abort.aborted) onAbort();
        else abort.addEventListener('abort', onAbort, { once: true });
      }
      connection.ondatachannel = ({ channel }) => {
        channels.push(channel);
        if (channel.label === 'r') {
          channel.onopen = () => {
            stopWaiting();
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

    let ready: RtcClientTransport;
    try {
      ready = await opened;
    } catch (error) {
      stopWaiting();
      signal.close();
      connection.close();
      throw error;
    }
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

  /** See `NetChannel.pushBack` — the lobby reads the stream it does not own. */
  pushBack(raws: string[]): void {
    if (raws.length) this.queue.unshift(...raws);
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
