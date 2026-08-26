import type { Directive } from 'vue';

/**
 * `v-tap` — the touch half of a HUD control, with the scroll told apart.
 *
 * The pattern it replaces is `@touchend.prevent="handler"` beside `@click`,
 * this codebase's standard shape for a control that must work under a thumb
 * (see `RosterTab.vue`'s own comment for why `@click` alone is dead there).
 * That shape has a hole `pan-y` cannot close: on the browsers that keep
 * delivering touch events through a native scroll (iOS Safari among them),
 * the `touchend` of a *scroll* fires on whatever element the finger first
 * landed on — so scrolling the shop opened whichever tile the thumb happened
 * to start from, and scrolling a settings list pressed the control under it.
 * A scroll is not a tap, and only the element itself can tell the difference,
 * because by `touchend` the browser has already done its scrolling either way.
 *
 * The discrimination is the same one every native toolkit uses: a tap is a
 * touch that ends near where it began, with the same single finger. Movement
 * past `TAP_SLOP_PX`, a second finger, or a `touchcancel` all mark the gesture
 * as not-a-tap, and the handler simply never fires. A genuine tap fires it on
 * `touchend` and prevents the default exactly as `.prevent` did, so the
 * browser's synthetic `click` never double-fires the `@click` beside it.
 *
 * Usage (`<script setup>` puts the identifier in template scope as `v-tap`):
 *
 *     import { vTap } from '../tapGuard';
 *     <button @click="pick()" v-tap="() => pick()">
 */

/** Movement past this many px means the finger was scrolling, not tapping. */
export const TAP_SLOP_PX = 12;

/** The one point a tap needs of a `Touch`, so tests can hand in plain objects. */
interface TouchPoint {
  clientX: number;
  clientY: number;
}

/** The shape of the events the listeners read — a structural `TouchEvent`. */
export interface TouchLike {
  touches: ArrayLike<TouchPoint>;
  changedTouches?: ArrayLike<TouchPoint>;
  preventDefault(): void;
}

export interface TapListeners {
  touchstart(event: TouchLike): void;
  touchmove(event: TouchLike): void;
  touchend(event: TouchLike): void;
  touchcancel(): void;
}

/**
 * The gesture state machine, separated from the directive so it can be tested
 * without a DOM: `fire` is called for a touch that stayed a tap, and never for
 * one that scrolled, grew a second finger, or was cancelled.
 */
export function createTapListeners(fire: (event: TouchLike) => void): TapListeners {
  let tracking = false;
  let isTap = false;
  let startX = 0;
  let startY = 0;

  return {
    touchstart(event) {
      if (event.touches.length !== 1) {
        // a second finger arriving mid-gesture also lands here, and correctly
        // demotes the gesture it joined
        tracking = true;
        isTap = false;
        return;
      }
      tracking = true;
      isTap = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    },
    touchmove(event) {
      if (!tracking || !isTap) return;
      if (event.touches.length !== 1) {
        isTap = false;
        return;
      }
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) isTap = false;
    },
    touchend(event) {
      if (!tracking) return;
      // still the finger's own multi-touch tail: wait for the last one up
      if (event.touches.length > 0) return;
      tracking = false;
      // Prevent the synthetic click in *both* outcomes. On a tap that is what
      // stops `@click` beside this from double-firing; after a scroll no click
      // is coming, so it costs nothing.
      event.preventDefault();
      if (isTap) fire(event);
    },
    touchcancel() {
      tracking = false;
      isTap = false;
    },
  };
}

type TapHandler = (event: TouchLike) => void;

interface TapBinding {
  handler: TapHandler;
  listeners: TapListeners;
  attached: {
    touchstart: EventListener;
    touchmove: EventListener;
    touchend: EventListener;
    touchcancel: EventListener;
  };
}

const bindings = new WeakMap<HTMLElement, TapBinding>();

export const vTap: Directive<HTMLElement, TapHandler> = {
  mounted(el, directive) {
    const binding: TapBinding = {
      handler: directive.value,
      // read through `binding.handler` so `updated` can swap it in place
      listeners: createTapListeners(event => binding.handler(event)),
      attached: {
        touchstart: event => binding.listeners.touchstart(event as unknown as TouchLike),
        touchmove: event => binding.listeners.touchmove(event as unknown as TouchLike),
        touchend: event => binding.listeners.touchend(event as unknown as TouchLike),
        touchcancel: () => binding.listeners.touchcancel(),
      },
    };
    bindings.set(el, binding);
    // start/move never call preventDefault, so they may stay passive; end must
    // not be, or the preventDefault that swallows the synthetic click is void
    el.addEventListener('touchstart', binding.attached.touchstart, { passive: true });
    el.addEventListener('touchmove', binding.attached.touchmove, { passive: true });
    el.addEventListener('touchend', binding.attached.touchend, { passive: false });
    el.addEventListener('touchcancel', binding.attached.touchcancel, { passive: true });
  },
  updated(el, directive) {
    const binding = bindings.get(el);
    if (binding) binding.handler = directive.value;
  },
  unmounted(el) {
    const binding = bindings.get(el);
    if (!binding) return;
    el.removeEventListener('touchstart', binding.attached.touchstart);
    el.removeEventListener('touchmove', binding.attached.touchmove);
    el.removeEventListener('touchend', binding.attached.touchend);
    el.removeEventListener('touchcancel', binding.attached.touchcancel);
    bindings.delete(el);
  },
};
