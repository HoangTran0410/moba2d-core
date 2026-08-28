/**
 * Joining a room the host has not started yet.
 *
 * Reported from a real LAN attempt: make a room, read the code to a friend,
 * they press Vào — and their game dies on the loading screen with *"net:
 * WebRTC handshake timed out — is the host still up?"* about a host sitting at
 * the same table, still looking at its own room code. Pressing Vào went
 * straight to `GameScene`, which connected and gave the host fifteen seconds
 * to answer; a host that has not pressed Vào trận is not connected to the
 * broker at all, so nothing could.
 *
 * The wire was never the problem — the broker replays `sys:joined` to a host
 * that connects late, on purpose, so a joiner who *waits* is the supported
 * flow. Two fifteen-second deadlines and the fact that the wait happened
 * inside the match were the whole bug.
 *
 * What is checked here is the shape of the fix, because each half of it is a
 * one-line regression:
 *
 *  - the wait for the host to press Vào trận has **no deadline** — that half
 *    is genuinely open-ended and giving up on it is the original bug. The
 *    *handshake* is the half that since grew one, for the reason the test
 *    itself sets out: the host now connects at Tạo phòng, so silence there
 *    stopped meaning "not yet" and started meaning "never";
 *  - the connection **reports itself** (`onConnected`) — the screen may not
 *    claim a room before there is a channel to it;
 *  - the connection is **handed over**, not remade — by the time the hello
 *    lands the channel already holds the host's opening events, and dialling
 *    again from `GameScene` would wait for a second hello that never comes;
 *  - **cancelling closes it**, or the broker goes on counting a joiner who
 *    walked back to the menu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetUrlRequest } from '../../../src/game/net/netRole';

/** One fake wire, standing in for both transports. */
class FakeChannel {
  closed = false;
  sent: string[] = [];
  private inbox: string[] = [];
  /** Every `waitFor` deadline this channel was asked for. */
  readonly deadlines: number[] = [];

