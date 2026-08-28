import { RelayClientTransport, type ClientTransport } from './transport';
import { RtcClientTransport } from './RtcTransport';
import { decodeMessage, encodeMessage, type LobbyPlayer, type NetMessage } from './protocol';
import type { NetUrlRequest } from './netRole';
import { lobbyDisplayName } from './lobbyName';
import { netSeat } from './netSeat';
import { readInstalledPacks } from '@/content/installedPackStore';

/**
 * Joining a LAN room **before the host has started the match**.
 *
 * This is the half the lobby was missing. Pressing Vào used to arm
 * `?net=join&room=…` and go straight to `GameScene`, which connected and
 * waited 15 seconds for a host that was still sitting in its own lobby with
 * the room code on screen — so the perfectly ordinary case of "make a room,
 * tell your friend the code, they join, then you start" ended in
 * *"net: WebRTC handshake timed out — is the host still up?"* on a loading
 * screen, for a host that was very much up.
 *
 * Nothing about the wire was wrong. The broker already replays `sys:joined`
 * to a host that connects late — both the deployed Worker and
 * `scripts/net-relay.mjs` do it deliberately, and the LAN design spec says
 * so — so a joiner who simply waits *is* the supported flow. Two 15-second
 * deadlines and the fact that the waiting happened inside the match were the
 * whole bug.
 *
 * So the wait moves into the lobby, where both players are already standing:
 * the host looking at its code, the client looking at "đang chờ chủ phòng".
 * When the host presses Vào trận its `HostSession` connects, the broker
 * replays the join, the offer goes out, and the hello lands here.
 *
 * ## The connection is handed over, not remade
 *
 * By the time the hello arrives this module holds a live transport with the
 * host's opening events already queued behind it. Reconnecting from
 * `GameScene` would throw that away and put the client back at the start of a
 * handshake the host has already answered — and the second hello it would
 * need has already been sent. So the pair is parked in `held` and
 * `startNetClientMatch` takes it (`takeHeldRoom`) instead of dialling again.
 *
 * Module state, not a parameter, for the reason `netRole` is: the path from
 * here to `GameScene.startGame` is a scene transition and a URL, and threading
 * a live socket through that would mean the menu's chunk knowing what a socket
 * is. `LanScene.vue` reaches this module through a **dynamic** import for the
 * same reason (`tests/scenes/lanBootPath.test.ts`).
 */

export type HelloMessage = Extract<NetMessage, { t: 'hello' }>;

/**
 * How long the *handshake* may take before the join is called a failure.
 *
 * This wait used to be unbounded along with the hello's, and that was right
 * when it was written: the host reached the broker only at Vào trận, so no
 * offer could exist before it pressed. `lobbyHost.ts` moved the host's
 * connection to Tạo phòng, and silence stopped meaning "not yet". An open room
 * answers in seconds; a handshake still running after this long is a mistyped
 * code, a room nobody opened, or a network that blocks peer-to-peer — three
 * things a player can act on and none of which they can see from a spinner.
 *
 * Generous on purpose: ICE gathering behind a slow DNS or a captive portal can
 * take its time, and the cost of waiting too long is a slower error message,
 * while the cost of waiting too little is a working join thrown away.
 */
const HANDSHAKE_TIMEOUT_MS = 25_000;

/** What the lobby screen wants to be told while a join is in flight. */
export interface JoinProgress {
  /**
   * The channel is up: the host's own transport has this player on its list,
   * and "đã vào phòng" is true for the first time. The screen says it before
   * this only by guessing, which is what it used to do.
   */
  onConnected?(): void;
  /** The room's player list, each time the host broadcasts a new one. */
  onRoster?(players: LobbyPlayer[]): void;
}

export interface HeldRoom {
  request: NetUrlRequest;
  channel: ClientTransport;
  hello: HelloMessage;
}

let held: HeldRoom | null = null;

const sameRoom = (a: NetUrlRequest, b: NetUrlRequest): boolean =>
  a.room === b.room && a.server === b.server && a.transport === b.transport;

/**
 * The lobby's live connection, or `null` if this match was not reached
 * through the lobby — a hand-typed `?net=join&room=…` straight into Chơi
 * still connects for itself, with the ordinary deadlines.
 *
 * Takes it: a second call answers `null`, because the returned channel now
 * belongs to the `ClientSession` built from it.
 */
export const takeHeldRoom = (request: NetUrlRequest): HeldRoom | null => {
  if (!held || !sameRoom(held.request, request)) return null;
  const room = held;
  held = null;
  return room;
};

/** Drop a held room nobody went on to play — the lobby's own cleanup. */
export const releaseHeldRoom = (): void => {
  held?.channel.close();
  held = null;
};

const helloIn = (raw: string): HelloMessage | null => {
  const message = decodeMessage(raw);
  return message?.t === 'hello' ? (message as HelloMessage) : null;
};

