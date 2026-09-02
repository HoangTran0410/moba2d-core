<script setup lang="ts">
/**
 * One folding section of a config tab: a header that is also the fold's
 * handle, and a body that hides behind it.
 *
 * ## Why the header carries a summary
 *
 * A tab of twelve controls is a wall the first time it opens, and the player
 * said so. Folding them into four or five sections fixes the wall, but a row
 * of bare titles then says nothing about the match — so a folded header
 * states the current values in one muted line ("CDR 80% · không mana"), and
 * the tab reads as a compact overview until a section is opened. Open, the
 * summary steps aside: the controls are the values.
 *
 * `v-show`, not `v-if`: the controls keep their ids and state while folded,
 * so an e2e script that opens every section (`openPanelSections` in
 * `tests/e2e/harness.mjs`) finds the same elements it always drove.
 *
 * Which sections are open is remembered — `panelSections.ts` says why.
 */
import { computed } from 'vue';
import { isSectionOpen, toggleSection } from './panelSections';
import { vTap } from '../tapGuard';

const props = withDefaults(
  defineProps<{
    /** Stable key the fold is remembered under, e.g. `match-rules`. */
    id: string;
    title: string;
    /** The current values in one line, shown while folded. */
    summary?: string;
    defaultOpen?: boolean;
  }>(),
  { summary: '', defaultOpen: false }
);

const open = computed(() => isSectionOpen(props.id, props.defaultOpen));
const toggle = (): void => toggleSection(props.id, props.defaultOpen);
</script>

<template>
  <section class="panel-section" :class="{ open }" :data-section="id">
    <button
      type="button"
      class="panel-section-head"
      :aria-expanded="open"
      :aria-controls="`panel-section-${id}`"
      :title="open ? `Thu gọn ${title}` : `Mở ${title}`"
      @click="toggle"
      v-tap="toggle"
    >
      <i class="fas fa-chevron-down panel-section-chevron" aria-hidden="true"></i>
      <span class="panel-section-title">{{ title }}</span>
      <span v-if="summary && !open" class="panel-section-summary">{{ summary }}</span>
    </button>
    <div v-show="open" :id="`panel-section-${id}`" class="panel-section-body">
      <slot />
    </div>
  </section>
</template>
