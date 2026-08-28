/**
 * Who this browser is, across connections.
 *
 * A peer id is the *connection's* name: `RtcTransport` mints one per
 * `RTCPeerConnection`, and `HostSession` keys its champion map on it. That is
 * correct for a wire and wrong for a player — reconnect and the same person
 * arrives under a new peer id, so the host spawns them a second champion while
 * the first stands where they left it. Reported exactly that way: *"vô phòng
 * lại thì thành lan 2 luôn, lan 1 hồi nãy vẫn sống trong game"*.
 *
 * A seat is the other half: stable for as long as the browser keeps its
 * storage, sent in `iam`, and what the host actually matches a returning
 * player against. Two ids rather than one because they answer different
 * questions — *which socket is this* and *whose champion is this* — and the
 * bug was one id being asked both.
 *
 * **Persisted, deliberately.** The reconnect path is a page load (the join
 * runs again from the top rather than a second in-place resync existing
 * beside the first), so a seat that lived in memory would be gone at exactly
 * the moment it is needed. `sessionStorage` would survive a reload but not the
 * mobile browser discarding a backgrounded tab — which is the case this whole
 * mechanism exists for.
 *
 * **Not a credential.** It says "I am the player who held that champion", and
 * anyone who learns one could claim that seat. That is the same trust the room
 * code already carries, and the stake is a champion in a friendly LAN match;
 * treating it as a secret would mean minting and verifying one, which is a
 * login. If a match ever wants to be hostile-proof, this is the line to
 * revisit, and `HostSession.claimSeat` is the one place that would change.
 */
const SEAT_KEY = 'moba2d:netSeat:v1';

/** 16 hex chars: collision-free enough for a room of five, short on the wire. */
const mintSeat = (): string => {
  let seat = '';
  for (let i = 0; i < 16; i++) seat += Math.floor(Math.random() * 16).toString(16);
  return seat;
};

let cached: string | null = null;

/**
 * This browser's seat, minted on first use.
 *
 * Storage that throws (private mode, blocked cookies) falls back to a
 * per-page-load seat held in the module: a player in that browser cannot
 * reclaim a champion across a reload, which is the same behaviour they had
 * before seats existed, rather than a join that fails.
 */
export const netSeat = (): string => {
  if (cached !== null) return cached;
  try {
    const stored = localStorage.getItem(SEAT_KEY);
    if (stored) {
      cached = stored;
      return cached;
    }
    const minted = mintSeat();
    localStorage.setItem(SEAT_KEY, minted);
    cached = minted;
    return cached;
  } catch {
    cached = mintSeat();
    return cached;
  }
};

/** Forget the cached seat — for tests, which must not share one. */
export const resetNetSeatForTests = (): void => {
  cached = null;
};
