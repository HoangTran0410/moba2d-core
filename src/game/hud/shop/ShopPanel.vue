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
 * ## `@touchend.prevent` beside every `@click`
 *
 * `GameScene` calls `preventDefault()` on every touch on the page, so the
 * browser synthesises neither the trailing `click` nor its own scrolling.
 * A `@click`-only control here is dead under a thumb and perfect under a
 * mouse — the failure this codebase has shipped three times. The scroll the
 * grid needs is bought back by `touch-action: pan-y` on the scroller itself
 * (`styles/shop.css`), the same way `.practice-tab-body` does it.
 */
import { computed, inject, ref } from 'vue';
import ShopDetail from './ShopDetail.vue';
import ShopItemTile from './ShopItemTile.vue';
import { heldItemIds, shopSections, type SellRow } from './shopState';
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
</script>

<template>
  <div class="shop-panel" :class="{ 'has-detail': picked !== null }">
    <header class="shop-header">
      <h3>Cửa hàng</h3>
      <div class="shop-gold">
        <i class="fa-solid fa-coins"></i>
        <span>{{ state.gold }}</span>
      </div>
      <button
        class="shop-close"
        title="Đóng"
        @click="$emit('close')"
        @touchend.prevent="$emit('close')"
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </header>

    <!-- The one sentence the grid cannot say for itself. Every tile is greyed
         when the player is away from the platform, which reads as "everything
         is too expensive" without this line naming the actual reason. -->
    <p v-if="!state.canShop" class="shop-warning">
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
        :can-shop="state.canShop"
        @pick="pick"
        @back="pickedId = null"
        @buy="id => hud.buy(id)"
        @sell="slot => hud.sell(slot)"
      />
    </div>

    <!-- The bag, as the six slots it actually is rather than as a second list
         of cards. An empty slot is drawn, not omitted: "how much room is left"
         is the question that decides whether the next purchase is even
         possible, and `NO_SLOT` is a refusal a player should see coming. -->
    <footer class="shop-bag">
      <span class="shop-bag-label">Túi đồ</span>
      <div class="shop-bag-slots">
        <template v-for="(row, slot) of slots" :key="slot">
          <button
            v-if="row"
            class="shop-bag-slot filled"
            :class="{ picked: row.id === pickedId }"
            :title="row.name"
            @click="pick(row.id)"
            @touchend.prevent="pick(row.id)"
          >
            <img v-if="row.image" crossorigin="anonymous" :src="row.image" :alt="row.name" />
            <span v-else class="shop-bag-blank">{{ row.name.slice(0, 1) }}</span>
            <span class="shop-bag-refund">+{{ row.refund }}</span>
          </button>
          <span v-else class="shop-bag-slot empty"></span>
        </template>
      </div>
    </footer>
  </div>
</template>
