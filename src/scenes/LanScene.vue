<script setup lang="ts">
/**
 * The LAN lobby: create a room, or join one.
 *
 * ## Why it is a screen and not a drawer on the menu
 *
 * It was a drawer, and the drawer was the bug report. "Chơi", "Cấu Hình Trận
 * Đấu" and "Chơi LAN" were three identical `.hextech-btn`s, so nothing said
 * that two of them start a match and one opens a panel; the panel then unfolded
 * a *fourth* identical button ("Tạo phòng LAN") and put a room-code field at the
 * same level beside it, which made "create" and "join" — the one real choice on
 * this screen — read as a flat list of four equal things. Hosting took three
 * presses through three levels that all looked like the same level.
 *
 * A screen fixes it by having room for the thing a drawer had to compress: two
 * named sections, and a room code big enough to read out loud across a table.
 *
 * ## The URL is still the API
 *
 * This lobby writes the same `?net=host|join&room=…` parameters a hand-typed
 * link (or the e2e driver) writes, and then presses the ordinary play path — so
 * `GameScene.startGame`'s net arming stays the single seam and this component
 * never touches `src/game/`, which would be the banned menu→game chunk edge.
 * `scenes/lanSignal.ts` exists for exactly this boundary and is the only import
 * here that is not Vue.
 *
 * **Leaving disarms.** The old drawer wrote `?net=host` and left it written, so
 * collapsing the box and pressing Chơi silently started a LAN host instead of a
 * solo match — the design spec called clearing it "the player's job, or a future
 * lobby toggle's". This is that toggle: `Quay lại` strips the two parameters it
 * set, so on the menu Chơi always means Chơi. A hand-typed link is untouched
 * until the player opens this screen and backs out of it, which is a deliberate
 * gesture and reads as one.
 *
 * ## The poll is the advertisement
 *
 * `fetchLanRooms(url, announce)` lists rooms *and* registers ours in the same
 * request, so a room exists on the network the moment its code is on screen —
 * not once the match has started. That is why the poll runs for the whole life
 * of this screen rather than only while a list is visible, and why leaving
 * stops it: an un-advertised room ages out, which is the honest outcome of
 * walking away from it.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { DEFAULT_SIGNAL_URL, fetchLanRooms, randomRoomCode, type LanRoom } from './lanSignal';
// Type-only, and erased before Rollup sees it — the shape of one row of the
// room's player list. A *value* import from `@/game/` here would be the banned
// menu→game chunk edge; see the file header and `lanBootPath.test.ts`.
import type { LobbyPlayer } from '@/game/net/protocol';

const emit = defineEmits<{ close: []; play: []; openConfig: [] }>();

const rooms = ref<LanRoom[]>([]);
const joinCode = ref('');
const hostCode = ref<string | null>(null);
/**
 * The join in flight — and, the part this used to get wrong, **how far it has
 * actually got**.
 *
 * It was a bare room code set on the press, so the screen said *"Đã vào phòng
 * ABCDE"* before a single byte had left the machine, and went on saying it
 * while the handshake failed silently behind. Reported as *"client hiện đã
 * vào phòng, nhưng không thấy host"* — the screen was not describing a room,
 * it was describing a button press.
 *
 * `phase` is now the difference: `connecting` until `lobbyJoin` reports the
 * channel open (`onConnected`), `joined` after. Only the second one is
 * allowed to claim membership, because only then is the host's own list
 * showing this player too.
 */
const joining = ref<{ code: string; phase: 'connecting' | 'joined' } | null>(null);
const joinError = ref('');
/** The code a failed join was for, so the error can offer to try it again. */
const failedCode = ref('');
/**
 * Keep this room out of the public listing.
 *
 * `GET /rooms` used to group rooms by the host's public IP, so "only my
 * network sees my room" came free — and stopped working entirely on any
 * network that leaves through a pool of addresses (nine of them, measured
 * from one machine on one corporate wifi). One directory serves everybody
 * now, which finds people reliably and means a stranger can walk in. This is
 * the deliberate version of what the grouping used to do by accident.
 *
 * Read at Tạo phòng and baked into the signaling socket, so it is offered
 * *before* the room exists rather than as a switch on a live one — the broker
 * registers a room the moment its host connects, and un-advertising it after
 * the fact would be a promise this screen cannot keep.
 */
