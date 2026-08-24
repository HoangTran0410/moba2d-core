<script setup lang="ts">
/**
 * The packs screen: what content this browser has installed, and the way to
 * get rid of it. Spec §7 jobs 1 (list) and 3 (remove) — job 2 (add by URL)
 * and job 4 (the install confirmation) are Task 7's, wired into this same
 * component rather than a second screen.
 *
 * `readInstalledPacks`/`writeInstalledPacks` and `packBaseFor`/
 * `packCacheUsage`/`forgetPack` all live under `src/content/`, which
 * `vite.config.ts`'s blanket rule pins to the `pregame` chunk — cheap to
 * fetch from the menu. **`@/content/runtimePacks` is the one exception in
 * that same directory** (pinned to `game`, because it calls
 * `buildContentApi()` for real), and this component must never statically
 * import it — see `PacksScene.ts`'s own header and
 * `tests/scenes/packsBootPath.test.ts`.
 *
 * `<script setup>` is this component's setup function — see CLAUDE.md — so
 * every ref below is rebuilt on each `enter()`. Nothing here needs to
 * outlive an unmount: the installed-pack list itself lives in
 * `localStorage`, read fresh every visit.
 */
import { onMounted, ref } from 'vue';
import {
  readInstalledPacks,
  writeInstalledPacks,
  type InstalledPackRecord,
} from '@/content/installedPackStore';
import { packBaseFor, packCacheUsage, forgetPack } from '@/content/packCache';

const emit = defineEmits<{ close: [] }>();

interface PackRow {
  manifestUrl: string;
  id: string;
  version: string;
  /** The origin, unabbreviated. The whole reason this screen exists. */
  origin: string;
  base: string;
  entries: number;
  bytes: number;
}

/**
 * Duplicated from `src/content/runtimePacks.ts`'s own `DEFAULT_PACK_URL`
 * rather than imported: that module is the one `src/content/` file pinned to
 * the `game` chunk (see this file's header), so reaching it — even just for
 * a string literal — would fetch the whole match to render an empty-state
 * hint. See that file's own doc comment for why this particular host.
 */
const DEFAULT_PACK_URL = 'https://hoangtran99.is-a.dev/moba2d-content-riot/manifest.json';

const rows = ref<PackRow[]>([]);

/** `content-length` is a floor, not an exact size — see `packCache.ts`. */
const formatApproxMB = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

const removeLabel = (row: PackRow): string => {
  if (removingUrl.value === row.manifestUrl) return 'Đang gỡ…';
  if (confirmingUrl.value === row.manifestUrl) return 'Chắc chưa?';
  return 'Gỡ';
};

onMounted(() => {
  const installed = readInstalledPacks();
  const initial: PackRow[] = [];
  for (const record of installed) {
    const base = packBaseFor(record.manifestUrl);
    // `base` is already `new URL('./', manifestUrl).href` (see
    // `packCache.ts`), so its origin is the manifest's origin too — falls
    // back to the raw stored string rather than throwing: a stored URL is a
    // stranger's string (see `installedPackStore.ts`'s own header), and
    // `packBaseFor` already answers `''` for one `new URL` cannot parse.
    let origin = record.manifestUrl;
    try {
      origin = new URL(base || record.manifestUrl).origin;
    } catch {
      // Left as the raw stored string above.
    }
    initial.push({
      manifestUrl: record.manifestUrl,
      id: record.id,
      version: record.version,
      origin,
      base,
      entries: 0,
      bytes: 0,
    });
  }
  rows.value = initial;

  // Fetched per row, not awaited as a batch before the list ever renders:
  // `packCacheUsage` walks the whole shared pack cache once per call, and
  // one slow or huge pack must not hold every other row's numbers off the
  // screen.
  for (const row of initial) {
    void packCacheUsage(row.base).then(usage => {
      const current = rows.value.find(candidate => candidate.manifestUrl === row.manifestUrl);
      if (current) {
        current.entries = usage.entries;
        current.bytes = usage.bytes;
      }
    });
  }
});

const confirmingUrl = ref<string | null>(null);
const removingUrl = ref<string | null>(null);

/**
 * Removal reloads; adding (Task 7) does not.
 *
 * `rebuildContentRegistry()` discards the registry and reinstalls the bundled
 * halves — so after a removal it would leave the *other* still-installed
 * runtime packs out until something reinstalled them, and the thing that
 * reinstalls them is the boot path. Adding is additive and has no such
 * problem: the new pack installs into the live registry beside everything
 * already there, which is what spec §5.2 asks for.
 */
const removePack = async (row: PackRow): Promise<void> => {
  removingUrl.value = row.manifestUrl;
  await forgetPack(row.base);
  const remaining: InstalledPackRecord[] = [];
  for (const stored of readInstalledPacks()) {
    if (stored.manifestUrl !== row.manifestUrl) remaining.push(stored);
  }
  writeInstalledPacks(remaining);
  location.reload();
};

/**
 * Two steps, the same shape `MatchTab.vue`'s exit-match control uses: the
 * first press only arms the button (label flips to "Chắc chưa?"), the second
 * — on that same row — is the one that actually deletes anything. Pressing
 * a *different* row's Gỡ re-arms onto that row instead of firing the old one.
 */
const requestRemove = (row: PackRow): void => {
  if (removingUrl.value) return;
  if (confirmingUrl.value !== row.manifestUrl) {
    confirmingUrl.value = row.manifestUrl;
    return;
  }
  void removePack(row);
};
</script>

<template>
  <div class="packs-panel">
    <header class="packs-header">
      <h1>Pack nội dung</h1>
      <button
        type="button"
        class="packs-close"
        id="packs-close"
        title="Quay lại"
        @click="emit('close')"
        @touchend.prevent="emit('close')"
      >
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
      </button>
    </header>

    <div class="packs-body">
      <ul v-if="rows.length" class="packs-list">
        <li v-for="row in rows" :key="row.manifestUrl" class="packs-row">
          <div class="packs-row-head">
            <span class="packs-id">{{ row.id }}</span>
            <span class="packs-version">v{{ row.version }}</span>
          </div>
          <p class="packs-origin">{{ row.origin }}</p>
          <p class="packs-usage">{{ row.entries }} tệp · ~{{ formatApproxMB(row.bytes) }} MB</p>
          <button
            type="button"
            class="packs-remove"
            :class="{ confirming: confirmingUrl === row.manifestUrl }"
            :disabled="removingUrl === row.manifestUrl"
            @click="requestRemove(row)"
            @touchend.prevent="requestRemove(row)"
          >
            <i class="fas fa-trash" aria-hidden="true"></i>
            <span>{{ removeLabel(row) }}</span>
          </button>
        </li>
      </ul>

      <div v-else class="packs-empty">
        <p>Chưa cài pack nào.</p>
        <p class="packs-empty-hint">
          Pack mặc định: <span class="packs-origin">{{ DEFAULT_PACK_URL }}</span>
        </p>
      </div>
    </div>
  </div>
</template>
