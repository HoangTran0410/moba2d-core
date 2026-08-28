/**
 * The signaling broker's address and the little lobby arithmetic, shared by
 * the menu's LAN box and the game-side net layer.
 *
 * Lives under `src/scenes/` — not `src/game/net/` — on purpose: the menu
 * imports it, and everything under `/src/game/` is pinned into the `game`
 * chunk (`vite.config.ts`), so a menu import from there would be the
 * pregame→game edge `chunks:check` bans. This module imports nothing, so it
 * costs whichever chunks pull it a few hundred bytes.
 */

/**
 * The deployed broker (`net/signaling/`, a Cloudflare Worker + Durable
 * Objects speaking `scripts/net-relay.mjs`'s protocol) — the default in dev
 * and production alike, so a fresh `npm run dev` never spams connection
 * errors at a relay nobody started. The local relay is opt-in:
 * `?signal=ws://localhost:8790`, which is exactly what `npm run e2e:lan`
 * passes to stay offline-runnable.
 */
export const DEFAULT_SIGNAL_URL = 'wss://moba2d-signal.99-hoangtran.workers.dev';

/**
 * Strip `?net=…&room=…` back off the address bar.
 *
 * The URL is the API, which means leaving has to un-say what pressing said.
 * The lobby already did this on `Quay lại`, but a match armed from there kept
 * the parameters for the whole of its life and *after* it: quitting to the
 * menu left `?net=host&room=BH2Y7` sitting there, so the next press of Chơi —
 * a plain solo match, as far as the player was concerned — opened a LAN host
 * on a room code from a game that had already ended. The sessions call this
 * as they tear down, which is the moment the arming stops being true.
 *
 * Lives here rather than in `game/net/` because both ends need it and only
 * this module is allowed in both chunks (see the header above).
 */
export const disarmNetUrl = (): void => {
  if (typeof window === 'undefined' || !window.history) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('net') && !params.has('room')) return;
  params.delete('net');
  params.delete('room');
  const query = params.toString();
  window.history.replaceState(
    null,
    '',
    query ? `${window.location.pathname}?${query}` : window.location.pathname
  );
};

/** 5 chars of A-Z2-9 (no 0/O/1/I): ~33M codes, plenty for rooms that live minutes. */
export const randomRoomCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
};

/** The broker's https side, for `GET /rooms` — `wss://x` → `https://x/rooms`. */
export const roomsUrlOf = (signalUrl: string): string =>
  `${signalUrl.replace(/^ws/, 'http').replace(/\/$/, '')}/rooms`;

export interface LanRoom {
  code: string;
  name: string;
  ageMs: number;
}

/** What a hosting lobby asks the poll to advertise alongside the listing. */
export interface LanAnnounce {
  code: string;
  name: string;
}

/**
 * The rooms that are open. `null` (never a throw) when the broker is
 * unreachable, so the lobby can tell an empty listing from a dead connection
 * and say so in one quiet line.
 *
 * **This used to mean "rooms on my network"** — the broker kept one directory
 * per public IP (`CF-Connecting-IP`), so two devices behind one NAT found each
 * other and nobody else. On a home router that works, and on anything larger
 * it fails silently: measured on one corporate wifi, twenty requests from a
 * *single machine* left through nine different public addresses across four
 * unrelated /8s, so a room announced on one poll was listed from a different
 * directory on the next. There is one directory now, and a host that does not
 * want to be found says so (`listed=0`, `game/net/lobbyHost.ts`) instead of
 * relying on NAT to hide it.
 *
 * `announce` makes the same request also *advertise* the caller's room. Riding
 * the poll is the fix for a real failure: a room used to exist on the broker
 * only once its match had started — the WebSocket at `Chơi` was the sole
 * registrar — so a host sitting in the menu with a code on screen was
 * invisible even to a second tab on the same machine. Announce and listing
 * share one request, so the two can never disagree about what this device is
 * offering.
 */
export const fetchLanRooms = async (
  signalUrl: string,
  announce?: LanAnnounce
): Promise<LanRoom[] | null> => {
  try {
    const url = new URL(roomsUrlOf(signalUrl));
    if (announce) {
      url.searchParams.set('announce', announce.code);
      url.searchParams.set('name', announce.name);
    }
    const response = await fetch(url);
    if (!response.ok) return null;
    const listed = (await response.json()) as LanRoom[];
    return Array.isArray(listed) ? listed : null;
  } catch {
    return null;
  }
};