const privateRoom = ref(false);
/**
 * Who is in the room right now — the same list on every screen.
 *
 * The host builds it (`game/net/lobbyHost.ts`) and broadcasts it; a waiting
 * client receives it. Before this existed a host looked at a room code with no
 * way to tell whether anybody had arrived, so "wait for everyone, then start"
 * was something you did by shouting across the table.
 */
const players = ref<LobbyPlayer[]>([]);
/** Broker unreachable — one quiet line, and the poll backs off. */
const unreachable = ref(false);
const copied = ref(false);

let timer: number | null = null;
let copiedTimer: number | null = null;
let joinAbort: AbortController | null = null;
let failures = 0;

const signalUrl = (): string =>
  new URLSearchParams(window.location.search).get('signal') ?? DEFAULT_SIGNAL_URL;

/**
 * The wire, read back off the URL the same way `netRole.netRequestFromUrl`
 * reads it — this screen builds the request `lobbyJoin` connects with, and the
 * two must agree or the lobby would hold a WebRTC channel the match then tries
 * to take as a relay one (`takeHeldRoom` compares all three fields).
 */
const transportOf = (): 'rtc' | 'ws' =>
  new URLSearchParams(window.location.search).get('transport') === 'ws' ? 'ws' : 'rtc';

const stopPolling = (): void => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};

const refreshRooms = async (): Promise<void> => {
  // Our own poll advertises our own room (see the file header), and the list
  // then hides it again — a listing is other people's rooms. A private room
  // announces nothing: it is reachable by code alone, which is the whole of
  // what the toggle promises.
  const announce =
    hostCode.value && !privateRoom.value ? { code: hostCode.value, name: 'Trận LAN' } : undefined;
  const listed = await fetchLanRooms(signalUrl(), announce);
  if (listed === null) {
    unreachable.value = true;
    // Two strikes and the poll stops — an offline machine must not sit there
    // re-failing a fetch every four seconds. Re-entering the screen tries again.
    if (++failures >= 2) stopPolling();
    return;
  }
  unreachable.value = false;
  failures = 0;
  rooms.value = listed.filter(room => room.code !== hostCode.value);
};

const startPolling = (): void => {
  stopPolling();
  failures = 0;
  void refreshRooms();
  timer = window.setInterval(() => void refreshRooms(), 4000);
};

/** Arm the URL the way a hand-typed link would — the params ARE the API. */
const armNet = (mode: 'host' | 'join', room: string): void => {
  const params = new URLSearchParams(window.location.search);
  params.set('net', mode);
  params.set('room', room);
  history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
};

const disarmNet = (): void => {
  const params = new URLSearchParams(window.location.search);
  params.delete('net');
  params.delete('room');
  const query = params.toString();
  history.replaceState(
    null,
    '',
    query ? `${window.location.pathname}?${query}` : window.location.pathname
  );
};

/**
 * Open a room, and **hold it open from here** rather than at Vào trận.
 *
 * That is the change this button carries. The host used to connect to the
 * broker only when the match started, which meant it could not see who had
 * joined — and a client that joined first had nothing to talk to at all
 * (`lobbyJoin.ts` documents the timeout that produced). Now the wire is up
 * while the code is on screen, so both ends see the same list of people, and
 * `HostSession` *takes* this connection when the match starts instead of
 * dialling a second one the broker would treat as a new host.
 */
const createRoom = async (): Promise<void> => {
  if (hostCode.value) return;
  const code = randomRoomCode();
  armNet('host', code);
  hostCode.value = code;
  joinError.value = '';
  // Advertise now, not in four seconds — the next poll keeps it fresh.
  void refreshRooms();

  try {
    const { openRoom } = await import('@/game/net/lobbyHost');
    await openRoom(
      { mode: 'host', server: signalUrl(), room: code, transport: transportOf() },
      list => (players.value = list),
      { listed: !privateRoom.value }
    );
  } catch (error) {
    console.warn('net: could not open the room', error);
    // A room nobody can reach is not a room. Fall back to the idle state
    // rather than showing a code that will never answer.
    hostCode.value = null;
    players.value = [];
    disarmNet();
    joinError.value = 'Không mở được phòng — chưa kết nối được máy chủ ghép trận.';
    // The poll already advertised this code (`createRoom` refreshes before
    // dialling, so the room appears the instant it is on screen). That was a
    // room that then failed to open, and leaving it advertised offers every
    // other screen a room nobody can join — the state this catch exists to
    // undo. One listing without the announce drops it inside ANNOUNCE_STALE_MS.
    void refreshRooms();
  }
};

