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
import { ref } from 'vue';
import { vTap } from './tapGuard';
import type { DeathRecapDisplay } from './hudState';

const props = defineProps<{ recap: DeathRecapDisplay }>();

const dismissedSeq = ref(0);
const dismiss = (): void => {
  dismissedSeq.value = props.recap.seq;
};
</script>

<template>
  <div v-if="recap.seq !== dismissedSeq" class="death-recap">
    <div class="death-recap-head">
      <span class="death-recap-title">
        <i class="fas fa-skull" aria-hidden="true"></i>
        Hạ gục bởi <b>{{ recap.killer }}</b>
      </span>
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
    <div class="death-recap-rows">
      <div v-for="row in recap.rows" :key="row.attacker" class="death-recap-row">
        <div class="death-recap-attacker">
          <span class="death-recap-attacker-name">{{ row.attacker }}</span>
          <span class="death-recap-attacker-total">{{ row.total }}</span>
        </div>
        <div v-for="line in row.sources" :key="line.label + line.type" class="death-recap-source">
          <span class="death-recap-source-label">{{ line.label }}</span>
          <span v-if="line.hits > 1" class="death-recap-source-hits">×{{ line.hits }}</span>
          <span class="death-recap-source-amount" :class="'dmg-' + line.type.toLowerCase()">
            {{ line.amount }}
          </span>
        </div>
      </div>
    </div>
    <div class="death-recap-total">
      Tổng <b>{{ recap.total }}</b> sát thương phải chịu
    </div>
  </div>
</template>
