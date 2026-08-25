import { describe, expect, it } from 'vitest';
import { DRAG_SLOP_PX, InventoryDrag } from '@/game/hud/inventoryDrag';

/**
 * Dragging an item from one bag slot to another, as a state machine away from
 * Vue.
 *
 * ## Why it is not written inline in the component
 *
 * `<script setup>` *is* the setup function — a `const` at its top level is
 * rebuilt on every mount, and none of this wants to be re-derived by Vue or
 * tested through one. But the sharper reason is that the interesting part is
 * not the drop, it is **telling a drag from a tap**: the same slot already
 * answers a click by opening the shop, and one gesture has to resolve to
 * exactly one of the two. That is a decision with a threshold in it, and a
 * threshold belongs somewhere it can be driven at both sides of the line.
 *
 * ## The two failures it is written against
 *
 * A tap that wobbles a pixel is still a tap — a mouse moves between press and
 * release, and a thumb moves several pixels every time. Treating any movement
 * as a drag makes the shop unopenable from the bag on a phone.
 *
 * And a drag that ends on nothing — off the bar, on the map, on the minimap —
 * has to be *nothing*, not a move to the last slot the pointer happened to
 * cross. Dropping an item somewhere unrelated is the gesture a player uses to
 * say "no, cancel", and it is the one they reach for after picking up the
 * wrong item.
 */
describe('InventoryDrag', () => {
  const press = (drag: InventoryDrag, slot: number, x = 0, y = 0): void => drag.begin(slot, x, y);

  it('starts idle', () => {
    const drag = new InventoryDrag();
    expect(drag.dragging).toBe(false);
    expect(drag.from).toBeNull();
  });

  it('calls a press with no movement a tap, which opens the shop', () => {
    const drag = new InventoryDrag();
    press(drag, 2);
    expect(drag.end(2)).toEqual({ kind: 'open' });
  });

  it('still calls it a tap after a wobble under the threshold', () => {
    // A mouse moves between press and release and a thumb moves several
    // pixels every time. Without this the bag cannot open the shop on a phone.
    const drag = new InventoryDrag();
    press(drag, 2, 100, 100);
    drag.moveTo(100 + DRAG_SLOP_PX - 1, 100);
    expect(drag.dragging).toBe(false);
    expect(drag.end(2)).toEqual({ kind: 'open' });
  });

  it('becomes a drag once the pointer passes the threshold', () => {
    const drag = new InventoryDrag();
    press(drag, 2, 100, 100);
    drag.moveTo(100 + DRAG_SLOP_PX + 1, 100);
    expect(drag.dragging).toBe(true);
  });

  it('measures the threshold as a distance, not per axis', () => {
    // Sliding diagonally is the ordinary way a thumb travels; a per-axis test
    // would need `DRAG_SLOP_PX` on one axis alone and let a much longer
    // diagonal through as a tap.
    const drag = new InventoryDrag();
    press(drag, 0, 0, 0);
    drag.moveTo(DRAG_SLOP_PX, DRAG_SLOP_PX); // hypotenuse ≈ 1.41 × the slop
    expect(drag.dragging).toBe(true);
  });

  it('stays a drag once it is one, however far back the pointer comes', () => {
    // Otherwise a drag out and back turns into a tap on release, and the shop
    // opens under a player who was putting an item down where they found it.
    const drag = new InventoryDrag();
    press(drag, 0, 100, 100);
    drag.moveTo(200, 100);
    drag.moveTo(100, 100);
    expect(drag.dragging).toBe(true);
    expect(drag.end(0)).toEqual({ kind: 'none' });
  });

  it('resolves a real drag onto another slot as a move', () => {
    const drag = new InventoryDrag();
    press(drag, 1, 0, 0);
    drag.moveTo(50, 0);
    expect(drag.end(4)).toEqual({ kind: 'move', from: 1, to: 4 });
  });

  it('resolves a drag that ends on nothing as nothing', () => {
    const drag = new InventoryDrag();
    press(drag, 1, 0, 0);
    drag.moveTo(50, 0);
    expect(drag.end(null)).toEqual({ kind: 'none' });
  });

  it('resolves a drag back onto its own slot as nothing, not as a tap', () => {
    const drag = new InventoryDrag();
    press(drag, 3, 0, 0);
    drag.moveTo(80, 0);
    expect(drag.end(3)).toEqual({ kind: 'none' });
  });

  it('is idle again after it ends, however it ended', () => {
    const drag = new InventoryDrag();
    press(drag, 1, 0, 0);
    drag.moveTo(50, 0);
    drag.end(4);
    expect(drag.dragging).toBe(false);
    expect(drag.from).toBeNull();
    expect(drag.over).toBeNull();
  });

  it('answers nothing when it never began', () => {
    // A pointerup can arrive with no matching pointerdown — a press that
    // started on the map and released over the bar, or a cancelled gesture.
    const drag = new InventoryDrag();
    expect(drag.end(2)).toEqual({ kind: 'none' });
  });

  it('remembers which slot the pointer is over, for the highlight', () => {
    const drag = new InventoryDrag();
    press(drag, 0, 0, 0);
    drag.moveTo(50, 0);
    drag.hover(3);
    expect(drag.over).toBe(3);
  });

  it('reports no hover until the press is really a drag', () => {
    // A highlight that appears under a stationary cursor reads as the bag
    // being about to do something it is not.
    const drag = new InventoryDrag();
    press(drag, 0, 0, 0);
    drag.hover(3);
    expect(drag.over).toBeNull();
  });

  it('forgets everything when cancelled', () => {
    const drag = new InventoryDrag();
    press(drag, 0, 0, 0);
    drag.moveTo(50, 0);
    drag.cancel();
    expect(drag.dragging).toBe(false);
    expect(drag.end(2)).toEqual({ kind: 'none' });
  });

  it('ignores a second press while one is already down', () => {
    // Two fingers on the bar. The first one owns the gesture; letting the
    // second retarget it mid-drag moves an item the player never picked up.
    const drag = new InventoryDrag();
    press(drag, 1, 0, 0);
    drag.moveTo(50, 0);
    press(drag, 5, 0, 0);
    expect(drag.from).toBe(1);
  });
});