/**
 * The hello, and the room's player list while waiting for it.
 *
 * `waitFor` cannot do both: it removes the one frame it matched and leaves
 * everything else queued, with no way to look at what it passed over. So the
 * wait is its own drain loop — and every frame that is neither the hello nor
 * a lobby list goes straight back (`pushBack`), because from the hello onward
 * the stream belongs to the `ClientSession` that has not been built yet and a
 * dropped opening event is a unit that never appears.
 *
 * The scan stops at the hello for the same reason: frames *after* it in the
 * same drain are the match's, not the lobby's.
 */
const waitForHello = async (
  channel: ClientTransport,
  onRoster: (players: LobbyPlayer[]) => void
): Promise<HelloMessage> => {
  for (;;) {
    const frames = channel.drain();
    let hello: HelloMessage | null = null;
    const rest: string[] = [];
    for (const raw of frames) {
      if (hello) {
        rest.push(raw);
        continue;
      }
      const message = decodeMessage(raw);
      if (message?.t === 'hello') {
        hello = message as HelloMessage;
      } else if (message?.t === 'kicked') {
        // The host removed us. Not an error to retry — the room said no — so
        // the wait ends here rather than sitting on a channel the host has
        // already forgotten. A relay joiner learns it only this way: the relay
        // has no frame for one client closing another's socket.
        channel.close();
        throw new Error('net: chủ phòng đã mời bạn ra khỏi phòng');
      } else if (message?.t === 'lobby') {
        onRoster(message.players);
      } else {
        rest.push(raw);
      }
    }
    channel.pushBack(rest);
    if (hello) return hello;
    if (channel.closed) throw new Error('net: peer connection closed while waiting');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

/**
 * Connect to `request`'s room and wait — with no deadline — until the host
 * starts the match, reporting the room's player list as it changes.
 *
 * Resolves once the hello is in hand and the connection is parked for
 * `startNetClientMatch`; the caller's next move is to enter the match. When
 * the host has *already* started there is no lobby to sit in: the hello is
 * waiting on the wire, this resolves on the first pass, and the client goes
 * straight into the game — which is the intended behaviour for a late joiner.
 *
 * Rejects on a broker that cannot be reached, a signaling socket that dies,
 * or `abort` — the lobby's Huỷ button, which matters more than it looks:
 * without it a cancelled join leaves a socket the broker still counts, and
 * the host sees a joiner who is not there.
 */
/**
 * Who is joining: the display name, the seat, and what content this machine
 * has.
 *
 * One builder rather than a literal at each call site, because the two sites
 * are the lobby's join and `clientBoot`'s hand-typed `?net=join`, and a seat
 * sent from only one of them is a reconnect that works from the room list and
 * not from a URL — the kind of split nobody finds until it matters.
 *
 * `packs` is the mirror of `hello.packs`: the host is *offered* what this
 * client has, so a host whose client picked a champion from an unfamiliar pack
 * can install it rather than drawing a placeholder for the rest of the match.
 * Offered, not installed — see `content/peerPacks.ts`.
 */
export const iamMessage = (): Extract<NetMessage, { t: 'iam' }> => ({
  t: 'iam',
  name: lobbyDisplayName(),
  seat: netSeat(),
  packs: readInstalledPacks().map(record => record.manifestUrl),
});

export const waitForHostToStart = async (
  request: NetUrlRequest,
  abort: AbortSignal,
  progress: JoinProgress = {}
): Promise<void> => {
  releaseHeldRoom();

  const channel =
    request.transport === 'ws'
      ? await RelayClientTransport.connect(request.server, request.room)
      : await RtcClientTransport.connect(request.server, request.room, {
          timeoutMs: HANDSHAKE_TIMEOUT_MS,
          abort,
        });
  // Past the `await`, so it is a report and not a hope. Everything the screen
  // says about being in a room hangs off this line.
  progress.onConnected?.();

  // `RelayClientTransport` has no abort of its own — it is the dev/e2e wire and
  // its connect is a plain socket open — so the cancel is applied here, and the
  // race between "aborted while connecting" and "connected" is settled by
  // re-checking after the await.
  const onAbort = (): void => channel.close();
  if (abort.aborted) {
    channel.close();
    throw new Error('net: join cancelled');
  }
  abort.addEventListener('abort', onAbort, { once: true });

  try {
    // Announce before waiting. A host still in its lobby answers with the
    // room's list; a host already in a match reads the *seat* and decides
    // whether this is somebody it already has a champion for. One message,
    // both cases — and it must go before the wait, because the host holds a
    // joining peer for `SEAT_GRACE_MS` precisely to hear this.
    channel.send(encodeMessage(iamMessage()));
    // No deadline. This is the wait the whole module exists for: the host may
    // be one press away or five minutes away, and neither is an error.
    const hello = await waitForHello(channel, progress.onRoster ?? (() => {}));
    held = { request, channel, hello };
  } catch (error) {
    channel.close();
    throw abort.aborted ? new Error('net: join cancelled') : error;
  } finally {
    abort.removeEventListener('abort', onAbort);
  }
};