const closeHostedRoom = async (): Promise<void> => {
  const { closeRoom } = await import('@/game/net/lobbyHost');
  closeRoom();
};

const cancelRoom = (): void => {
  hostCode.value = null;
  players.value = [];
  void closeHostedRoom();
  disarmNet();
  void refreshRooms();
};

const copyCode = async (): Promise<void> => {
  const code = hostCode.value;
  if (!code) return;
  try {
    // Absent over plain http and refusable everywhere; the code is on screen
    // either way, so a failure is silent rather than an error the player can
    // do nothing about.
    await navigator.clipboard?.writeText(code);
    copied.value = true;
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* no clipboard — the code is readable on screen */
  }
};

/**
 * Join a room and **wait here** until the host starts.
 *
 * This used to arm the URL and go straight to `GameScene`, which is the bug
 * the waiting state exists for: a host that has made a room but not pressed
 * Vào trận is not connected to the broker at all, so the client's handshake
 * had nothing to answer it and died after fifteen seconds on a loading
 * screen — *"is the host still up?"* about a host sitting two feet away
 * looking at its own room code.
 *
 * The wait belongs on this screen, next to the host's. `waitForHostToStart`
 * (`game/net/lobbyJoin.ts`) holds the connection open with no deadline and
 * hands it to the match when the hello finally lands.
 *
 * The import is **dynamic**, and has to be: that module reaches the transports
 * and the protocol, i.e. `src/game/`, and a static import would put the whole
 * match in this screen's chunk — the edge `lanBootPath.test.ts` and
 * `chunks:check` both guard. By the time anyone presses Vào, the menu's
 * warm-up has already fetched that chunk anyway.
 */
/**
 * Why the join failed, said in terms of the thing the player can act on.
 *
 * One message covered every failure before this — *"Mất kết nối tới máy chủ
 * ghép trận"* for a broker that was answering perfectly well, because the
 * regex behind it matched the word "failed" in an error about ICE. Three
 * different problems with three different fixes were reported as the one
 * problem the player could do least about.
 */
/** The room said no, as opposed to the room not answering. */
const wasKicked = (error: unknown): boolean =>
  error instanceof Error && /kicked from the room/i.test(error.message);

const joinFailureMessage = (error: unknown, room: string): string => {
  const detail = error instanceof Error ? error.message : '';
  // Ordered most specific first: several of these strings contain "timed out"
  // or "closed" and the broadest test would swallow the rest.
  //
  // The kick leads, because it is the one failure here that is not a fault:
  // nothing is wrong with the network, the code or the room, and telling
  // somebody who was just removed to "check the code" sends them round a loop
  // that cannot end. It is also the only one where retrying is the wrong
  // advice, so the text does not offer any.
  if (/kicked from the room/i.test(detail)) {
    return 'Chủ phòng đã mời bạn ra khỏi phòng.';
  }
  if (/no route|blocks direct/i.test(detail)) {
    return 'Vào được phòng nhưng mạng này chặn kết nối trực tiếp giữa hai máy. Thử mạng khác, hoặc phát 4G rồi cho cả hai máy vào chung.';
  }
  if (/handshake timed out|timed out waiting/i.test(detail)) {
    return `Phòng ${room} không trả lời. Kiểm tra lại mã, hoặc chờ chủ phòng bấm Tạo phòng trước.`;
  }
  if (/relay connect|relay connection/i.test(detail)) {
    // The socket never opened. Distinguished from the two below because it is
    // the one that is usually *not* about this room: a filter or proxy that
    // passes the listing's plain HTTPS and refuses the WebSocket upgrade
    // presents exactly here, with a room that looks perfectly joinable in the
    // list because the listing rides the other protocol.
    return 'Không mở được kết nối tới máy chủ ghép trận. Mạng này có thể chặn WebSocket.';
  }
  if (/signaling closed|peer connection closed/i.test(detail)) {
    return 'Máy chủ ghép trận ngắt kết nối giữa chừng. Thử lại sau giây lát.';
  }
  return 'Không vào được phòng này.';
};

