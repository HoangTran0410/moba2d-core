<script setup lang="ts">
/**
 * Everything a tile stopped carrying: the pane on the right.
 *
 * ## What it holds, and why in this order
 *
 * A player opens this to answer one of three questions, and they arrive in
 * this order — *what does it cost me*, *what does it do*, *what is it made
 * of*. So: the price and the buy button first, at the top where a thumb
 * already is; then stats and the one-line description; then the build tree.
 * The tree is last because it is the longest and the only part that scrolls
 * away without loss.
 *
 * ## The two prices
 *
 * `cost` is what the item is worth and `price` is what this champion pays
 * right now — the same number until a component lands in the bag. The buy
 * button prints `price`, and the line under it prints the total and the
 * difference *only* when they differ (`priceLabel`), because a price that
 * silently dropped is the one thing "ghép đồ" can do that a player cannot
 * otherwise see.
 *
 * ## Buying and selling are two deliberate buttons
 *
 * The old panel bought on a click anywhere on a full-width card and sold on a
 * click anywhere on a bag row — so a mis-tap while browsing spent gold, and a
 * mis-tap on the bag sold an item outright, irreversibly, for 70% of what it
 * cost. Selecting and transacting are now different gestures: a tile opens
 * this pane, and only the labelled button here moves anything.
 *
 * ## It decides nothing, on either half
 *
 * `row.refusal` is the shop's own answer and `row.reason` is its sentence;
 * this file reads both and computes neither. The sell button was the one
 * exception for a while — it gated on `canShop`, which is one of the two rules
 * `sellItem` applies, so a dead champion standing on their own platform saw a
 * Bán button that looked enabled and did nothing. That is the same "the button
 * says yes and the purchase says no" failure the buy side was built against,
 * reproduced on the other half of the same panel, and it happened precisely
 * because only one half had a seam to ask. `ItemShop.sellRefusalFor` is now
 * that seam, and `SellRow` carries its answer and its sentence exactly the way
 * `ShopRow` carries `refusalFor`'s.
 */
import { computed } from 'vue';
import ShopRecipeTree from './ShopRecipeTree.vue';
import { bagSlotOf, priceLabel, recipeTree, type SellRow, type ShopRow } from './shopState';

const props = defineProps<{
  /** The item being shown, or null when nothing has been picked yet. */
  row: ShopRow | null;
  /** The whole shelf — the build tree is a join of rows onto rows. */
  rows: ShopRow[];
  bag: SellRow[];
}>();

defineEmits<{ pick: [id: string]; back: []; buy: [id: string]; sell: [slot: number] }>();

const price = computed(() => (props.row ? priceLabel(props.row) : null));
const tree = computed(() => (props.row ? recipeTree(props.rows, props.row.id) : []));
/** The bag row for this item, or null — what makes the sell button appear. */
const held = computed(() => (props.row ? bagSlotOf(props.bag, props.row.id) : null));
</script>

<template>
  <aside class="shop-detail">
    <!-- Compact layouts only (see `styles/shop.css`): there the pane covers the
         grid rather than sitting beside it, and a way back is the whole
         difference between a drill-down and a dead end. -->
    <button class="shop-detail-back" @click="$emit('back')" @touchend.prevent="$emit('back')">
      <i class="fa-solid fa-chevron-left"></i> Danh sách
    </button>

    <template v-if="row && price">
      <div class="shop-detail-scroll">
        <header class="shop-detail-head">
          <img v-if="row.image" crossorigin="anonymous" :src="row.image" :alt="row.name" />
          <span v-else class="shop-detail-blank">{{ row.name.slice(0, 1) }}</span>
          <div>
            <h4>{{ row.name }}</h4>
            <span v-if="row.hasActive" class="shop-detail-active">
              <i class="fa-solid fa-bolt"></i> Có kích hoạt
            </span>
          </div>
        </header>

        <button
          class="shop-buy"
          :class="{ blocked: row.refusal !== null }"
          @click="$emit('buy', row.id)"
          @touchend.prevent="$emit('buy', row.id)"
        >
          <span class="shop-buy-label">Mua</span>
          <span class="shop-buy-price"><i class="fa-solid fa-coins"></i>{{ price.pay }}</span>
        </button>
        <p v-if="row.reason" class="shop-buy-why">{{ row.reason }}</p>
        <!-- Only when the two numbers differ. Otherwise it is the same figure
             twice, which reads as a second, different price. -->
        <p v-if="price.discounted" class="shop-buy-total">
          Tổng {{ price.total }} — đã có {{ price.saved }} trong túi
        </p>

        <template v-if="held">
          <button
            class="shop-sell"
            :class="{ blocked: held.refusal !== null }"
            @click="$emit('sell', held.slot)"
            @touchend.prevent="$emit('sell', held.slot)"
          >
            <span class="shop-sell-label">Bán</span>
            <span class="shop-sell-price"><i class="fa-solid fa-coins"></i>+{{ held.refund }}</span>
          </button>
          <p v-if="held.reason" class="shop-sell-why">{{ held.reason }}</p>
        </template>

        <ul v-if="row.stats.length" class="shop-detail-stats">
          <li v-for="line of row.stats" :key="line.label">
            <span class="amount">{{ line.amount }}</span> {{ line.label }}
          </li>
        </ul>

        <!-- Never `v-html`: this sentence comes from a stranger's content pack. -->
        <p v-if="row.description" class="shop-detail-text">{{ row.description }}</p>

        <section v-if="tree.length" class="shop-detail-section">
          <h5>Ghép từ</h5>
          <ShopRecipeTree :nodes="tree" @pick="id => $emit('pick', id)" />
        </section>

        <section v-if="row.buildsInto.length" class="shop-detail-section">
          <h5>Ghép thành</h5>
          <div class="shop-into">
            <button
              v-for="parent of row.buildsInto"
              :key="parent.id"
              class="shop-into-chip"
              :class="{ held: parent.owned }"
              @click="$emit('pick', parent.id)"
              @touchend.prevent="$emit('pick', parent.id)"
            >
              <img
                v-if="parent.image"
                crossorigin="anonymous"
                :src="parent.image"
                :alt="parent.name"
              />
              <span v-else class="shop-into-blank">{{ parent.name.slice(0, 1) }}</span>
              <span class="shop-into-name">{{ parent.name }}</span>
              <span class="shop-into-cost">
                <i class="fa-solid fa-coins"></i>{{ parent.cost }}
              </span>
            </button>
          </div>
        </section>
      </div>
    </template>

    <p v-else class="shop-detail-placeholder">Chọn một trang bị để xem chi tiết.</p>
  </aside>
</template>
