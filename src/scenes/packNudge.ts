/**
 * Whether this page load has already shown the "you have no roster" nudge.
 *
 * **Module state, not instance state**, and that is the whole reason this file
 * exists rather than a `let` at the top of `MenuScene.vue`. `<script setup>`
 * *is* the setup function, so a binding declared there is rebuilt on every
 * mount — and `MenuScene` unmounts its app in `exit()` and calls `createApp()`
 * again in `enter()`, which is every "Quay lại" from the pregame, packs or
 * About screen. Declared in the component, the flag looked like module scope
 * and was not: the nudge came back on the second press of Chơi, so
 * "once" meant once per *visit to the menu* instead of once at all. Same trap
 * and same fix as `game/hud/config/panelTab.ts`, and the same shape as
 * `updatesChecked` in `MenuScene.ts` next door.
 *
 * **Deliberately not persisted.** There was a `localStorage` key here and it
 * is gone on purpose: a player who chose to play without a pack has answered
 * the question *for this sitting*, not for good. Once per page load is the
 * bar — the nudge is a signpost to a screen they have never had a reason to
 * open, not a consent dialog, and re-reading it after a reload costs one
 * press. Nothing here can throw, so nothing here is wrapped in a `try`.
 */
let nudgeSeen = false;

export const packNudgeSeen = (): boolean => nudgeSeen;

export const markPackNudgeSeen = (): void => {
  nudgeSeen = true;
};
