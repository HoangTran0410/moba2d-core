<script setup lang="ts">
/**
 * The screen that pays for "any URL may be installed".
 *
 * Spec §2.1 is explicit that `validate.ts` stops a pack that is the wrong
 * *shape*, and stops nothing that is deliberately hostile: a pack is
 * JavaScript running in the player's page, on the page's origin, with the
 * page's `localStorage` and the page's DOM. A real sandbox was considered and
 * ruled out — spells draw with p5 globals and a Worker cannot draw — so the
 * mitigation is not defence, it is disclosure: the player is told whose code
 * they are about to run, before it runs.
 *
 * Which makes the *order* of what is on screen part of the contract, not
 * styling. The origin is first, largest, and never elided; a shortened origin
 * is precisely the trick this screen exists to defeat.
 *
 * Its own component rather than a block inside `PacksScene.vue` so that
 * editing the list, the empty state or the remove button cannot quietly
 * reword this.
 *
 * **Loaded only through `defineAsyncComponent` in `PacksScene.vue`.** This
 * component statically imports `satisfiesCoreRange` from `@/content/packSource`
 * — the same module `PacksScene.vue`'s own fetch call reaches only
 * dynamically, precisely so it is not on the menu's path (see that file's own
 * header). A *static* import of this component from `PacksScene.vue` would
 * drag `packSource.ts` into the packs screen's own chunk regardless of
 * whether a player ever types a URL; the async wrapper is what keeps it lazy.
 *
 * **Re-checks compatibility itself rather than trusting a prop.**
 * `fetchPackManifest` has already applied `satisfiesCoreRange` — a manifest
 * that failed it never reaches this component, `PacksScene.vue` shows the
 * error inline instead — but "should be impossible" is not "is enforced
 * here", so the refusal is rendered for real rather than assumed away.
 */
import { computed } from 'vue';
import { satisfiesCoreRange, type RuntimePackManifest } from '@/content/packSource';

const props = defineProps<{
  manifestUrl: string;
  manifest: RuntimePackManifest;
  coreVersion: string;
  /** True while `installPackNow` is in flight — disables both buttons so a second press cannot start a second install. */
  installing?: boolean;
  /** Set when a confirmed install came back `ok: false`; shown so the player is not left staring at a stalled button. */
  error?: string | null;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

/**
 * The one line this whole screen exists for. `manifestUrl` is a stranger's
 * string — a relative or malformed value falls back to the raw string rather
 * than throwing, same as `PacksScene.vue`'s own origin derivation.
 */
const origin = computed(() => {
  try {
    return new URL(props.manifestUrl).origin;
  } catch {
    return props.manifestUrl;
  }
});

const compatible = computed(() => satisfiesCoreRange(props.manifest.coreRange, props.coreVersion));

const onCancel = (): void => {
  if (props.installing) return;
  emit('cancel');
};

const onConfirm = (): void => {
  if (props.installing || !compatible.value) return;
  emit('confirm');
};
</script>

<template>
  <div class="pack-confirm-backdrop">
    <div id="pack-install-confirm" class="pack-confirm" role="alertdialog" aria-modal="true">
      <!-- 1. Origin — largest type on the screen, never elided. -->
      <p id="pack-confirm-origin" class="pack-confirm-origin">{{ origin }}</p>

      <!-- 2. Name and version. -->
      <p class="pack-confirm-name">{{ manifest.name }} · v{{ manifest.version }}</p>

      <!-- 3. coreRange result. -->
      <p class="pack-confirm-compat" :class="{ 'pack-confirm-refused': !compatible }">
        <template v-if="compatible">Tương thích với core {{ coreVersion }}</template>
        <template v-else
          >Không tương thích: pack cần core {{ manifest.coreRange }}, bản này là
          {{ coreVersion }}.</template
        >
      </p>

      <!-- 4. Champion count, when the manifest declared one. -->
      <p v-if="manifest.champions" class="pack-confirm-champions">{{ manifest.champions }} tướng</p>

      <!-- 5. The authority sentence, verbatim. -->
      <p class="pack-confirm-authority">
        Pack sẽ chạy với toàn quyền trên trang này — đọc và sửa được cấu hình, giao diện và dữ liệu
        của bạn. Chỉ cài từ nguồn bạn tin.
      </p>

      <p v-if="error" class="pack-confirm-error">{{ error }}</p>

      <!-- 6. Huỷ (default) and Cài đặt (destructive — the one that runs code). -->
      <footer class="pack-confirm-actions">
        <button
          type="button"
          id="pack-confirm-cancel"
          class="pack-confirm-cancel"
          :disabled="installing"
          @click="onCancel"
          @touchend.prevent="onCancel"
        >
          Huỷ
        </button>
        <button
          type="button"
          id="pack-confirm-install"
          class="pack-confirm-install"
          :disabled="!compatible || installing"
          @click="onConfirm"
          @touchend.prevent="onConfirm"
        >
          {{ installing ? 'Đang cài…' : 'Cài đặt' }}
        </button>
      </footer>

      <!-- The full manifest URL, beneath, dimmed: the origin above is the
           security-relevant part, this is context. -->
      <p class="pack-confirm-url">{{ manifestUrl }}</p>
    </div>
  </div>
</template>
