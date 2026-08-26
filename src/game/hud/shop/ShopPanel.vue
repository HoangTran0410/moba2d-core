<script setup lang="ts">
/**
 * Cửa hàng — the fountain shop, over a *running* match.
 *
 * ## The shape: a grid, a pane, and a bag strip
 *
 * Every item used to be a full-width button carrying its own name, price, stat
 * list, description *and* refusal sentence stacked vertically. Fourteen of
 * those is a very long scroll of near-identical text blocks: nothing is
 * scannable, no two items can be compared side by side, and the bag repeated
 * the same shape underneath. Wild Rift's answer, and this one: a dense grid of
 * icon tiles the eye can sweep (`ShopItemTile.vue` — art, a price, two marks),
 * a detail pane beside it carrying everything the tile stopped saying
 * (`ShopDetail.vue`), and the bag as a strip of six slots along the bottom
 * where the inventory already lives in the player's head.
 *
 * **Picking is not buying.** A tile only opens the pane; the labelled button
 * in the pane is what spends gold, and the one beside it is what sells. The
 * old panel bought on a click anywhere on a card and *sold on a click anywhere
 * on a bag row* — one mis-tap while browsing and an item was gone for 70% of
 * what it cost.
 *
 * ## Phone and desktop share the markup and split in CSS
 *
 * Both are landscape (`OrientationHint.vue`), so the difference is not width,
 * it is height and how much of the world the panel may cover. With room, the
 * grid and the pane sit side by side and the pane shows a placeholder until
 * something is picked. On a short screen the panel stays narrow — it must not
 * cover the champion and the fountain, since the rule it enforces is about
 * where the player is *standing* — and the two share the space by turns: the
 * grid fills it, picking a tile swaps the pane in over it, and the pane's
 * "‹ Danh sách" button (hidden entirely on a wide screen) swaps back. One
 * `has-detail` class on this element is the whole switch; see `styles/shop.css`
 * for the media query that decides which layout is in force.
 *
 * ## The bag strip is the only place a phone can rearrange a bag
 *
 * Dragging one bag slot onto another swaps them, which is how a player chooses
 * which item sits under which key. The bar answers that too — but only with a
 * mouse: on a phone the item buttons are drawn on the *canvas* by
 * `TouchControls.drawItemButtons`, where a drag already means "aim this item's
 * spell", so the gesture is taken and the bar's version is unreachable. This
 * strip is therefore not a convenience, it is the mobile half of a feature
 * that would otherwise only work with a pointer.
 *
 * `InventoryDrag` (`../inventoryDrag.ts`) is the gesture, shared with the bar
 * rather than re-thresholded here — telling a drag from a tap is the whole
 * problem and having two answers to it is how the two surfaces come apart.
 * Pointer events rather than this file's usual `@click` + `@touchend.prevent`
 * for the same reason the bar uses them: `dragstart` never fires under a
 * thumb, and a pointer is the one stream a mouse and a finger both travel.
 * `touch-action: none` on the slot and `draggable="false"` on its icon are the
 * two lines without which the browser claims the gesture first.
 *
 * A tap on a slot opens that item's detail pane — `'open'` from `end()`, which
 * on the bar means "open the shop" and here means "the shop is already open,
 * show me this one". Moving is deliberately **not** gated on the fountain
 * (`hud.moveItem`), so a player can rearrange mid-fight while buying and
 * selling stay where they belong.
 *
 * ## It does not pause, and that is the design
 *
 * Every other panel in this HUD pauses the game. This one must not: pausing at
 * will would make the shop a way to freeze a fight, and "you may only buy at
 * your own fountain" is only a rule while the world keeps moving. It also
 * means every tile's refusal stays live — walk off the platform and the whole
 * grid greys out under the cursor, which is how the rule teaches itself in one
 * match instead of never.
 *
 * ## The panel decides nothing
 *
 * Every "can I buy this" on screen comes from `ItemShop.refusalFor`, through
 * `shopState.ts`, and every purchase goes back through `ItemShop.buyItem`
 * which re-checks all of it. Nothing here computes affordability, a discount
 * or a section — a greyed button whose greying was worked out in a `v-if` is a
 * second implementation of the shop's rules, and the day the two disagree the
 * player is looking at a button that says yes and a purchase that says no.
 * Even "is this price lower than that one" is `priceLabel`, in `shopState.ts`,
 * with a test.
 *
 * The re-check is not belt-and-braces either: this repaints on the HUD's 20Hz
 * tick, so a tile can be a fifth of a second out of date by the time it is
 * pressed — which is exactly long enough to have walked off the platform.
 *
 * ## `v-tap` beside every `@click`
 *
 * `GameScene` calls `preventDefault()` on every touch on the page, so the
 * browser synthesises neither the trailing `click` nor its own scrolling.
 * A `@click`-only control here is dead under a thumb and perfect under a
 * mouse — the failure this codebase has shipped three times. The scroll the
 * grid needs is bought back by `touch-action: pan-y` on the scroller itself
 * (`styles/shop.css`), the same way `.practice-tab-body` does it. And the
 * touch half is `v-tap` (`../tapGuard.ts`), not a bare `@touchend.prevent`:
 * the `touchend` of a *scroll* fires on whichever tile the thumb started
 * from, so the bare form opened an item detail at the end of every swipe
 * through the grid — the guard fires only for a touch that ends near where
 * it began.
 */
