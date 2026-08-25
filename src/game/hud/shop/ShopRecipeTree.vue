<script setup lang="ts">
/**
 * The build tree under an item — "ghép từ", drawn as a nested list.
 *
 * Wild Rift draws this as a little pyramid of icons with connector lines.
 * This draws the same *information* as an indented list with a rule down the
 * left, because the pyramid needs horizontal room a 232px pane does not have
 * and gets narrower per level exactly as the names get longer. Indentation
 * says "made of" just as clearly and survives a phone.
 *
 * Every node is a button: tapping a component opens *its* detail, which is how
 * a player reads a build order backwards from the thing they want. That is the
 * behaviour worth copying from Wild Rift, more than the shape.
 *
 * The tick is `link.owned`, which on a recipe entry means **this purchase
 * would consume that copy** — not merely "one is somewhere in the bag". See
 * `RecipeLink.owned`. A recipe naming one component twice against a bag
 * holding one ticks exactly one row, because ticking both would promise a
 * discount the shop is not going to give.
 *
 * Recursive by filename: a `<script setup>` SFC may refer to itself.
 */
import type { RecipeNode } from './shopState';

defineProps<{ nodes: RecipeNode[] }>();
defineEmits<{ pick: [id: string] }>();
</script>

<template>
  <ul class="shop-tree">
    <li v-for="node of nodes" :key="node.link.id">
      <button
        class="shop-tree-node"
        :class="{ held: node.link.owned }"
        @click="$emit('pick', node.link.id)"
        @touchend.prevent="$emit('pick', node.link.id)"
      >
        <img
          v-if="node.link.image"
          crossorigin="anonymous"
          :src="node.link.image"
          :alt="node.link.name"
        />
        <span v-else class="shop-tree-blank">{{ node.link.name.slice(0, 1) }}</span>
        <span class="shop-tree-name">{{ node.link.name }}</span>
        <span class="shop-tree-cost"> <i class="fa-solid fa-coins"></i>{{ node.link.cost }} </span>
        <i v-if="node.link.owned" class="shop-tree-tick fa-solid fa-check"></i>
      </button>

      <ShopRecipeTree
        v-if="node.parts.length"
        :nodes="node.parts"
        @pick="id => $emit('pick', id)"
      />
    </li>
  </ul>
</template>
