/**
 * The death recap's collapse preference, held outside the component and
 * persisted.
 *
 * Outside the component for the `panelTab.ts` reason — the panel is `v-if`'d
 * and `<script setup>` state dies with every unmount — and persisted, unlike
 * that one, because collapsing the recap is a *setting*: the player who wants
 * the compact bar wants it on every death, not until the next respawn
 * unmounts the panel. `localStorage` in the same guarded style every other
 * `lol2d:*` preference uses: a blocked store reads as the default and
 * swallows the write.
 */
export const RECAP_COLLAPSED_KEY = 'lol2d:deathRecapCollapsed:v1';

export function loadRecapCollapsed(): boolean {
  try {
    return localStorage.getItem(RECAP_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRecapCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(RECAP_COLLAPSED_KEY, '1');
    else localStorage.removeItem(RECAP_COLLAPSED_KEY);
  } catch {
    // a blocked store loses the preference, never the recap
  }
}