import { computed, inject, ref } from 'vue';
import ShopDetail from './ShopDetail.vue';
import ShopItemTile from './ShopItemTile.vue';
import { heldItemIds, shopSections, type SellRow } from './shopState';
import { vTap } from '../tapGuard';
import { InventoryDrag } from '../inventoryDrag';
import type { HudInteractions } from '../hudInteractions';
import type { HudState } from '../hudState';

const props = defineProps<{ state: HudState }>();
defineEmits<{ close: [] }>();

const hud = inject<HudInteractions>('hud')!;

/**
 * Which tile the pane is showing. Session state on purpose: the panel is
 * `v-if`'d out when it closes, so this resets with it, and coming back to a
 * fresh shelf is what a player expects after a trip down the lane.
 */
const pickedId = ref<string | null>(null);

/**
 * Recomputed off the `state` prop rather than on a timer of its own: `state` is
 * a new object on every one of `InGameHUD.ts`'s 20Hz ticks, so depending on it
 * *is* the refresh, and the panel cannot drift out of step with the bar
 * underneath it.
 */
const stock = computed(() => {
  void props.state;
  return hud.shopStock();
});

const bag = computed(() => {
  void props.state;
  return hud.shopBag();
});

/**
 * Whose shop this is, their balance, and whether they may trade — all three
 * from `hud` rather than from `state`, because `HudState` is about **the
 * player**: `state.gold` feeds the desktop bar's gold pill and must keep
 * meaning the player's gold even while this panel is open over a bot's.
 *
 * Recomputed off the `state` prop for the same reason `stock` and `bag` are —
 * it is a new object on every 20Hz tick, so depending on it *is* the refresh.
 */
const subject = computed(() => {
  void props.state;
  return hud.shopSubjectName();
});

const gold = computed(() => {
  void props.state;
  return hud.shopGold();
});

const canTrade = computed(() => {
  void props.state;
  return hud.shopCanTrade();
});

const sections = computed(() => shopSections(stock.value));
const owned = computed(() => heldItemIds(bag.value));

/**
 * Looked up in the live shelf rather than kept as an object, so a picked item
 * re-prices itself as components arrive in the bag — the pane is showing the
 * same row the tile is, on the same tick.
 */
const picked = computed(() => stock.value.find(row => row.id === pickedId.value) ?? null);

/** The bag as a strip: one entry per inventory slot, filled or not. */
const slots = computed(() => {
  const bySlot = new Map<number, SellRow>();
  for (const row of bag.value) bySlot.set(row.slot, row);
  return props.state.items.map((_, slot) => bySlot.get(slot) ?? null);
});

const pick = (id: string) => {
  pickedId.value = id;
};

/**
 * The bag strip's drag, shared with the bar's (`inventoryDrag.ts`).
 *
 * The state machine is plain, so `bump` is what tells Vue a highlight moved:
 * incrementing a ref is cheaper and far less surprising than making a class
 * with a `hypot` in it reactive.
 */
const drag = new InventoryDrag();
const bump = ref(0);

/**
 * Which bag slot is under a screen point, or `null`.
 *
 * `elementFromPoint` rather than `@pointerenter` per slot: a captured pointer
 * — which is every touch drag — stops firing enter and leave on anything it
 * passes over, so per-slot handlers would light nothing on a phone.
 *
 * `data-shop-slot` and not the bar's `data-item-slot`: the bar is on screen
 * underneath this panel on a desktop, and a hit test that could answer with
 * one of *its* slots would let a drag inside the panel drop an item onto a
 * target the player cannot see.
 */
const slotAt = (x: number, y: number): number | null => {
  const under = document.elementFromPoint(x, y)?.closest('[data-shop-slot]');
  const index = under?.getAttribute('data-shop-slot');
  return index === null || index === undefined ? null : Number(index);
};

const onSlotDown = (slot: number, event: PointerEvent): void => {
  // Captured on the slot itself, so a release outside the strip still reaches
  // this component — without it the gesture hangs, holding a highlight for ever.
  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  drag.begin(slot, event.clientX, event.clientY);
  bump.value++;
};

const onSlotMove = (event: PointerEvent): void => {
  if (drag.from === null) return;
  drag.moveTo(event.clientX, event.clientY);
  drag.hover(slotAt(event.clientX, event.clientY));
  bump.value++;
};