const joinRoom = async (code: string): Promise<void> => {
  if (!code || joining.value) return;
  const room = code.toUpperCase();
  armNet('join', room);

  const controller = new AbortController();
  joinAbort = controller;
  joining.value = { code: room, phase: 'connecting' };
  joinError.value = '';
  failedCode.value = '';
  players.value = [];
  // Our own room advertisement is not ours any more, and the list underneath
  // is not what this screen is showing.
  stopPolling();

  try {
    const { waitForHostToStart } = await import('@/game/net/lobbyJoin');
    await waitForHostToStart(
      { mode: 'join', server: signalUrl(), room, transport: transportOf() },
      controller.signal,
      {
        // The one moment "đã vào phòng" becomes true. Guarded on the same
        // controller as everything else, so a cancel racing the handshake
        // cannot promote a screen the player has already left.
        onConnected: () => {
          if (!controller.signal.aborted && joining.value) {
            joining.value = { code: room, phase: 'joined' };
          }
        },
        onRoster: list => (players.value = list),
      }
    );
    if (controller.signal.aborted) return;
    emit('play');
  } catch (error) {
    if (controller.signal.aborted) return;
    // The screen states a cause in the player's terms, which necessarily
    // throws away the one string that says which cause it actually was. Keep
    // it where somebody debugging can reach it: four different failures share
    // one sentence up there, and without this the only way to tell them apart
    // is to guess.
    console.warn('net: join failed', error);
    joining.value = null;
    joinError.value = joinFailureMessage(error, room);
    // Every failure here offers "Thử lại <code>" except the one that is not a
    // failure. A player the host just removed is not looking at a room that
    // went wrong, and a retry button in front of them is an invitation to walk
    // back into a door that was closed on purpose — and, if they take it, to be
    // removed again. The way back in is the host letting them in.
    failedCode.value = wasKicked(error) ? '' : room;
    disarmNet();
    startPolling();
  } finally {
    if (joinAbort === controller) joinAbort = null;
  }
};

const retryJoin = (): void => {
  const code = failedCode.value;
  if (code) void joinRoom(code);
};

const cancelJoin = (): void => {
  joinAbort?.abort();
  joinAbort = null;
  joining.value = null;
  joinError.value = '';
  failedCode.value = '';
  players.value = [];
  disarmNet();
  startPolling();
};

const startHostedMatch = (): void => {
  if (!hostCode.value) return;
  emit('play');
};

const goBack = (): void => {
  // A wait in progress is a socket the broker still counts as a joiner, so
  // leaving has to cancel it — otherwise the host sees somebody in the room
  // who has gone back to the menu. The mirror of that is a room left open:
  // a host that walks away must take its room with it, or the list on every
  // other machine keeps offering a room nobody will ever start.
  joinAbort?.abort();
  joinAbort = null;
  if (hostCode.value) void closeHostedRoom();
  // Only what this screen armed. See the file header: a match reached from
  // here is entered through `play`, which never comes past this line.
  disarmNet();
  emit('close');
};

/**
 * The player list, with a label that tells two rows apart.
 *
 * The name a device reports is the champion it has picked, and the default is
 * "Ngẫu nhiên" — so a fresh room lists two identical rows and says nothing
 * about who is who. The position does: the host is the host, and everyone
 * else is numbered in arrival order. On the host's own screen its row says
 * "Bạn", which is the only row any screen can name with certainty (a client
 * is not told which row is itself, and the list is short enough that it does
 * not need to be).
 */
/**
 * …and the row that says what went wrong with it.
 *
 * `link` is set only on a peer that is mid-handshake or one whose handshake
 * died (`game/net/protocol.ts`). It reaches this screen on the host's side
 * only — a client is shown a roster of people who are, by definition,
 * connected — and it exists because the alternative was a room that rendered
 * "somebody cannot reach you" and "nobody has come" as the same empty list.
 */
