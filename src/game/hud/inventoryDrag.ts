/**
 * Dragging an item from one bag slot to another — the gesture, with no DOM in
 * it.
 *
 * ## Why a module and not a few refs in the component
 *
 * `<script setup>` *is* the setup function: a `const` at its top level looks
 * like module scope and is rebuilt on every mount. That alone would be a weak
 * reason — the state genuinely is per-mount. The real one is that the
 * interesting part of this gesture is not the drop, it is **telling a drag from
 * a tap**. The same slot already answers a click by opening the shop, so one
 * press has to resolve to exactly one of two very different things, and that
 * decision has a threshold in it. A threshold belongs somewhere a test can
 * drive it at both sides of the line, which a `<script setup>` const is not.
 *
 * ## The two failures it is written against
 *
 * **A tap that wobbles is still a tap.** A mouse moves a pixel or two between
 * press and release and a thumb moves several every time, so treating any
 * movement at all as a drag makes the shop unopenable from the bag on a phone —
 * which is also the only way a phone player reaches the shop from the bar.
 *
 * **A drag that ends on nothing is nothing.** Off the bar, on the map, on the
 * minimap: dropping an item somewhere unrelated is the gesture a player uses to
 * say "no, cancel", and it is the one they reach for the instant they realise
 * they picked up the wrong item. Falling back to the last slot the pointer
 * crossed would move an item precisely when they were trying not to.
 *
 * ## Why pointer events and not HTML5 drag-and-drop
 *
 * `dragstart`/`drop` never fire under a thumb, and this bar's whole reason for
 * the `@touchend.prevent` convention is that it is used under one. Pointer
 * events are the single path both a mouse and a finger travel.
 */

/**
 * How far a pointer must travel before a press stops being a tap, in CSS
 * pixels, measured as a straight-line distance rather than per axis — sliding
 * diagonally is the ordinary way a thumb moves, and a per-axis test would let
 * a much longer diagonal through as a tap.
 */
export const DRAG_SLOP_PX = 6;

/** What a finished press turns out to have meant. */
export type InventoryGesture =
  { kind: 'move'; from: number; to: number } | { kind: 'open' } | { kind: 'none' };

export class InventoryDrag {
  /** The slot the press started on, or `null` when nothing is down. */
  from: number | null = null;
  /**
   * The slot the pointer is currently over, for the drop highlight — and only
   * once the press is really a drag. A highlight under a stationary cursor
   * reads as the bag being about to do something it is not.
   */
  over: number | null = null;

  private originX = 0;
  private originY = 0;
  private past = false;

  get dragging(): boolean {
    return this.from !== null && this.past;
  }

  /**
   * A press landed on `slot`. Ignored while another press is already down: two
   * fingers on the bar means the first one owns the gesture, and letting the
   * second retarget it mid-drag moves an item the player never picked up.
   */
  begin(slot: number, x: number, y: number): void {
    if (this.from !== null) return;
    this.from = slot;
    this.originX = x;
    this.originY = y;
    this.past = false;
    this.over = null;
  }

  /**
   * The pointer moved. Crossing the threshold is one-way: a drag that comes
   * back inside it is still a drag, or a drag out and back resolves as a tap on
   * release and the shop opens under a player who was putting an item down
   * where they found it.
   */
  moveTo(x: number, y: number): void {
    if (this.from === null || this.past) return;
    if (Math.hypot(x - this.originX, y - this.originY) > DRAG_SLOP_PX) this.past = true;
  }

  /** Which slot the pointer is over now, or `null` for none of them. */
  hover(slot: number | null): void {
    this.over = this.dragging ? slot : null;
  }

  /**
   * The press ended over `slot` — `null` for anywhere that is not a bag slot.
   * Answers what it meant and resets, whichever way it went.
   */
  end(slot: number | null): InventoryGesture {
    const from = this.from;
    const wasDragging = this.dragging;
    this.cancel();

    if (from === null) return { kind: 'none' };
    // A press that never travelled is a tap, wherever it is released — the
    // release point does not matter because the pointer never really left.
    if (!wasDragging) return { kind: 'open' };
    if (slot === null || slot === from) return { kind: 'none' };
    return { kind: 'move', from, to: slot };
  }

  /** Forget the whole gesture. `pointercancel`, and every exit from `end`. */
  cancel(): void {
    this.from = null;
    this.over = null;
    this.past = false;
  }
}
