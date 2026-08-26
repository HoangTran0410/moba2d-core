import { ref } from 'vue';

/**
 * Which roster rows have their drawer open, held outside the component.
 *
 * The same argument `panelTab.ts` makes one file over, and for the same
 * reason: both HUD views mount the match-config panel with `v-if`, so closing
 * it unmounts the whole thing — and `<script setup>` *is* the setup function,
 * so a `ref` declared at its top level is rebuilt on every mount. Declaring it
 * there looks like module scope and is not.
 *
 * The roster is a list you open *in order to* do something else: expand Bot 2,
 * read its stats, go and change something, come back. Losing the expansion
 * every time meant finding Bot 2 again every time. The shop is what turned
 * that from an annoyance into a real cost — pressing Cửa hàng closes the panel
 * by design, because the panel holds the match paused and a purchase is a
 * mutation with nothing ticking to settle it, so building three bots meant
 * re-expanding three rows three times.
 *
 * Keyed by row **id**, not by position: removing Bot 1 shifts every row below
 * it, and an index-keyed drawer would jump to a different participant instead
 * of closing.
 *
 * Deliberately not persisted, exactly like the tab beside it: which drawers
 * you had open is a fact about the last few seconds, not a setting. It does
 * outlive a match and a scene change, which is the same trade `panelTab.ts`
 * already made and for the same reason — resetting a player's place between
 * two views of one panel is a behaviour nobody asked for.
 *
 * A **new Set** on every write, never a mutation in place: `ref` tracks the
 * reference, and a `Set` mutated through one does not notify.
 */
export const expandedRosterRows = ref<Set<string>>(new Set());

/** Test seam. Nothing in the app clears these — a closed drawer is a write. */
export function resetExpandedRosterRows(): void {
  expandedRosterRows.value = new Set();
}
