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
 * something is picked. On a short screen the two share the space by turns: the
 * grid fills it, picking a tile swaps the pane in over it, and the pane's
 * "‹ Danh sách" button (hidden entirely on a wide screen) swaps back. One
 * `has-detail` class on this element is the whole switch; see `styles/shop.css`
 * for the media query that decides which layout is in force. The panel still
 * may not cover the champion and the fountain, since the rule it enforces is
 * about where the player is *standing*.
 *
 * The markup is arranged for the *short* screen, because that is the one with
 * a problem. A landscape phone gives this sheet about 350px of height and
 * nearly 850px of width, and it was spending ~170 of the height on a header, a
 * search band, a chip row and the bag — the shelf got two rows of tiles while
 * half the screen beside the panel stayed empty. So nothing that can be a rail
 * down the side is written as a band across the top: the search box is a child
 * of `.shop-header`, and the chips are a direct child of the panel so the
 * compact grid can stand them on their end beside `.shop-main` rather than
 * above it. Both read the same on a wide screen, where the row has the room.
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
import { heldItemIds, packSections, shopSections, type SellRow } from './shopState';
import {
  filterRows,
  groupChips,
  groupStatChips,
  isFiltering,
  loadShopFilter,
  saveShopFilter,
  type ShopFilter,
  type StatGroupKey,
} from './shopFilter';
import { contentRegistry } from '@/content/registry';
import type { ItemStatKey } from '@/game/items/itemStats';
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

// Both read `props.state` so they re-evaluate on the panel's own 20Hz tick —
// a purchase made from the keyboard or by the host has to light the buttons
// up here too, and neither is a Vue-reactive source.
const canUndo = computed(() => {
  void props.state;
  return hud.canUndoShop();
});

const canRedo = computed(() => {
  void props.state;
  return hud.canRedoShop();
});

/**
 * The search box and the chips, restored from the last time the shop was open.
 *
 * Not `<script setup>` state alone: this component is `v-if`'d, so everything
 * declared here dies the moment the panel closes — and the shop is opened and
 * closed several times on one trip to the fountain. Re-typing "giáp" or
 * re-tapping three chips each time is the whole of the friction the filter
 * exists to remove. `shopFilter.ts` keeps it the same guarded `moba2d:*` way
 * the death recap keeps its collapse.
 */
const filter = ref<ShopFilter>(loadShopFilter());

const setFilter = (next: ShopFilter): void => {
  filter.value = next;
  saveShopFilter(next);
};

const searchText = computed({
  get: () => filter.value.text,
  set: (text: string) => setFilter({ ...filter.value, text }),
});

const toggleStat = (key: ItemStatKey): void => {
  const stats = filter.value.stats.includes(key)
    ? filter.value.stats.filter(other => other !== key)
    : [...filter.value.stats, key];
  setFilter({ ...filter.value, stats });
};

/**
 * One family open at a time. Re-tapping the open one closes it; switching
 * families drops the picked stats with the family they were refining — a
 * lit armour chip inside a closed Phòng Thủ would filter the grid by a
 * control that is no longer on screen.
 */
const toggleGroup = (key: StatGroupKey): void => {
  const group = filter.value.group === key ? null : key;
  setFilter({ ...filter.value, group, stats: [] });
};

const clearFilter = (): void => setFilter({ text: '', group: null, stats: [] });

const filtering = computed(() => isFiltering(filter.value));

/**
 * Both tiers come off the **whole** shelf, never off the filtered one.
 *
 * Built from `filtered` they would rearrange themselves under the pointer as
 * soon as anything was picked — the chip just tapped might vanish, since
 * nothing left on the shelf grants a second stat — which is a control that
 * fights the person using it.
 */
const groups = computed(() => groupChips(stock.value));
const chips = computed(() =>
  filter.value.group === null ? [] : groupStatChips(stock.value, filter.value.group)
);

const filtered = computed(() => filterRows(stock.value, filter.value));

/**
 * One pack stocking the shop keeps the classic split (buy whole / combined);
 * two or more switch the headings to the packs themselves — "which game is
 * this item from" became the harder question the day a second pack's shelf
 * mixed into the grid, and the registry's install order keeps the shelves
 * where a player left them.
 */
