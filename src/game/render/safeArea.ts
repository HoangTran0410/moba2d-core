/**
 * The four insets a device reserves for its own furniture, as numbers.
 *
 * ## Why this exists when the CSS tokens already do
 *
 * `styles/main.css` defines `--safe-top`/`--safe-right`/`--safe-bottom`/
 * `--safe-left` from `env(safe-area-inset-*)`, and anything laid out in CSS can
 * add one. Half this game is not laid out in CSS: the minimap, the touch
 * controls and everything else on the canvas are placed in canvas pixels by
 * code that has never read a stylesheet.
 *
 * So this reads the *same tokens* rather than restating `env()` — one
 * definition of what the inset is, in the file that already owns it, with the
 * canvas side asking the document for the answer instead of keeping a second
 * copy that can disagree.
 *
 * ## Why it is cached, and what invalidates it
 *
 * `getComputedStyle` forces a style flush, and the canvas would ask on every
 * frame for four values that change only when the device does. They change on
 * rotation and on entering or leaving split-screen, both of which resize the
 * window — so `invalidateSafeArea()` from the resize path is the whole
 * invalidation rule, the same one `FogOfWar.resize` already follows for its own
 * cache.
 *
 * ## Where the numbers come from being zero
 *
 * On a desktop, on a phone with no notch, and in any browser tab that is not
 * `viewport-fit=cover`, all four are `0px` — so adding them costs nothing
 * everywhere they do not apply, which is what makes it safe to add them
 * unconditionally at the call sites.
 */

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NONE: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

let cached: SafeAreaInsets | null = null;

/** `12px` → `12`; anything unparseable → `0`, never `NaN` into a layout. */
const px = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The insets right now.
 *
 * Answers zeros rather than throwing anywhere there is no document — the test
 * environment, a worker — so a caller can add them without a guard.
 */
export function safeAreaInsets(): SafeAreaInsets {
  if (cached) return cached;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return NONE;

  const style = getComputedStyle(document.documentElement);
  cached = {
    top: px(style.getPropertyValue('--safe-top')),
    right: px(style.getPropertyValue('--safe-right')),
    bottom: px(style.getPropertyValue('--safe-bottom')),
    left: px(style.getPropertyValue('--safe-left')),
  };
  return cached;
}

/** Called from the resize path; the next read measures the document again. */
export function invalidateSafeArea(): void {
  cached = null;
}
