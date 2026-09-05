<script setup lang="ts">
/**
 * "Mốc đã lưu" — the fight save points modal, over the paused match.
 *
 * The pause+screen pattern the practice panel established: `openCheckpoints`
 * *is* `pause()` plus this screen and the button that undoes it, so there is
 * never an invisible paused state with no way out on screen. Mounted from
 * `InGameHUD.vue` as a sibling of `MatchConfigPanel`, behind the same kind
 * of `v-if`, and never rendered in a LAN match — the corner button hides and
 * `openCheckpoints` refuses.
 *
 * Everything on a row is a plain view model (`CheckpointRow`); every press
 * goes back through `HudInteractions`, which owns the checkpoint list on
 * `Game`. The rewind is a two-step confirm because it replaces the fight in
 * progress; the delete is two-step for the usual reason; the save is one
 * press with no dialog, because saving is the thing this feature wants
 * spammed.
 *
 * "Lưu vào thư viện" persists a row to `config/savedMoments.ts`, which is
 * what the menu's own "Mốc đã lưu" shelf lists — and the note under the list
 * says the one honest limitation out loud: transient buffs do not follow a
 * moment across sessions.
 */
import { inject, ref } from 'vue';
import type { CheckpointRow, HudInteractions } from './hudInteractions';
import { SAVED_MOMENT_NAME_MAX } from '@/game/config/savedMoments';
import { vTap } from './tapGuard';

const hud = inject<HudInteractions>('hud')!;

const rows = ref<CheckpointRow[]>(hud.checkpointRows());
const refresh = (): void => {
  rows.value = hud.checkpointRows();
};

const saveNew = (): void => {
  hud.saveCheckpoint();
  refresh();
};

/** Two-step per row, armed independently of the delete's confirm. */
const confirmingRewindId = ref<string | null>(null);
const rewind = (row: CheckpointRow): void => {
  if (confirmingRewindId.value !== row.id) {
    confirmingRewindId.value = row.id;
    return;
  }
  confirmingRewindId.value = null;
  // Closes the modal itself when the restore ran.
  hud.rewindToCheckpoint(row.id);
  refresh();
};

const keep = (row: CheckpointRow): void => {
  if (row.kept) return;
  hud.keepCheckpoint(row.id);
  refresh();
};

const confirmingDeleteId = ref<string | null>(null);
const remove = (row: CheckpointRow): void => {
  if (confirmingDeleteId.value !== row.id) {
    confirmingDeleteId.value = row.id;
    return;
  }
  confirmingDeleteId.value = null;
  hud.deleteCheckpoint(row.id);
  refresh();
};

const renamingId = ref<string | null>(null);
const renameDraft = ref('');
const startRename = (row: CheckpointRow): void => {
  renamingId.value = row.id;
  renameDraft.value = row.name;
};
const cancelRename = (): void => {
  renamingId.value = null;
};
const commitRename = (): void => {
  if (renamingId.value && renameDraft.value.trim())
    hud.renameCheckpoint(renamingId.value, renameDraft.value);
  renamingId.value = null;
  refresh();
};
</script>

<template>
  <div class="checkpoint-panel" id="checkpoint-panel">
    <div class="checkpoint-head">
      <span class="checkpoint-title">
        <i class="fas fa-clock-rotate-left" aria-hidden="true"></i>
        Mốc đã lưu
      </span>
      <button
        type="button"
        class="practice-close"
        id="checkpoint-close"
        title="Đóng"
        @click="hud.closeCheckpoints()"
        v-tap="() => hud.closeCheckpoints()"
      >
        <i class="fas fa-times"></i>
      </button>
    </div>

    <div class="checkpoint-body">
      <button
        type="button"
        class="template-chip template-start checkpoint-save-btn"
        id="checkpoint-save"
        @click="saveNew"
        v-tap="saveNew"
      >
        <i class="fas fa-plus" aria-hidden="true"></i>
        Lưu mốc mới
      </button>

      <ul class="checkpoint-list">
        <li v-for="(row, i) in rows" :key="row.id" class="checkpoint-row">
          <template v-if="renamingId === row.id">
            <input
              type="text"
              class="template-name-input"
              :id="`checkpoint-rename-input-${i}`"
              v-model="renameDraft"
              :maxlength="SAVED_MOMENT_NAME_MAX"
              @keydown.enter="commitRename"
              @keydown.esc="cancelRename"
            />
            <div class="template-actions">
              <button
                type="button"
                class="template-chip"
                :id="`checkpoint-rename-commit-${i}`"
                @click="commitRename"
                v-tap="commitRename"
              >
                Lưu tên
              </button>
              <button
                type="button"
                class="template-chip"
                @click="cancelRename"
                v-tap="cancelRename"
              >
                Huỷ
              </button>
            </div>
          </template>

          <template v-else>
            <div class="template-main">
              <span class="template-title">
                <strong class="template-name">{{ row.name }}</strong>
                <span class="template-when">phút {{ row.clock }}</span>
                <span v-if="row.auto" class="checkpoint-auto-tag">Tự động</span>
              </span>
              <span class="template-meta">{{ row.summary }}</span>
            </div>
            <div class="template-actions">
              <button
                type="button"
                class="template-chip template-start"
                :class="{ confirming: confirmingRewindId === row.id }"
                :id="`checkpoint-rewind-${i}`"
                @click="rewind(row)"
                v-tap="() => rewind(row)"
              >
                {{ confirmingRewindId === row.id ? 'Chắc chưa?' : 'Quay lại' }}
              </button>
              <button
                type="button"
                class="template-chip"
                :id="`checkpoint-keep-${i}`"
                :disabled="row.kept"
                @click="keep(row)"
                v-tap="() => keep(row)"
              >
                {{ row.kept ? 'Đã lưu ✓' : 'Lưu vào thư viện' }}
              </button>
              <button
                type="button"
                class="template-chip"
                :class="{ confirming: confirmingDeleteId === row.id }"
                :id="`checkpoint-delete-${i}`"
                @click="remove(row)"
                v-tap="() => remove(row)"
              >
                {{ confirmingDeleteId === row.id ? 'Chắc chưa?' : 'Xoá' }}
              </button>
            </div>
          </template>
        </li>
      </ul>

      <p class="practice-note">
        Quay lại đưa trận đấu về đúng khoảnh khắc đã lưu — vị trí, máu, vàng, trang bị, hồi chiêu và
        hiệu ứng đang chạy. Lưu vào thư viện để mở lại từ menu ở phiên sau; buff tạm thời không theo
        mốc qua phiên.
      </p>
    </div>
  </div>
</template>
