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
 * **It traps focus and answers Escape.** This is an `alertdialog` covering a
 * screen whose input field is still in the tab order behind it — a keyboard
 * player could Tab straight past the disclosure onto that field, type, and
 * press Enter, and the confirmation would still be sitting there unanswered.
 * The trap is hand-rolled over exactly two buttons rather than pulled from a
 * library, and Escape maps to Huỷ, never to Cài đặt: the safe answer is the
 * one a key pressed by reflex has to give.
 *
 * **Re-checks compatibility itself rather than trusting a prop.**
 * `fetchPackManifest` has already applied `satisfiesCoreRange` — a manifest
 * that failed it never reaches this component, `PacksScene.vue` shows the
 * error inline instead — but "should be impossible" is not "is enforced
 * here", so the refusal is rendered for real rather than assumed away.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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

// ------------------------------------------------- Escape, and the focus trap

const dialog = ref<HTMLElement | null>(null);
/** Whatever had focus when this mounted — the URL field, or the Kiểm tra button. */
let restoreFocusTo: HTMLElement | null = null;

/**
 * The dialog's own focusable controls in tab order, disabled ones excluded.
 * Read on every keystroke rather than cached: `installing` and `compatible`
 * both disable a button, so the list this trap has to cycle changes while the
 * dialog is on screen.
 */
const focusables = (): HTMLElement[] => {
  const root = dialog.value;
  if (!root) return [];
  const found: HTMLElement[] = [];
  for (const node of root.querySelectorAll<HTMLElement>('button, a[href]')) {
    if (!(node as HTMLButtonElement).disabled) found.push(node);
  }
  return found;
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    // `onCancel` is already a no-op while installing, which is what makes
    // Escape safe mid-install rather than a second thing to guard here.
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key !== 'Tab') return;

  const stops = focusables();
  // Both buttons are disabled while `installing`, so there is nothing to
  // cycle — but Tab must still not walk out into the screen behind. It goes
  // to the dialog itself, which carries `tabindex="-1"` for exactly this.
  if (!stops.length) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }

  const first = stops[0];
  const last = stops[stops.length - 1];
  const active = document.activeElement as HTMLElement | null;

  // Focus is outside the dialog: the player clicked the backdrop, or the
  // field behind it kept focus. Pull it back in rather than letting Tab
  // continue from wherever it was.
  if (!active || !dialog.value?.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
};

onMounted(() => {
  restoreFocusTo = document.activeElement as HTMLElement | null;
  // Huỷ, not Cài đặt — `focusables()` is in DOM order and Huỷ is first. The
  // keyboard's default answer to a dialog that exists to ask "are you sure"
  // has to be the one that runs nothing.
  (focusables()[0] ?? dialog.value)?.focus();
  // Capture, on `window` rather than on the dialog element: a keydown while
  // focus sits on the backdrop never reaches the dialog by bubbling.
  window.addEventListener('keydown', onKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
  // Back where it came from, so cancelling with Escape leaves the caret in
  // the URL field the player was already typing into.
  restoreFocusTo?.focus?.();
});
</script>

<template>
  <div class="pack-confirm-backdrop">
    <div
      id="pack-install-confirm"
      ref="dialog"
      class="pack-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pack-confirm-origin"
      aria-describedby="pack-confirm-authority"
      tabindex="-1"
    >
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
      <p id="pack-confirm-authority" class="pack-confirm-authority">
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
