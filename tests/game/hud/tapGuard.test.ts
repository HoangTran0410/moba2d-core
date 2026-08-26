import { describe, expect, it, vi } from 'vitest';
import { createTapListeners, TAP_SLOP_PX, type TouchLike } from '../../../src/game/hud/tapGuard';

/**
 * The scroll/tap discrimination behind `v-tap`.
 *
 * Reported from a real phone: scrolling the shop opened whichever tile the
 * thumb started on, and scrolling the settings list pressed the control under
 * it — because `@touchend.prevent` fires for the `touchend` of a *scroll* too
 * on browsers that keep delivering touch events through one (iOS Safari). The
 * guard is the same rule every native toolkit uses: a tap ends near where it
 * began, with the same single finger.
 */

const touch = (x: number, y: number) => ({ clientX: x, clientY: y });

const event = (points: { clientX: number; clientY: number }[]): TouchLike & {
  prevented: boolean;
} => {
  const built = {
    touches: points,
    prevented: false,
    preventDefault: () => {
      built.prevented = true;
    },
  };
  return built;
};

describe('createTapListeners', () => {
  it('fires for a touch that ends where it began', () => {
    const fire = vi.fn();
    const listeners = createTapListeners(fire);

    listeners.touchstart(event([touch(50, 50)]));
    const end = event([]);
    listeners.touchend(end);

    expect(fire).toHaveBeenCalledTimes(1);
    expect(end.prevented).toBe(true);
  });

  it('tolerates jitter inside the slop radius', () => {
    const fire = vi.fn();
    const listeners = createTapListeners(fire);

    listeners.touchstart(event([touch(50, 50)]));
    listeners.touchmove(event([touch(50 + TAP_SLOP_PX - 2, 50)]));
    listeners.touchend(event([]));

    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a scroll', () => {
    const fire = vi.fn();
    const listeners = createTapListeners(fire);

    listeners.touchstart(event([touch(50, 50)]));
    listeners.touchmove(event([touch(50, 50 + TAP_SLOP_PX + 1)]));
    // the finger comes back near the start — a scroll that returned is still
    // not a tap, or a flick-and-settle would press whatever it began on
    listeners.touchmove(event([touch(51, 52)]));
    const end = event([]);
    listeners.touchend(end);

    expect(fire).not.toHaveBeenCalled();
    // the synthetic click is still swallowed, exactly as `.prevent` did
    expect(end.prevented).toBe(true);
  });

  it('does not fire when a second finger joins', () => {
    const fire = vi.fn();
    const listeners = createTapListeners(fire);

    listeners.touchstart(event([touch(50, 50)]));
    listeners.touchstart(event([touch(50, 50), touch(80, 80)]));
    listeners.touchend(event([touch(80, 80)]));
    listeners.touchend(event([]));

    expect(fire).not.toHaveBeenCalled();
  });

  it('does not fire after a touchcancel', () => {
    const fire = vi.fn();
    const listeners = createTapListeners(fire);

    listeners.touchstart(event([touch(50, 50)]));
    listeners.touchcancel();
    listeners.touchend(event([]));

    expect(fire).not.toHaveBeenCalled();
  });

  it('recovers for the next clean tap after a scroll', () => {
    const fire = vi.fn();
    const listeners = createTapListeners(fire);

    listeners.touchstart(event([touch(50, 50)]));
    listeners.touchmove(event([touch(50, 200)]));
    listeners.touchend(event([]));
    expect(fire).not.toHaveBeenCalled();

    listeners.touchstart(event([touch(60, 60)]));
    listeners.touchend(event([]));
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
