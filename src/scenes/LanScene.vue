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

const emit = defineEmits<{ close: []; play: [] }>();

const rooms = ref<LanRoom[]>([]);
const joinCode = ref('');
const hostCode = ref<string | null>(null);
/** The room code this client is sitting in, waiting for its host. */
const joining = ref<string | null>(null);
const joinError = ref('');
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
  // then hides it again: "phòng cùng mạng" means somebody else's.
  const announce = hostCode.value ? { code: hostCode.value, name: 'Trận LAN' } : undefined;
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
      list => (players.value = list)
    );
  } catch {
    // A room nobody can reach is not a room. Fall back to the idle state
    // rather than showing a code that will never answer.
    hostCode.value = null;
    players.value = [];
    disarmNet();
    joinError.value = 'Không mở được phòng — chưa kết nối được máy chủ ghép trận.';
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
const joinRoom = async (code: string): Promise<void> => {
  if (!code || joining.value) return;
  const room = code.toUpperCase();
  armNet('join', room);

  const controller = new AbortController();
  joinAbort = controller;
  joining.value = room;
  joinError.value = '';
  players.value = [];
  // Our own room advertisement is not ours any more, and the list underneath
  // is not what this screen is showing.
  stopPolling();

  try {
    const { waitForHostToStart } = await import('@/game/net/lobbyJoin');
    await waitForHostToStart(
      { mode: 'join', server: signalUrl(), room, transport: transportOf() },
      controller.signal,
      list => (players.value = list)
    );
    if (controller.signal.aborted) return;
    emit('play');
  } catch (error) {
    if (controller.signal.aborted) return;
    joining.value = null;
    joinError.value =
      error instanceof Error && /unreachable|closed|timeout|failed/i.test(error.message)
        ? 'Mất kết nối tới máy chủ ghép trận.'
        : 'Không vào được phòng này.';
    disarmNet();
    startPolling();
  } finally {
    if (joinAbort === controller) joinAbort = null;
  }
};

const cancelJoin = (): void => {
  joinAbort?.abort();
  joinAbort = null;
  joining.value = null;
  joinError.value = '';
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
const playerRows = computed(() => {
  let seat = 1;
  return players.value.map(player => ({
    id: player.id,
    isHost: player.host === true,
    role: player.host ? (hostCode.value ? 'Bạn · chủ phòng' : 'Chủ phòng') : `Người chơi ${++seat}`,
    name: player.name,
  }));
});

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
      <h1>Chơi với bạn</h1>
      <!-- Both `@click` and `@touchend.prevent` on every control on this
           screen, the same rule the menu and the HUD follow: once a
           `GameScene` has existed it calls `preventDefault()` on every touch
           on the page, so a click-only handler is dead under a thumb. -->
      <button
        type="button"
        class="lan-close"
        id="lan-close"
        title="Quay lại"
        @click="goBack"
        @touchend.prevent="goBack"
      >
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
      </button>
    </header>

    <!-- Waiting for the host takes the whole screen, not a line under the
         controls: while it is running there is nothing else to do here, and a
         room list still offering other rooms underneath would be inviting the
         player to abandon a wait they just started. -->
    <div v-if="joining" class="lan-body lan-waiting" id="lan-waiting">
      <i class="fas fa-circle-notch fa-spin lan-waiting-spinner" aria-hidden="true"></i>
      <p class="lan-waiting-room">
        Đã vào phòng <b>{{ joining }}</b>
      </p>
      <p class="lan-waiting-hint">Đang chờ chủ phòng bắt đầu trận…</p>

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

      <button
        type="button"
        class="lan-ghost"
        id="lan-cancel-join"
        @click="cancelJoin"
        @touchend.prevent="cancelJoin"
      >
        Huỷ
      </button>
    </div>

    <div v-else class="lan-body">
      <p v-if="joinError" class="lan-error" id="lan-error">{{ joinError }}</p>

      <section class="lan-section">
        <h2 class="lan-section-title">Tạo phòng</h2>

        <template v-if="hostCode">
          <!-- The code is the point of this state, so it is the biggest thing
               in it — big enough to read across a table, which is the actual
               situation. Tapping copies; the label under it says so, and says
               what happened after. -->
          <button
            type="button"
            class="lan-code-card"
            id="lan-code"
            :data-code="hostCode"
            :title="`Sao chép mã ${hostCode}`"
            @click="copyCode"
            @touchend.prevent="copyCode"
          >
            <span class="lan-code-value">{{ spacedCode }}</span>
            <span class="lan-code-hint">
              <i :class="copied ? 'fas fa-check' : 'fas fa-copy'" aria-hidden="true"></i>
              {{ copied ? 'Đã sao chép' : 'Bấm để sao chép mã' }}
            </span>
          </button>

          <!-- Who is actually in the room. The host holds the wire open from
               Tạo phòng now (`game/net/lobbyHost.ts`), so this is live: a
               friend appears the moment they press Vào, and disappears if
               they back out. It is the answer to "bấm Vào trận lúc nào" —
               previously a question nothing on screen could answer. -->
          <div class="lan-players-block">
            <span class="lan-players-title">Người chơi ({{ playerRows.length }})</span>
            <ul class="lan-players" id="lan-players">
              <li v-for="player of playerRows" :key="player.id" class="lan-player">
                <i :class="player.isHost ? 'fas fa-crown' : 'fas fa-user'" aria-hidden="true"></i>
                <span class="lan-player-role">{{ player.role }}</span>
                <span class="lan-player-name">{{ player.name }}</span>
              </li>
            </ul>
            <p v-if="players.length <= 1" class="lan-hint">
              Chưa ai vào. Đọc mã trên cho bạn bè, hoặc để họ chọn phòng trong danh sách cùng mạng.
            </p>
          </div>

          <!-- Only once somebody is actually waiting, which is when "bấm Vào
               trận bây giờ hay chờ thêm?" is a live question. In an empty room
               the line above already says what to do, and two paragraphs of
               advice is what pushed this panel past a portrait phone. -->
          <p v-if="playerRows.length > 1" class="lan-hint">
            Người vào sau khi trận đã bắt đầu sẽ được thả thẳng vào trận, không phải chờ.
          </p>

          <button
            type="button"
            class="lan-primary"
            id="lan-start-host"
            @click="startHostedMatch"
            @touchend.prevent="startHostedMatch"
          >
            Vào trận
          </button>
          <button
            type="button"
            class="lan-ghost"
            id="lan-cancel-host"
            @click="cancelRoom"
            @touchend.prevent="cancelRoom"
          >
            Huỷ phòng
          </button>
        </template>

        <template v-else>
          <button
            type="button"
            class="lan-primary"
            id="lan-host"
            @click="createRoom"
            @touchend.prevent="createRoom"
          >
            <i class="fas fa-plus" aria-hidden="true"></i>
            Tạo phòng mới
          </button>
          <p class="lan-hint">
            Máy cùng mạng sẽ thấy phòng ngay, khỏi cần gõ mã. Ở mạng khác thì đọc mã cho bạn bè.
          </p>
        </template>
      </section>

      <section v-if="!hostCode" class="lan-section">
        <h2 class="lan-section-title">Vào phòng</h2>

        <div class="lan-rooms" id="lan-rooms">
          <p v-if="unreachable" class="lan-empty">Không kết nối được máy chủ ghép trận.</p>
          <p v-else-if="rooms.length === 0" class="lan-empty">
            <i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
            Chưa thấy phòng cùng mạng…
          </p>
          <button
            v-for="room in rooms"
            :key="room.code"
            type="button"
            class="lan-room"
            :data-room="room.code"
            @click="joinRoom(room.code)"
            @touchend.prevent="joinRoom(room.code)"
          >
            <i class="fas fa-wifi" aria-hidden="true"></i>
            <span class="lan-room-name">{{ room.name }}</span>
            <span class="lan-room-code">{{ room.code }}</span>
          </button>
        </div>

        <!-- The fallback, and labelled as one: the list above is how this is
             meant to work, and typing a code is what you do when the two
             machines are not on the same network. -->
        <div class="lan-join-code">
          <input
            v-model="joinCode"
            maxlength="8"
            placeholder="Hoặc nhập mã phòng"
            aria-label="Mã phòng LAN"
            spellcheck="false"
            autocapitalize="characters"
          />
          <button
            type="button"
            id="lan-join"
            :disabled="!canJoinTyped"
            @click="joinRoom(joinCode.trim())"
            @touchend.prevent="joinRoom(joinCode.trim())"
          >
            Vào
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
