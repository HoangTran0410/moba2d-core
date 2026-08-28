import { ref } from 'vue';

/**
 * Whether this client still has the host, kept where a component can see it.
 *
 * A plain `reactive` object on `ClientSession`, read through
 * `Game.net` → `hudInteractions.netLink` → a `computed` in the overlay, did
 * not work: the flag flipped, `link.lost` read `true` from the page, the HUD's
 * own getter answered `true` — and the overlay never rendered. Measured, not
 * guessed (`drive-lan-reconnect.mjs` failed exactly one check, and a probe
 * showed `netLinkViaHud: { lost: true }` beside `overlayInDom: false`).
 *
 * The chain was the problem, not any one link in it. A module-level `ref` is
 * what this repository already uses for state that has to cross from
 * non-component code into a component — `content/packHealth.ts` and
 * `pwa/updates.ts` are the same shape, for the same reason — and it removes
 * every question at once: no prop, no getter, no `markRaw` on the way through.
 *
 * Dependency-free apart from `vue`, deliberately: `ClientSession` writes it
 * from the match chunk and `hud/NetLinkOverlay.vue` reads it, and anything
 * heavier here would be an import edge between the two that
 * `scripts/check-chunks.mjs` exists to stop.
 */
export const netLinkLost = ref(false);

/**
 * Reset on the way out of a match.
 *
 * A stale `true` outlives the session that set it — the flag is module state
 * and a match is not — so leaving with the link down and starting an offline
 * match would raise a "lost the host" overlay over a game that has no host.
 */
export const clearNetLink = (): void => {
  netLinkLost.value = false;
};
