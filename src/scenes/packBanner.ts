/**
 * What the runtime pack install did, kept where the menu can still read it.
 *
 * The banner used to live in `LoadingScene.vue`, set by `boot()` on the line
 * before it handed off to the menu — and `LoadingScene.exit()` sets
 * `#loading-scene` to `display: none`. So the element existed, an e2e
 * assertion on `count() > 0` passed, and the player saw it in 1 of 68
 * sampled frames: for however long the menu chunk took to arrive. Spec §7 is
 * explicit that the banner belongs to the menu and does not dismiss itself,
 * because a game silently missing 58 champions reads as a broken game.
 *
 * This module is what carries it across that handover. It is a plain `.ts`
 * module, not component state, for the reason `src/pwa/updates.ts` is one:
 * `MenuScene` mounts on every entry and unmounts on every exit, so anything
 * held in `MenuScene.vue`'s `<script setup>` is rebuilt each time the player
 * comes back from the pregame screen — including a dismissal, which would
 * make the banner reappear, and including the failure list itself, which
 * nothing would ever set a second time.
 *
 * Deliberately dependency-free apart from `vue` and one erased type import:
 * `MenuScene`'s chunk may not statically reach the match chunk
 * (`scripts/check-chunks.mjs`), and `runtimePacks.ts` is pinned to it.
 */
import { ref } from 'vue';
import type { PackInstallOutcome } from '@/content/runtimePacks';

/** One pack that did not install — the `ok: false` half of the union. */
export type PackInstallFailure = Extract<PackInstallOutcome, { ok: false }>;

/**
 * The failures from this session's install, or empty. Read directly in
 * `MenuScene.vue`'s template, the same way `updates.ts`'s refs are.
 */
export const packInstallFailures = ref<PackInstallFailure[]>([]);

/** Set once the player has actively dismissed the banner. Never set by a timer. */
export const packBannerDismissed = ref(false);

/**
 * Everything the install reported, failures and successes alike, on a global.
 *
 * Not a debug flourish. The install's only previous voice was
 * `console.warn`, which `tests/e2e/harness.mjs` does not capture — it
 * records `console.error` and `pageerror` — so `verify-runtime-pack.mjs`
 * printed 6/6 green while `installCode` was throwing on every champion in
 * the pack. A check cannot assert on something it cannot see, and a warning
 * nobody collects is not a report. The value is a few hundred bytes of plain
 * data and is also the first thing worth asking for when a player says the
 * roster is short.
 */
const PACK_INSTALL_GLOBAL = '__moba2dPackInstall';

/**
 * Called once, by `LoadingScene.boot()`, with whatever `installRuntimePacks`
 * answered.
 */
export function publishPackInstallOutcomes(outcomes: PackInstallOutcome[]): void {
  // A plain loop, not `.filter`: `Array.prototype.filter` is polyfilled in
  // this project and cannot narrow a type (see CLAUDE.md), and narrowing to
  // the `ok: false` member is the whole point — the banner reads `.stage`,
  // which only that member has.
  const failures: PackInstallFailure[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok === false) failures.push(outcome);
  }
  packInstallFailures.value = failures;
  (globalThis as Record<string, unknown>)[PACK_INSTALL_GLOBAL] = outcomes;
}

/**
 * `location.reload()` rather than retrying `installRuntimePacks()` in place:
 * a dead host is usually a transient network condition, and a full reload
 * re-runs the exact same boot path that reported the failure, with no extra
 * state to reconcile.
 */
export function retryPackInstall(): void {
  location.reload();
}

/** The player choosing to live without the content, which is theirs to choose. */
export function dismissPackBanner(): void {
  packBannerDismissed.value = true;
}