const playerRows = computed(() => {
  let seat = 1;
  return players.value.map(player => {
    const failed = player.link === 'failed';
    return {
      id: player.id,
      isHost: player.host === true,
      // Only a host has anybody to remove, and never itself. A client's copy
      // of this list is other people's business.
      canKick: hostCode.value !== null && player.host !== true,
      role: player.host
        ? hostCode.value
          ? 'Bạn · chủ phòng'
          : 'Chủ phòng'
        : `Người chơi ${++seat}`,
      // A row whose link died shows what happened to it rather than the name
      // it never got as far as sending.
      name: failed ? 'Không nối được' : player.name,
      failed,
      icon: player.host
        ? 'fas fa-crown'
        : failed
          ? 'fas fa-triangle-exclamation'
          : player.link === 'connecting'
            ? 'fas fa-circle-notch fa-spin'
            : 'fas fa-user',
    };
  });
});

/**
 * Remove one joiner from the room.
 *
 * The lobby half of a control the match already had — before this there was no
 * way to remove anybody from a room at all, so a stranger who wandered in off
 * the public listing, or the ghost of a phone that went into a tunnel, simply
 * stayed. `openRoom`'s own `kick` does the telling and the dropping; this only
 * has to ask, because the roster comes back as an ordinary broadcast.
 */
const kickPlayer = async (peerId: string): Promise<void> => {
  const { kickFromRoom } = await import('@/game/net/lobbyHost');
  kickFromRoom(peerId);
};

/** Somebody reached the room and could not be reached back — worth explaining. */
const anyLinkFailed = computed(() => players.value.some(player => player.link === 'failed'));

/** Spaced so a five-letter code is read out one character at a time. */
const spacedCode = computed(() => (hostCode.value ?? '').split('').join(' '));

const canJoinTyped = computed(() => joinCode.value.trim().length > 0);

