/**
 * The "install this as an app" offer.
 *
 * Chromium never shows its install prompt on its own any more — it fires a
 * cancellable `beforeinstallprompt` and leaves showing it to the page. If
 * nobody catches that event, the only path to installing is a menu item no
 * player looks for. So this module catches it, parks it, and the menu turns
 * it into a visible "Cài app" button.
 *
 * A plain module with a Vue `ref`, for the same reason as `updates.ts`: the
 * event fires once per page, usually before a scene has mounted, and every
 * scene that comes and goes must read the same parked prompt.
 *
 * iOS never fires the event at all — installing there is a manual Share →
 * Add-to-Home-Screen gesture — so the menu pairs `installReady` with
 * `iosManualInstall()` and shows instructions instead of a prompt.
 */
import { ref } from 'vue';

/** True while a caught install prompt is parked and can be shown. */
export const installReady = ref(false);

/**
 * The useful half of Chromium's non-standard BeforeInstallPromptEvent —
 * TypeScript's DOM lib does not declare it.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let parkedPrompt: InstallPromptEvent | null = null;

/** Drops the parked prompt. Exported for tests; runtime callers go through the listeners below. */
export function clearInstallPrompt(): void {
  parkedPrompt = null;
  installReady.value = false;
}

/**
 * Call once at boot, before scenes mount. `target` is swappable for tests.
 */
export function watchInstallPrompt(target: EventTarget = window): void {
  target.addEventListener('beforeinstallprompt', (event) => {
    // Without this the browser may show its own mini-infobar and then
    // consider the prompt spent before the player ever saw our button.
    event.preventDefault();
    parkedPrompt = event as InstallPromptEvent;
    installReady.value = true;
  });
  target.addEventListener('appinstalled', clearInstallPrompt);
}

/**
 * Shows the parked prompt. One shot either way: Chromium refuses to `prompt()`
 * the same event twice, so a dismissal also drops it — the button disappears
 * and comes back only if the browser fires `beforeinstallprompt` again.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const parked = parkedPrompt;
  if (!parked) return 'unavailable';
  clearInstallPrompt();
  await parked.prompt();
  const choice = await parked.userChoice;
  return choice.outcome;
}

/**
 * True when the page already runs as the installed app — the one place the
 * button must never appear. `fullscreen` is checked beside `standalone`
 * because that is what the manifest asks for on Android once the game locks
 * the screen sideways.
 */
export function runningStandalone(win: Window = window): boolean {
  if (typeof win.matchMedia === 'function') {
    if (win.matchMedia('(display-mode: standalone)').matches) return true;
    if (win.matchMedia('(display-mode: fullscreen)').matches) return true;
  }
  // Legacy iOS flag, still the only signal an old home-screen app sets.
  return (win.navigator as { standalone?: boolean }).standalone === true;
}

/**
 * True on browsers where installing exists but only as a manual gesture.
 * Modern iPadOS reports itself as Macintosh; the touch-point count is what
 * separates it from an actual Mac.
 */
export function iosManualInstall(nav: Navigator = navigator): boolean {
  if (/iPhone|iPad|iPod/i.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1;
}
