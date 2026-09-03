<script setup lang="ts">
/**
 * The death recap: who killed the player and what the last seconds of damage
 * were made of, the way the source game retells a death. Mounted once from
 * `InGameHUD`, above whichever view (`DesktopHudView` / `MobileHudView`) is
 * up, so both modes share one panel — the same reason the shop lives there.
 *
 * Shown while dead, dismissable, and re-shown on the next death: `recap.seq`
 * bumps per death, and the panel remembers only which seq was closed.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { vTap } from './tapGuard';
import { loadRecapCollapsed, saveRecapCollapsed } from './deathRecapPrefs';
import type { DeathRecapDisplay } from './hudState';

const props = defineProps<{
  recap: DeathRecapDisplay;
  /** While dead a stray tap must not eat the panel; alive, any tap outside closes it. */
  isDead: boolean;
}>();

const dismissedSeq = ref(0);
const dismiss = (): void => {
  dismissedSeq.value = props.recap.seq;
};

/** Collapsed = just the killer headline. Persisted — see deathRecapPrefs. */
const collapsed = ref(loadRecapCollapsed());
const toggleCollapse = (): void => {
  collapsed.value = !collapsed.value;
  saveRecapCollapsed(collapsed.value);
};

/**
 * Tap-outside-to-close, but only once respawned: while dead the player is
 * *reading*, and there is nothing else those taps could mean; alive, the
 * first order they give the game doubles as "done with the recap".
 * `pointerdown` because `GameScene` calls `preventDefault()` on every touch,
 * which kills synthesized clicks but never the pointer stream.
 */
const panelEl = ref<HTMLElement | null>(null);
const onOutsidePointer = (event: PointerEvent): void => {
  if (props.isDead) return;
  if (props.recap.seq === dismissedSeq.value) return;
  if (panelEl.value && event.target instanceof Node && panelEl.value.contains(event.target)) return;
  dismiss();
};
onMounted(() => document.addEventListener('pointerdown', onOutsidePointer, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutsidePointer, true));
</script>

<template>
  <div
    v-if="recap.seq !== dismissedSeq"
    ref="panelEl"
    class="death-recap"
    :class="{ collapsed }"
  >
    <div class="death-recap-head">
      <span class="death-recap-title">
        <i class="fas fa-skull" aria-hidden="true"></i>
        Hạ gục bởi <b>{{ recap.killer }}</b>
      </span>
      <button
        type="button"
        class="death-recap-close"
        :title="collapsed ? 'Mở rộng' : 'Thu gọn'"
        :aria-label="collapsed ? 'Mở rộng bảng tổng kết' : 'Thu gọn bảng tổng kết'"
        :aria-expanded="!collapsed"
        @click="toggleCollapse()"
        v-tap="toggleCollapse"
      >
        <i class="fas" :class="collapsed ? 'fa-chevron-down' : 'fa-chevron-up'" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="death-recap-close"
        title="Đóng"
        aria-label="Đóng bảng tổng kết"
        @click="dismiss()"
        v-tap="dismiss"
      >
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
    </div>
    <div v-show="!collapsed" class="death-recap-rows">
      <div v-for="row in recap.rows" :key="row.attacker" class="death-recap-row">
        <div class="death-recap-attacker">
          <span class="death-recap-attacker-name">{{ row.attacker }}</span>
          <span class="death-recap-attacker-total">{{ row.total }}</span>
        </div>
        <div v-for="line in row.sources" :key="line.label + line.type" class="death-recap-source">
          <img
            v-if="line.image"
            crossorigin="anonymous"
            class="death-recap-source-icon"
            :src="line.image"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span v-else class="death-recap-source-dot" aria-hidden="true"></span>
          <span class="death-recap-source-label">{{ line.label }}</span>
          <span v-if="line.hits > 1" class="death-recap-source-hits">×{{ line.hits }}</span>
          <!-- What a shield ate out of this source, when it ate anything. A
               source that landed nothing at all shows only the blocked figure,
               which is the whole point: it *was* there, and the bubble is why
               it did not count. -->
          <span v-if="line.blocked > 0" class="death-recap-source-blocked" title="Bị khiên chặn">
            <i class="fas fa-shield-alt" aria-hidden="true"></i>{{ line.blocked }}
          </span>
          <span class="death-recap-source-amount" :class="'dmg-' + line.type.toLowerCase()">
            {{ line.amount }}
          </span>
        </div>
      </div>
    </div>
    <div v-show="!collapsed" class="death-recap-total">
      Tổng <b>{{ recap.total }}</b> sát thương phải chịu
      <!-- Its own clause rather than folded into the total: the two answer
           different questions, and adding them would break the figure a player
           checks against their own health pool. -->
      <span v-if="recap.blocked > 0" class="death-recap-blocked-total">
        · khiên chặn <b>{{ recap.blocked }}</b>
      </span>
    </div>
    <!-- Match totals, unlike everything above it, so it is labelled and ruled
         off rather than left to look like part of the fight. -->
    <div v-show="!collapsed" class="death-recap-dealt">
      <span class="death-recap-dealt-label">Bạn đã gây (cả trận)</span>
      <span class="death-recap-dealt-figures">
        <span class="dmg-physical">{{ recap.dealt.physical }}</span>
        <span class="dmg-magic">{{ recap.dealt.magic }}</span>
        <span class="dmg-true">{{ recap.dealt.true }}</span>
      </span>
    </div>
  </div>
</template>
