<script setup lang="ts">
/**
 * Cửa hàng — the fountain shop, over a *running* match.
 *
 * ## It does not pause, and that is the design
 *
 * Every other panel in this HUD pauses the game. This one must not: pausing at
 * will would make the shop a way to freeze a fight, and "you may only buy at
 * your own fountain" is only a rule while the world keeps moving. It also
 * means every card's refusal stays live — walk off the platform and the whole
 * grid greys out under the cursor, which is how the rule teaches itself in one
 * match instead of never.
 *
 * ## The panel decides nothing
 *
 * Every "can I buy this" on screen comes from `ItemShop.refusalFor`, through
 * `shopState.ts`, and every purchase goes back through `ItemShop.buyItem`
 * which re-checks all of it. The template computes no affordability of its
 * own — a greyed button whose greying was worked out in a `v-if` is a second
 * implementation of the shop's rules, and the day the two disagree the player
 * is looking at a button that says yes and a purchase that says no.
 *
 * The re-check is not belt-and-braces either: this repaints on the HUD's 20Hz
 * tick, so a card can be a fifth of a second out of date by the time it is
 * clicked — which is exactly long enough to have walked off the platform.
 *
 * ## `@touchend.prevent` beside every `@click`
 *
 * `GameScene` calls `preventDefault()` on every touch on the page, so the
 * browser synthesises neither the trailing `click` nor its own scrolling.
 * A `@click`-only control here is dead under a thumb and perfect under a
 * mouse — the failure this codebase has shipped three times.
 */
import { computed, inject } from 'vue';
import type { HudInteractions } from '../hudInteractions';
import type { HudState } from '../hudState';

const props = defineProps<{ state: HudState }>();
defineEmits<{ close: [] }>();

const hud = inject<HudInteractions>('hud')!;

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
</script>

<template>
  <div class="shop-panel">
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

    <!-- The one sentence the grid cannot say for itself. Every card is greyed
         when the player is away from the platform, which reads as "everything
         is too expensive" without this line naming the actual reason. -->
    <p v-if="!state.canShop" class="shop-warning">
      <i class="fa-solid fa-triangle-exclamation"></i>
      Chỉ mua bán được khi đứng trong bệ đá của đội mình
    </p>

    <div class="shop-body">
      <section class="shop-stock">
        <button
          v-for="row of stock"
          :key="row.id"
          class="shop-card"
          :class="{ blocked: row.refusal !== null }"
          :title="row.reason"
          @click="hud.buy(row.id)"
          @touchend.prevent="hud.buy(row.id)"
        >
          <div class="shop-card-top">
            <img v-if="row.image" crossorigin="anonymous" :src="row.image" :alt="row.name" />
            <!-- No art is a real state (a pack naming a key nothing
                 registered), and an initial is legible where a broken-image
                 glyph is just noise. -->
            <span v-else class="shop-card-blank">{{ row.name.slice(0, 1) }}</span>
            <div class="shop-card-name">
              <strong>{{ row.name }}</strong>
              <span v-if="row.hasActive" class="shop-card-active">Kích hoạt</span>
            </div>
            <span class="shop-card-cost"><i class="fa-solid fa-coins"></i>{{ row.cost }}</span>
          </div>

          <ul v-if="row.stats.length" class="shop-card-stats">
            <li v-for="line of row.stats" :key="line.label">
              <span class="amount">{{ line.amount }}</span> {{ line.label }}
            </li>
          </ul>

          <p v-if="row.description" class="shop-card-text">{{ row.description }}</p>
          <p v-if="row.reason" class="shop-card-reason">{{ row.reason }}</p>
        </button>

        <p v-if="!stock.length" class="shop-empty">Chưa có pack nào cung cấp trang bị.</p>
      </section>

      <section class="shop-bag">
        <h4>Túi đồ</h4>
        <p v-if="!bag.length" class="shop-empty">Chưa mua gì.</p>
        <button
          v-for="row of bag"
          :key="row.slot"
          class="shop-sell"
          :class="{ blocked: !state.canShop }"
          :title="state.canShop ? 'Bán' : 'Phải đứng ở bệ đá'"
          @click="hud.sell(row.slot)"
          @touchend.prevent="hud.sell(row.slot)"
        >
          <img v-if="row.image" crossorigin="anonymous" :src="row.image" :alt="row.name" />
          <span class="shop-sell-name">{{ row.name }}</span>
          <span class="shop-sell-refund"><i class="fa-solid fa-coins"></i>{{ row.refund }}</span>
        </button>
      </section>
    </div>
  </div>
</template>