onMounted(startPolling);
onUnmounted(() => {
  stopPolling();
  // Deliberately *not* aborting a join here: `emit('play')` unmounts this
  // component on the way into the match, and the connection it is holding is
  // exactly what `startNetClientMatch` is about to take (`lobbyJoin.ts`).
  // Every path that abandons a wait — Huỷ, Quay lại — cancels it explicitly.
  if (copiedTimer !== null) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="lan-panel">
    <header class="lan-header">
      <div class="lan-title">
        <h1>Chơi online</h1>
        <!-- The one condition on the whole screen, so it is stated under the
             title rather than as a hint beside one control: the room list is
             one global directory (docs/TRAPS.md), so a room being *visible*
             says nothing about it being *reachable* — two machines on
             different networks will see each other here and fail to connect,
             which is exactly the bug report this line exists to prevent. -->
        <p class="lan-subtitle">
          <i class="fas fa-wifi" aria-hidden="true"></i>
          Hai máy cần chung một wifi
        </p>
      </div>
      <!-- Both `@click` and `@touchend.prevent` on every control on this
           screen, the same rule the menu and the HUD follow: once a
           `GameScene` has existed it calls `preventDefault()` on every touch
           on the page, so a click-only handler is dead under a thumb. -->
      <button type="button" class="lan-close" id="lan-close" title="Quay lại" @click="goBack"
        @touchend.prevent="goBack">
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
      </button>
    </header>

    <!-- Waiting for the host takes the whole screen, not a line under the
         controls: while it is running there is nothing else to do here, and a
         room list still offering other rooms underneath would be inviting the
         player to abandon a wait they just started. -->
    <div v-if="joining" class="lan-body lan-waiting" id="lan-waiting">
      <i class="fas fa-circle-notch fa-spin lan-waiting-spinner" aria-hidden="true"></i>
      <!-- Two claims, and only the second one is about a room. Saying "đã vào
           phòng" during the handshake is what made a failed join look like a
           successful one for as long as anybody cared to watch. -->
      <p class="lan-waiting-room">
        <template v-if="joining.phase === 'connecting'">
          Đang kết nối tới phòng <b>{{ joining.code }}</b>
        </template>
        <template v-else>
          Đã vào phòng <b>{{ joining.code }}</b>
        </template>
      </p>
      <p class="lan-waiting-hint">
        {{
          joining.phase === 'connecting'
            ? 'Đang nối với máy của chủ phòng…'
            : 'Chờ chủ phòng bắt đầu trận…'
        }}
      </p>

      <!-- The same list the host is looking at. Empty until the host's first
           broadcast lands, which is a fraction of a second on a LAN and never
           at all if the host is already in a match — in which case this whole
           screen is gone by the next frame anyway. -->
      <ul v-if="playerRows.length" class="lan-players" id="lan-players">
        <li v-for="player of playerRows" :key="player.id" class="lan-player">
          <i :class="player.isHost ? 'fas fa-crown' : 'fas fa-user'" aria-hidden="true"></i>
          <span class="lan-player-role">{{ player.role }}</span>
          <span class="lan-player-name">{{ player.name }}</span>
        </li>
      </ul>

      <button type="button" class="lan-ghost" id="lan-cancel-join" @click="cancelJoin" @touchend.prevent="cancelJoin">
        Huỷ
      </button>
    </div>

    <div v-else class="lan-body">
      <div v-if="joinError" class="lan-error" id="lan-error">
        <span>{{ joinError }}</span>
        <!-- A failed join is very often a transient one — an ICE round that
             lost a race, a host that pressed Tạo phòng a second too late — and
             re-typing the code to find out is a chore this screen can spare. -->
        <button v-if="failedCode" type="button" class="lan-retry" id="lan-retry" @click="retryJoin"
          @touchend.prevent="retryJoin">
          <i class="fas fa-rotate-right" aria-hidden="true"></i>
          Thử lại {{ failedCode }}
        </button>
      </div>

      <section class="lan-section">
        <h2 class="lan-section-title">Tạo phòng</h2>

        <template v-if="hostCode">
          <!-- The code is the point of this state, so it is the biggest thing
               in it — big enough to read across a table, which is the actual
               situation. Tapping copies; the label under it says so, and says
               what happened after. -->
          <button type="button" class="lan-code-card" id="lan-code" :data-code="hostCode"
            :title="`Sao chép mã ${hostCode}`" @click="copyCode" @touchend.prevent="copyCode">
            <span class="lan-code-value">{{ spacedCode }}</span>
            <span class="lan-code-hint">
              <i :class="copied ? 'fas fa-check' : 'fas fa-copy'" aria-hidden="true"></i>
              {{ copied ? 'Đã sao chép' : 'Bấm để sao chép' }}
            </span>
          </button>

          <!-- Which of the two kinds of room this is. The choice was made on
               the previous screen state and cannot be changed without
               reopening, so this states it rather than offering it. -->
          <p class="lan-listing-state">
            <i :class="privateRoom ? 'fas fa-lock' : 'fas fa-globe'" aria-hidden="true"></i>
            {{ privateRoom ? 'Phòng riêng — chỉ vào bằng mã' : 'Phòng công khai' }}
          </p>

          <!-- Who is actually in the room. The host holds the wire open from
               Tạo phòng now (`game/net/lobbyHost.ts`), so this is live: a
               friend appears the moment they press Vào, and disappears if
               they back out. It is the answer to "bấm Vào trận lúc nào" —
               previously a question nothing on screen could answer. -->
          <div class="lan-players-block">
            <span class="lan-players-title">Người chơi ({{ playerRows.length }})</span>
            <ul class="lan-players" id="lan-players">
              <li v-for="player of playerRows" :key="player.id" class="lan-player"
                :class="{ 'lan-player-failed': player.failed }">
                <i :class="player.icon" aria-hidden="true"></i>
                <span class="lan-player-role">{{ player.role }}</span>
                <span class="lan-player-name">{{ player.name }}</span>
                <!-- The host's own list, so this is where the control belongs;
                     the block above renders the same rows for a *joiner*, whose
                     copy is other people's business. `@touchend.prevent` beside
                     `@click` like every control here. -->
                <button v-if="player.canKick" type="button" class="lan-player-kick"
                  :aria-label="`Mời ${player.name} ra khỏi phòng`" @click="void kickPlayer(player.id)"
                  @touchend.prevent="void kickPlayer(player.id)">
                  <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
              </li>
            </ul>
            <!-- The whole point of tracking the handshake: a room that cannot
                 say this shows an empty list and lets the host conclude that
                 nobody tried. -->
            <p v-if="anyLinkFailed" class="lan-hint lan-hint-warn">
              Có người vào nhưng hai máy không nối được. Wifi công ty hay wifi khách thường chặn —
              thử chung một wifi khác.
            </p>
          </div>

          <!-- Only once somebody is actually waiting, which is when "bấm Vào
               trận bây giờ hay chờ thêm?" is a live question. In an empty room
               the line above already says what to do, and two paragraphs of
               advice is what pushed this panel past a portrait phone. -->
          <p v-if="playerRows.length > 1" class="lan-hint">
            Ai vào trễ sẽ được thả thẳng vào trận, không phải chờ.
          </p>

          <button type="button" class="lan-primary" id="lan-start-host" @click="startHostedMatch"
            @touchend.prevent="startHostedMatch">
            Vào trận
          </button>
          <!-- The host sets the rules while people are still arriving, rather
               than in front of them: everyone in the room is waiting on this
               screen, so a config step *between* Vào trận and the match would
               make them all wait through it. A LAN match is
               host-authoritative, so this is the only device whose settings
               count — a client's own panel locks them (`canEditMatchSettings`). -->
          <button type="button" class="lan-ghost" id="lan-config-host" @click="emit('openConfig')"
            @touchend.prevent="emit('openConfig')">
            <i class="fas fa-sliders" aria-hidden="true"></i>
            Cấu hình trận
          </button>
          <button type="button" class="lan-ghost" id="lan-cancel-host" @click="cancelRoom"
            @touchend.prevent="cancelRoom">
            Huỷ phòng
          </button>
        </template>

        <template v-else>
          <button type="button" class="lan-primary" id="lan-host" @click="createRoom" @touchend.prevent="createRoom">
            <i class="fas fa-plus" aria-hidden="true"></i>
            Tạo phòng mới
          </button>

          <!-- Offered before the room exists, not as a switch on a live one:
               the broker registers a room the moment its host connects, so
               un-advertising it afterwards is a promise this screen could not
               keep. `@touchend` beside `@click` for the reason every control
               on this screen has both. -->
          <button type="button" class="lan-toggle" id="lan-private" role="switch" :aria-checked="privateRoom"
            @click="privateRoom = !privateRoom" @touchend.prevent="privateRoom = !privateRoom">
            <i :class="privateRoom ? 'fas fa-toggle-on' : 'fas fa-toggle-off'" aria-hidden="true"></i>
            Phòng riêng
          </button>

          <p class="lan-hint">
            {{
              privateRoom
                ? 'Không hiện trong danh sách. Chỉ vào bằng mã.'
                : 'Hiện trong danh sách bên dưới, không cần mã.'
            }}
          </p>
        </template>
      </section>

      <section v-if="!hostCode" class="lan-section">
        <h2 class="lan-section-title">Vào phòng</h2>

        <div class="lan-rooms" id="lan-rooms">
          <p v-if="unreachable" class="lan-empty">Không kết nối được máy chủ.</p>
          <p v-else-if="rooms.length === 0" class="lan-empty">
            <i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
            Chưa có phòng nào…
          </p>
          <button v-for="room in rooms" :key="room.code" type="button" class="lan-room" :data-room="room.code"
            @click="joinRoom(room.code)" @touchend.prevent="joinRoom(room.code)">
            <i class="fas fa-wifi" aria-hidden="true"></i>
            <span class="lan-room-name">{{ room.name }}</span>
            <span class="lan-room-code">{{ room.code }}</span>
          </button>
        </div>

        <!-- The fallback, and labelled as one: the list above is how this is
             meant to work, and typing a code is what you do for a private
             room, or when the listing — one global directory — carries too
             many rooms to find the right one by name. -->
        <div class="lan-join-code">
          <input v-model="joinCode" maxlength="8" placeholder="Hoặc nhập mã phòng" aria-label="Mã phòng LAN"
            spellcheck="false" autocapitalize="characters" />
          <button type="button" id="lan-join" :disabled="!canJoinTyped" @click="joinRoom(joinCode.trim())"
            @touchend.prevent="joinRoom(joinCode.trim())">
            Vào
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style>
#lan-start-host {
  margin-top: 10px;
}
</style>
