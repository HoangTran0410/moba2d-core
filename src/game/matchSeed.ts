/**
 * One random number the whole match agrees on.
 *
 * ## Why this has to exist before anything can be shuffled
 *
 * A LAN client does not receive the jungle — it *builds* it. `ClientSession`'s
 * own comment says so: "the units both sides built from the same map data,
 * matched by construction order". Minions, monsters and turrets run their own
 * local timers on both ends and nothing forwards their swings, because
 * forwarding them would double every bolt.
 *
 * That is what makes `Math.random()` in content a desync rather than a
 * flourish. A drake rotation shuffled at module scope gives the host a fire
 * drake, the client an ocean drake, and each of them a different buff for the
 * same kill — with nothing in the protocol that could ever notice. It shipped
 * once and was reverted for exactly this.
 *
 * So the randomness is drawn **once, by the host**, travels in the handshake
 * beside the map id and the rules, and everything derived from it is a pure
 * function of it. A pack that wants "different every match" asks for this
 * number and gets an answer its opponent agrees with.
 *
 * ## Not a general RNG
 *
 * There is deliberately no `game.random()`. A shared *stream* would have to be
 * consumed in the same order on both ends, and the two ends do not run the same
 * code — a client draws no bot orders and casts no host-side spell — so the
 * first divergent draw would silently rot every later one. A seed is a value:
 * two sides that derive the same thing from it agree, and two sides that derive
 * different things were always going to.
 */

/**
 * A fresh seed for a match nobody has handed one to.
 *
 * 32 bits, which is what the mixer below consumes, and an integer so it
 * survives the wire as a plain JSON number.
 */
export function randomMatchSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

/**
 * mulberry32 — small, fast, and good enough for deciding which drake is up.
 *
 * Written out rather than taken from a dependency because the whole point is
 * that both ends compute the *same* numbers: a version bump that changed the
 * stream would desync a match, and this way there is no version.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A shuffled copy, decided entirely by `seed`.
 *
 * Fisher-Yates, so every permutation is equally likely — unlike
 * `sort(() => Math.random() - 0.5)`, which is neither uniform nor even
 * consistent (a comparator that answers differently for the same pair is
 * undefined behaviour, and V8's sort is not stable about it). The reverted
 * first attempt at a random drake order used exactly that.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