/**
 * One release, two meanings. A tap shows that slot's item in the pane; a real
 * drag swaps the two slots. `Champion.moveItem` refuses the pairs that are not
 * moves, so nothing here re-decides that.
 *
 * The starting slot is read *before* `end()`, which resets it: the bar's
 * `'open'` needs no slot because it opens the shop, and this one needs to know
 * which item was tapped.
 */
const onSlotUp = (event: PointerEvent): void => {
  const from = drag.from;
  const gesture = drag.end(slotAt(event.clientX, event.clientY));
  bump.value++;
  if (gesture.kind === 'move') hud.moveItem(gesture.from, gesture.to);
  else if (gesture.kind === 'open' && from !== null) {
    const row = slots.value[from];
    if (row) pick(row.id);
  }
};

const onSlotCancel = (): void => {
  drag.cancel();
  bump.value++;
};

/** The drop highlight. `bump` is read so Vue re-evaluates when the drag moves. */
const dropTarget = (slot: number): boolean => {
  void bump.value;
  return drag.over === slot;
};

const lifted = (slot: number): boolean => {
  void bump.value;
  return drag.dragging && drag.from === slot;
};
</script>

<template>
  <div class="shop-panel" :class="{ 'has-detail': picked !== null }">
    <header class="shop-header">
      <!-- The title carries *whose* shop this is, and only when that is not
           the player — a heading that always names somebody stops being read,
           and the one case where it is load-bearing is the cheat, where the
           gold on screen belongs to a bot. See `hud.shopSubjectName`. -->
      <h3>
        Cửa hàng
        <span v-if="subject" class="shop-subject">{{ subject }}</span>
      </h3>
      <div class="shop-gold">
        <i class="fa-solid fa-coins"></i>
        <span>{{ gold }}</span>
      </div>
      <button
        class="shop-close"
        title="Đóng"
        @click="$emit('close')"
        v-tap="() => $emit('close')"
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </header>

    <!-- The one sentence the grid cannot say for itself. Every tile is greyed
         when the player is away from the platform, which reads as "everything
         is too expensive" without this line naming the actual reason. -->
    <p v-if="!canTrade" class="shop-warning">
      <i class="fa-solid fa-triangle-exclamation"></i>
      Chỉ mua bán được khi đứng trong bệ đá của đội mình
    </p>

    <div class="shop-main">
      <div class="shop-shelf">
        <section v-for="section of sections" :key="section.key" class="shop-section">
          <h4>{{ section.title }}</h4>
          <div class="shop-grid">
            <ShopItemTile
              v-for="row of section.rows"
              :key="row.id"
              :row="row"
              :picked="row.id === pickedId"
              :owned="owned.has(row.id)"
              @pick="pick(row.id)"
            />
          </div>
        </section>

        <p v-if="!sections.length" class="shop-empty">Chưa có pack nào cung cấp trang bị.</p>
      </div>

      <ShopDetail
        :row="picked"
        :rows="stock"
        :bag="bag"
        @pick="pick"
        @back="pickedId = null"
        @buy="id => hud.buy(id)"
        @sell="slot => hud.sell(slot)"
      />
    </div>

    <!-- The bag, as the six slots it actually is rather than as a second list
         of cards. An empty slot is drawn, not omitted, and it takes the same
         handlers as a filled one: "how much room is left" is the question that
         decides whether the next purchase is possible at all, and an empty
         slot is also the commonest place to *drop* something.

         One element type for both, and pointer events on every slot, because
         the gesture is a drag — see this file's header for why that cannot be
         `@click` + `@touchend.prevent` here alone. -->
    <footer class="shop-bag">
      <span class="shop-bag-label">Túi đồ</span>
      <div class="shop-bag-slots">
        <div
          v-for="(row, slot) of slots"
          :key="slot"
          class="shop-bag-slot"
          :data-shop-slot="slot"
          :class="{
            filled: row !== null,
            empty: row === null,
            picked: row !== null && row.id === pickedId,
            'shop-lifted': lifted(slot),
            'shop-drop-target': dropTarget(slot),
          }"
          :title="row ? row.name : ''"
          @pointerdown="onSlotDown(slot, $event)"
          @pointermove="onSlotMove($event)"
          @pointerup="onSlotUp($event)"
          @pointercancel="onSlotCancel()"
        >
          <template v-if="row">
            <!-- `draggable="false"` is load-bearing, not tidiness: an `<img>`
                 is natively draggable, so Chrome starts its own HTML5 drag the
                 moment the pointer travels and fires `pointercancel` at us to
                 say it has taken the gesture. -->
            <img
              v-if="row.image"
              crossorigin="anonymous"
              draggable="false"
              :src="row.image"
              :alt="row.name"
            />
            <span v-else class="shop-bag-blank">{{ row.name.slice(0, 1) }}</span>
            <span class="shop-bag-refund">+{{ row.refund }}</span>
          </template>
        </div>
      </div>
    </footer>
  </div>
</template>