const sections = computed(() => {
  const rows = filtered.value;
  const registry = contentRegistry();
  const stocked = new Set(stock.value.map(row => row.id.split(':')[0] ?? ''));
  if (stocked.size <= 1) return shopSections(rows);
  return packSections(rows, registry.packIds(), id => registry.packName(id));
});
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

      <!--
        The search box, in the header rather than on a line of its own beneath
        it.

        On a phone held sideways this panel is about 350px tall, and the title,
        the box, the chips and the bag were taking ~170 of them: half the sheet
        was chrome and the grid it exists to show was two rows deep. A box on
        its own line costs ~38px of that, for one control that is already the
        same height as the four beside it up here — and the header has width to
        spare on every screen this ships to, because the panel is landscape
        everywhere (`OrientationHint.vue`).

        `.lazy` is deliberately absent — the grid narrows as the letters land,
        which is the whole feel of the control. `@keydown.escape` clears rather
        than closing the shop: an empty box over a filtered grid is the one
        state a player gets stuck in without a way out that is not the mouse.
      -->
      <label class="shop-search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input
          v-model="searchText"
          type="search"
          placeholder="Tìm trang bị…"
          aria-label="Tìm trang bị"
          @keydown.escape.stop="clearFilter()"
        />
      </label>

      <div class="shop-gold">
        <i class="fa-solid fa-coins"></i>
        <span>{{ gold }}</span>
      </div>

      <!--
        Undo, and not "sell it back": a sale refunds 70%, which is the price of
        changing your mind, and clicking the wrong tile is not a change of mind
        — see `economy/ShopHistory.ts`. Both handlers doubled with `v-tap`,
        because `GameScene` calls `preventDefault()` on every touch on the page
        and a `@click`-only control is dead under a thumb.
      -->
      <div class="shop-history">
        <button
          class="shop-step"
          title="Hoàn tác (trả lại đúng số vàng đã trả)"
          :disabled="!canUndo"
          @click="hud.undoShop()"
          v-tap="() => hud.undoShop()"
        >
          <i class="fa-solid fa-rotate-left"></i>
        </button>
        <button
          class="shop-step"
          title="Làm lại"
          :disabled="!canRedo"
          @click="hud.redoShop()"
          v-tap="() => hud.redoShop()"
        >
          <i class="fa-solid fa-rotate-right"></i>
        </button>
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
         when the player is out of reach, which reads as "everything is too
         expensive" without this line naming the actual reason.

         It used to say "đứng trong bệ đá", which was true only by accident: a
         fountain's shop reach and its platform were one number until a map
         could widen the first (`FountainStats.shopRange`). On a map that does,
         the sentence sent people walking all the way onto a platform they were
         already able to buy from. "Tầm mua đồ" is the same phrase the map
         picker's rules list and the editor's ring both use, so the three
         surfaces name one rule once. -->
    <p v-if="!canTrade" class="shop-warning">
      <i class="fa-solid fa-triangle-exclamation"></i>
      Chỉ mua bán được khi ở trong tầm mua đồ của bệ đá đội mình
    </p>

    <!--
      The filter, in two tiers: five family buttons, and — only while one is
      open — that family's own stat chips beneath them. One chip per stat was
      the whole control once, and the packs outgrew it: every shelf they added
      pushed the row toward all ~20 keys, three wrapped rows of pills before
      the first tile. Nobody shops by scanning twenty pills; they think "đồ
      chống chịu" first and "giáp hay kháng phép" second, so the control asks
      in that order. Both tiers stay put when the panel closes
      (`shopFilter.ts`) — the shop is opened and shut several times on one
      trip to the fountain.

      Two rows above the grid where there is height for them, and one vertical
      icon rail down the left of the grid where there is not — the same trade
      every phone MOBA's shop makes, because a landscape phone is wide and
      short and a band across the top is the most expensive place to put
      anything. `styles/shop.css` decides which; the markup is one, and this
      wrapper is what the compact grid places (`grid-area: rail`), so the two
      tiers travel together.

      The word is in the DOM either way. The rail hides the labels and every
      button carries the same word as its `title` and `aria-label`, so on a
      phone the label is a tooltip and an accessible name rather than
      something that was never written.
    -->
    <div v-if="groups.length" class="shop-filters">
      <div class="shop-groups">
        <button
          v-for="group of groups"
          :key="group.key"
          type="button"
          class="shop-group"
          :class="{ 'is-on': filter.group === group.key }"
          :title="group.label"
          :aria-label="group.label"
          :aria-pressed="filter.group === group.key"
          @click="toggleGroup(group.key)"
          v-tap="() => toggleGroup(group.key)"
        >
          <i class="fa-solid shop-chip-icon" :class="group.icon" aria-hidden="true"></i>
          <span class="shop-chip-label">{{ group.label }}</span>
          <span class="shop-chip-count">{{ group.count }}</span>
        </button>

        <!-- Only while something is on. A permanently visible clear button is
             a control that does nothing most of the time. -->
        <button
          v-if="filtering"
          type="button"
          class="shop-group is-clear"
          title="Bỏ hết bộ lọc"
          aria-label="Bỏ hết bộ lọc"
          @click="clearFilter()"
          v-tap="() => clearFilter()"
        >
          <i class="fa-solid fa-xmark shop-chip-icon" aria-hidden="true"></i>
          <span class="shop-chip-label">Xoá lọc</span>
        </button>
      </div>

      <!-- The open family's refinement: "something with armour", for the
           player who knows what they want and not what it is called. A chip
           exists exactly when some item on this shelf grants that stat, and
           each wears the stat's own icon from `statIcons.ts` — the same one
           the roster's stat sheet draws. -->
      <div v-if="chips.length" class="shop-chips">
        <button
          v-for="chip of chips"
          :key="chip.key"
          type="button"
          class="shop-chip"
          :class="{ 'is-on': filter.stats.includes(chip.key) }"
          :title="chip.label"
          :aria-label="chip.label"
          :aria-pressed="filter.stats.includes(chip.key)"
          @click="toggleStat(chip.key)"
          v-tap="() => toggleStat(chip.key)"
        >
          <i class="fa-solid shop-chip-icon" :class="chip.icon" aria-hidden="true"></i>
          <span class="shop-chip-label">{{ chip.label }}</span>
          <span class="shop-chip-count">{{ chip.count }}</span>
        </button>
      </div>
    </div>

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

        <!-- Two different empty shelves, and telling them apart matters: one
             is a build with no items in it, the other is a filter the player
             can undo — and the second one comes with the button that undoes
             it, because the chips may have scrolled out of sight. -->
        <p v-if="!sections.length && filtering" class="shop-empty">
          Không có trang bị nào khớp bộ lọc.
          <button
            type="button"
            class="shop-empty-clear"
            @click="clearFilter()"
            v-tap="() => clearFilter()"
          >
            Xoá lọc
          </button>
        </p>
        <p v-else-if="!sections.length" class="shop-empty">
          Chưa có pack nào cung cấp trang bị.
        </p>
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
