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
 * The open rooms on this network — the broker groups by public IP, so this
 * answers "ai đang mở phòng cùng mạng với mình". `null` (never a throw)
 * when the broker is unreachable, so the lobby can tell an empty network
 * from a dead connection and say so in one quiet line.
 *
 * `announce` makes the same request also *advertise* the caller's room:
 * the broker registers it under this request's own IP before answering.
 * Riding the poll is the fix for two real failures — a room used to exist
 * on the broker only once its match had started (the WebSocket at `Chơi`
 * was the sole registrar, so a host sitting in the menu with a code on
 * screen was invisible even to a second tab on the same machine), and a
 * dual-stack host could register over IPv6 while a neighbour listed over
 * IPv4 into a different per-IP directory. Announce and listing share one
 * request, so on one machine they cannot disagree.
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
