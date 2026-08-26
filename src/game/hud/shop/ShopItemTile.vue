<script setup lang="ts">
/**
 * One square on the shelf: art, a price, and nothing else.
 *
 * The whole redesign is in what this file *does not* draw. Every card used to
 * be a full-width button carrying its own name, stat list, description and
 * refusal sentence stacked vertically, so fourteen items were a very long
 * scroll of near-identical text blocks and no two could be compared side by
 * side. A tile the eye can sweep has to be the size of its icon, which means
 * everything else moves to `ShopDetail.vue` — the tile's job is to be findable
 * and to say what it costs.
 *
 * Three marks survive that cut, and each earns its pixels:
 *
 *   - **the price**, which is `price` and not `cost` — what this champion pays
 *     right now. When the two differ the total is struck through beside it, or
 *     a player holding two components sees a number drop with no explanation.
 *   - **a tick**, when the bag already holds one. Cheap to draw and it is the
 *     question a player asks most while browsing.
 *   - **a bolt**, when the item brings a key to press. An active is a mechanic,
 *     not a stat, and it is the one property worth knowing before you open
 *     anything.
 *
 * `blocked` is `row.refusal !== null` — the shop's own answer, read, never
 * recomputed. See `ShopPanel.vue`'s header.
 */
import { computed } from 'vue';
import { priceLabel, type ShopRow } from './shopState';
import { vTap } from '../tapGuard';

const props = defineProps<{
  row: ShopRow;
  /** This is the tile the detail pane is showing. */
  picked: boolean;
  /** The bag already holds one of these. */
  owned: boolean;
}>();

defineEmits<{ pick: [] }>();

const price = computed(() => priceLabel(props.row));

/**
 * The hover text, which is a mouse's consolation prize: under a thumb there is
 * no `title`, and the refusal is carried properly by the detail pane's own
 * buy button instead.
 */
const hint = computed(() =>
  props.row.reason ? `${props.row.name} — ${props.row.reason}` : props.row.name
);
</script>

<template>
  <button
    class="shop-tile"
    :class="{ blocked: row.refusal !== null, picked, owned }"
    :title="hint"
    @click="$emit('pick')"
    v-tap="() => $emit('pick')"
  >
    <img v-if="row.image" crossorigin="anonymous" :src="row.image" :alt="row.name" />
    <!-- No art is a real state (a pack naming a key nothing registered), and an
         initial is legible where a broken-image glyph is just noise. -->
    <span v-else class="shop-tile-blank">{{ row.name.slice(0, 1) }}</span>

    <span class="shop-tile-price" :class="{ discounted: price.discounted }">
      <s v-if="price.discounted">{{ price.total }}</s
      >{{ price.pay }}
    </span>

    <i v-if="row.hasActive" class="shop-tile-flag fa-solid fa-bolt"></i>
    <i v-if="owned" class="shop-tile-tick fa-solid fa-check"></i>
  </button>
</template>
