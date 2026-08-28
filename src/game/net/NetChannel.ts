/**
 * One browser-side WebSocket to the relay (`scripts/net-relay.mjs`), with
 * the two relay conventions in one place:
 *
 *  - a **joiner** sends raw payload strings and receives raw payload
 *    strings — it never sees an envelope;
 *  - the **host** receives `{"from":id,"data":payload}` envelopes and
 *    `{"sys":"joined"|"left","id":…}` notices, and sends
 *    `{"to":id|"all","data":payload}`.
 *
 * Messages are queued rather than dispatched: the p5 loop owns time in this
 * engine, so a session drains the queue from its own `update()` and network
 * arrival order never interleaves with a half-finished tick.
 */

export interface HostFrame {
  from?: string;
  sys?: 'joined' | 'left';
  id?: string;
  data?: string;
}

export class NetChannel {
  private socket: WebSocket;
  private queue: string[] = [];
  private immediate: ((raw: string) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = event => {
      if (typeof event.data !== 'string') return;
      if (this.immediate) this.immediate(event.data);
      else this.queue.push(event.data);
    };
    this.socket.onclose = () => {
      this.closed = true;
    };
    this.socket.onerror = () => {
      this.closed = true;
    };
  }

  /** Resolves once the socket is open, or rejects on failure/timeout. */
  ready(timeoutMs = 10_000): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('net: relay connect timeout')), timeoutMs);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('net: relay connection failed'));
      });
    });
  }

  /**
   * Deliver every future frame straight to `handler` instead of the queue —
   * the host's order path. Frames already queued stay queued; the caller
   * drains them once.
   */
  setImmediate(handler: (raw: string) => void): void {
    this.immediate = handler;
  }

  send(raw: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(raw);
  }

  /** Everything received since the last drain, oldest first. */
  drain(): string[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /**
   * Put frames back at the head of the queue, oldest first.
   *
   * For a reader that has to *look* at the stream without owning it: the LAN
   * lobby drains while waiting for the hello so it can also see the room's
   * player list go by, and everything else it finds belongs to the
   * `ClientSession` that has not been built yet. Dropping those would drop
   * the host's opening events.
   */
  pushBack(raws: string[]): void {
    if (raws.length) this.queue.unshift(...raws);
  }

  /** Waits for the next frame matching `accept`, draining nothing else. */
  async waitFor<T>(accept: (raw: string) => T | null, timeoutMs = 15_000): Promise<T> {
    const startedAt = Date.now();
    for (;;) {
      const index = this.queue.findIndex(raw => accept(raw) !== null);
      if (index >= 0) {
        const [raw] = this.queue.splice(index, 1);
        return accept(raw) as T;
      }
      if (this.closed) throw new Error('net: relay closed while waiting');
      if (Date.now() - startedAt > timeoutMs) throw new Error('net: timed out waiting for host');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }
}

export const relayUrl = (server: string, room: string, role: 'host' | 'join'): string => {
  // A trailing slash on the server would otherwise produce `//?room=`, which
  // is a different path to the broker and a needless way to lose a match.
  const withScheme = server.includes('://') ? server : `ws://${server}`;
  const base = withScheme.replace(/\/+$/, '');
  return `${base}/?room=${encodeURIComponent(room)}&role=${role}`;
};

/**
 * The host's signaling URL — `relayUrl` plus the two things only a host says.
 *
 * `listed=0` is a room that is **not advertised**: the broker's `/rooms`
 * listing became one directory for everybody (it used to group by the host's
 * public IP, which silently found nobody on any network that leaves through a
 * pool of addresses), so staying out of it stopped being automatic and had to
 * become a choice. It must travel on the socket rather than only on the
 * lobby's `/rooms` poll, because the room registers itself the moment the host
 * connects — a room withheld from the poll alone would be advertised by the
 * WebSocket anyway.
 */
export const hostSignalUrl = (server: string, room: string, name: string, listed = true): string =>
  `${relayUrl(server, room, 'host')}&name=${encodeURIComponent(name)}` +
  (listed ? '' : '&listed=0');

export const parseHostFrame = (raw: string): HostFrame | null => {
  try {
    const frame = JSON.parse(raw) as HostFrame;
    return typeof frame === 'object' && frame !== null ? frame : null;
  } catch {
    return null;
  }
};