  deliver(raw: string): void {
    this.inbox.push(raw);
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  drain(): string[] {
    return this.inbox.splice(0);
  }
  pushBack(raws: string[]): void {
    if (raws.length) this.inbox.unshift(...raws);
  }
  close(): void {
    this.closed = true;
  }
  async waitFor<T>(accept: (raw: string) => T | null, timeoutMs = 15_000): Promise<T> {
    this.deadlines.push(timeoutMs);
    for (;;) {
      const index = this.inbox.findIndex(raw => accept(raw) !== null);
      if (index >= 0) {
        const [raw] = this.inbox.splice(index, 1);
        return accept(raw) as T;
      }
      if (this.closed) throw new Error('net: peer connection closed while waiting');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
}

/** What the last `RtcClientTransport.connect` was handed. */
const rtcCalls: { server: string; room: string; options: Record<string, unknown> }[] = [];
const relayCalls: { server: string; room: string }[] = [];
let nextChannel: FakeChannel;
/** Set by a test that wants the handshake itself to fail. */
let connectRejection: Error | null = null;

vi.mock('../../../src/game/net/RtcTransport', () => ({
  RtcClientTransport: {
    connect: (server: string, room: string, options = {}) => {
      rtcCalls.push({ server, room, options });
      return connectRejection ? Promise.reject(connectRejection) : Promise.resolve(nextChannel);
    },
  },
}));

vi.mock('../../../src/game/net/transport', () => ({
  RelayClientTransport: {
    connect: (server: string, room: string) => {
      relayCalls.push({ server, room });
      return Promise.resolve(nextChannel);
    },
  },
}));

const { waitForHostToStart, takeHeldRoom, releaseHeldRoom } =
  await import('../../../src/game/net/lobbyJoin');

const HELLO = JSON.stringify({
  t: 'hello',
  tm: 0,
  mapId: 'reference:proving-grounds',
  rules: { cooldownMultiplier: 1, manaFree: false },
  you: { id: 'c1', team: 'blue', plan: { championName: 'X', spellIds: [] } },
  roster: [],
});

const request = (over: Partial<NetUrlRequest> = {}): NetUrlRequest => ({
  mode: 'join',
  server: 'wss://broker',
  room: 'K7QP2',
  transport: 'rtc',
  ...over,
});

beforeEach(() => {
  rtcCalls.length = 0;
  relayCalls.length = 0;
  nextChannel = new FakeChannel();
  connectRejection = null;
  releaseHeldRoom();
});

afterEach(() => releaseHeldRoom());

describe('waiting in the lobby for the host to start', () => {
  /**
   * The deadline split — and why the handshake stopped sharing the hello's.
   *
   * Both halves were unbounded (`timeoutMs: Infinity`) when this module was
   * written, and that was right *then*: the host reached the broker only at
   * Vào trận, so no offer could exist before it pressed, and time passing was
   * genuinely not a failure. `lobbyHost.ts` then moved the host's connection
   * to **Tạo phòng**, which moved the meaning of silence with it. An open room
   * answers a joiner in seconds, so a handshake that never completes is now a
   * real failure with real causes — a mistyped code, a room nobody opened, a
   * network that blocks peer-to-peer — and an unbounded wait turns every one
   * of them into the same silent spinner. That is the bug this deadline
   * closes: reported as *"vào phòng rồi mà không thấy host, host cũng không
   * thấy client"*, sat on for ever because nothing was allowed to give up.
   *
   * The hello's wait stays unbounded, because that half is still open-ended:
   * once the channel is up the host may sit in its own lobby for ten minutes,
   * and the next test is what holds that line.
   */
  it('gives the handshake a deadline, and the wait for the host none', async () => {
    const abort = new AbortController();
    const waiting = waitForHostToStart(request(), abort.signal);

    // Deliberately *after* a few turns of the event loop: the point of the
    // fix is that time passing is not a failure.
    await new Promise(resolve => setTimeout(resolve, 20));
    nextChannel.deliver(HELLO);
    await waiting;

    expect(rtcCalls).toHaveLength(1);
    const deadline = rtcCalls[0].options.timeoutMs as number;
    expect(deadline, 'an unbounded handshake cannot report a network that blocks it').toBeLessThan(
      Infinity
    );
    // Long enough for a slow ICE round on a real network, short enough that a
    // player finds out inside the span of their patience.
    expect(deadline).toBeGreaterThanOrEqual(10_000);
    expect(deadline).toBeLessThanOrEqual(45_000);
  });

  /**
   * "Đã vào phòng" is a claim about the wire, and the screen used to make it
   * before there was one — `joining` was set on the press, so the client
   * announced it had joined a room it had not reached, and went on saying so
   * while the handshake quietly failed behind it. The host, meanwhile, showed
   * an empty room. Two screens, both wrong, agreeing with neither reality nor
   * each other.
   *
   * So the connection reports itself. `onConnected` fires at the one moment
   * the claim becomes true — the channel is open, which is exactly when the
   * host's own transport emits `joined` and puts this player on its list.
   */
  it('reports the connection before it reports anything else', async () => {
    const abort = new AbortController();
    const order: string[] = [];
    const waiting = waitForHostToStart(request(), abort.signal, {
      onConnected: () => order.push('connected'),
      onRoster: () => order.push('roster'),
    });

    await new Promise(resolve => setTimeout(resolve, 5));
    nextChannel.deliver(
      JSON.stringify({ t: 'lobby', players: [{ id: 'host', name: 'Ashe', host: true }] })
    );
    await new Promise(resolve => setTimeout(resolve, 60));
    nextChannel.deliver(HELLO);
    await waiting;

    expect(order, 'the roster arrived before the connection that carried it').toEqual([
      'connected',
      'roster',
    ]);
  });

  it('does not claim a connection that failed', async () => {
    connectRejection = new Error('net: WebRTC handshake timed out — is the host still up?');
    const abort = new AbortController();
    let connected = false;

    await expect(
      waitForHostToStart(request(), abort.signal, { onConnected: () => (connected = true) })
    ).rejects.toThrow(/timed out/);

    expect(connected, 'a failed handshake still told the screen it was in the room').toBe(false);
  });

  it('waits for the hello with no deadline at all', async () => {
    vi.useFakeTimers();
    try {
      const abort = new AbortController();
      let settled = '';
      const waiting = waitForHostToStart(request(), abort.signal).then(
        () => (settled = 'resolved'),
        () => (settled = 'rejected')
      );

      // A minute of silence — four times the deadline that produced the bug
      // report, and more than the whole handshake+hello budget used to be.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled, 'the wait gave up on the host').toBe('');

      nextChannel.deliver(HELLO);
      await vi.advanceTimersByTimeAsync(100);
      await waiting;
      expect(settled).toBe('resolved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the room’s player list while it waits, and keeps the match’s frames', async () => {
    const abort = new AbortController();
    const seen: string[][] = [];
    const waiting = waitForHostToStart(request(), abort.signal, {
      onRoster: list => seen.push(list.map(player => player.name)),
    });
    await new Promise(resolve => setTimeout(resolve, 5));

    // The host announces itself, then a friend arrives.
    nextChannel.deliver(
      JSON.stringify({ t: 'lobby', players: [{ id: 'host', name: 'Ashe', host: true }] })
    );
    await new Promise(resolve => setTimeout(resolve, 60));
    nextChannel.deliver(
      JSON.stringify({
        t: 'lobby',
        players: [
          { id: 'host', name: 'Ashe', host: true },
          { id: 'c1', name: 'Ngẫu nhiên' },
        ],
      })
    );
    await new Promise(resolve => setTimeout(resolve, 60));

    // The host starts, and its first events ride in behind the hello.
    const firstEvent = JSON.stringify({ t: 'ev', ev: [] });
    nextChannel.deliver(HELLO);
    nextChannel.deliver(firstEvent);
    await waiting;

    expect(seen).toEqual([['Ashe'], ['Ashe', 'Ngẫu nhiên']]);
    // Everything past the hello belongs to the `ClientSession` that does not
    // exist yet. Swallowing it is a unit that never appears in the match.
    expect(nextChannel.drain(), 'the match’s opening frames were eaten').toEqual([firstEvent]);
  });

  it('announces who this player is, so the host has a name to list', async () => {
    const abort = new AbortController();
    const waiting = waitForHostToStart(request(), abort.signal);
    nextChannel.deliver(HELLO);
    await waiting;

    expect(nextChannel.sent).toHaveLength(1);
    const announced = JSON.parse(nextChannel.sent[0]);
    expect(announced.t).toBe('iam');
    expect(typeof announced.name).toBe('string');
    expect(announced.name.length).toBeGreaterThan(0);
  });

  it('hands the live channel to the match instead of making it reconnect', async () => {
    const abort = new AbortController();
    const waiting = waitForHostToStart(request(), abort.signal);
    nextChannel.deliver(HELLO);
    await waiting;

    const held = takeHeldRoom(request());
    expect(held).not.toBeNull();
    expect(held!.channel, 'the match got a different channel').toBe(nextChannel);
    expect(held!.hello.mapId).toBe('reference:proving-grounds');
    expect(held!.channel.closed).toBe(false);
    // Exactly one dial: the whole point is that `startNetClientMatch` does not
    // open a second connection the host has no second hello for.
    expect(rtcCalls).toHaveLength(1);
  });

  it('hands it over once, and only to the room it was made for', async () => {
    const abort = new AbortController();
    const waiting = waitForHostToStart(request(), abort.signal);
    nextChannel.deliver(HELLO);
    await waiting;

    expect(takeHeldRoom(request({ room: 'OTHER' })), 'a different room took it').toBeNull();
    expect(takeHeldRoom(request({ transport: 'ws' })), 'a different wire took it').toBeNull();
    expect(takeHeldRoom(request())).not.toBeNull();
    expect(takeHeldRoom(request()), 'the same room took it twice').toBeNull();
  });

  it('uses the relay when the URL asked for it, so the two halves agree', async () => {
    const abort = new AbortController();
    const waiting = waitForHostToStart(request({ transport: 'ws' }), abort.signal);
    nextChannel.deliver(HELLO);
    await waiting;

    expect(relayCalls).toEqual([{ server: 'wss://broker', room: 'K7QP2' }]);
    expect(rtcCalls).toHaveLength(0);
    expect(takeHeldRoom(request({ transport: 'ws' }))).not.toBeNull();
  });

  it('closes the connection when the wait is cancelled', async () => {
    const abort = new AbortController();
    const waiting = waitForHostToStart(request(), abort.signal);
    await new Promise(resolve => setTimeout(resolve, 5));

    abort.abort();

    await expect(waiting).rejects.toThrow(/cancelled/);
    expect(nextChannel.closed, 'a cancelled join left the broker counting a joiner').toBe(true);
    expect(takeHeldRoom(request())).toBeNull();
  });

  /**
   * The other end of the handover, and the half a unit test of this module
   * cannot reach: `startNetClientMatch` has to *ask*. Mocking its way to a
   * call would mean standing up the spell registry, the content catalogue and
   * a `Game`; what actually needs holding is one line of coupling, so it is
   * held as one — the same shape `lanBootPath.test.ts` uses for
   * `loadGameScene`.
   */
  it('is what startNetClientMatch reaches for before dialling', () => {
    const source = readFileSync(
      join(__dirname, '../../../src/game/net/clientBoot.ts'),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).toContain('takeHeldRoom(request)');
    // And it must come *before* the connect, or the held channel is leaked
    // beside a second one nobody answers.
    expect(source.indexOf('takeHeldRoom')).toBeLessThan(
      source.indexOf('RtcClientTransport.connect')
    );
  });

  it('releases a held room nobody went on to play', async () => {
    const abort = new AbortController();
    const waiting = waitForHostToStart(request(), abort.signal);
    nextChannel.deliver(HELLO);
    await waiting;

    releaseHeldRoom();

    expect(nextChannel.closed).toBe(true);
    expect(takeHeldRoom(request())).toBeNull();
  });
});
