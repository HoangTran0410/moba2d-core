<script setup lang="ts">
/**
 * The packs screen: what content this browser has installed, the way to get
 * rid of it, and — as of Task 7 — the way to add more. Spec §7's four jobs,
 * all in one screen: list (Task 6), remove (Task 6), add by URL and the
 * install confirmation (both Task 7), the last wired in as
 * `PackInstallConfirm.vue` rather than inlined here — see that file's own
 * header for why.
 *
 * `readInstalledPacks`/`writeInstalledPacks` and `packBaseFor`/
 * `packCacheUsage`/`forgetPack` all live under `src/content/`, which
 * `vite.config.ts`'s blanket rule pins to the `pregame` chunk — cheap to
 * fetch from the menu. **`@/content/runtimePacks` is the one exception in
 * that same directory** (pinned to `game`, because it calls
 * `buildContentApi()` for real), and this component must never statically
 * import it — see `PacksScene.ts`'s own header and
 * `tests/scenes/packsBootPath.test.ts`. `@/content/packSource` is a
 * `pregame`-chunked module and a static import of it would not fail that
 * test, but it is still reached dynamically here: the fetch it performs only
 * happens on a button press, and there is no reason to put it on the menu's
 * path. `PackInstallConfirm.vue` is loaded through `defineAsyncComponent`
 * for the same reason — it statically imports `packSource.ts` itself (for
 * `satisfiesCoreRange`), and a static import of *that component* here would
 * undo the laziness of the dynamic import below by pulling the same module
 * in through a second, eager edge.
 *
 * `<script setup>` is this component's setup function — see CLAUDE.md — so
 * every ref below is rebuilt on each `enter()`. Nothing here needs to
 * outlive an unmount: the installed-pack list itself lives in
 * `localStorage`, read fresh every visit, and a pending "Kiểm tra" fetch or
 * an open confirmation is discarded the same way — see `PackInstallConfirm.vue`'s
 * own header on why that is safe rather than a leak: nothing installs until
 * "Cài đặt" is actually pressed.
 */
import { defineAsyncComponent, onMounted, ref } from 'vue';
import {
  readInstalledPacks,
  writeInstalledPacks,
  type InstalledPackRecord,
} from '@/content/installedPackStore';
import { packBaseFor, packCacheUsage, forgetPack } from '@/content/packCache';
import type { PackLoadError, RuntimePackManifest } from '@/content/packSource';
import { resetPregameCatalog } from './setup/pregameCatalog';

const emit = defineEmits<{ close: [] }>();

// Not a static `import PackInstallConfirm from './packs/PackInstallConfirm.vue'`
// — see this file's own header just above.
const PackInstallConfirm = defineAsyncComponent(() => import('./packs/PackInstallConfirm.vue'));

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

/**
 * `base` is already `new URL('./', manifestUrl).href` (see `packCache.ts`),
 * so its origin is the manifest's origin too — falls back to the raw stored
 * string rather than throwing: a manifest URL is a stranger's string (see
 * `installedPackStore.ts`'s own header), and `packBaseFor` already answers
 * `''` for one `new URL` cannot parse. Shared by the initial load below and
 * by `confirmInstall`, which builds a row for a pack that just installed
 * without a page reload to re-derive it from.
 */
const originOf = (manifestUrl: string, base: string): string => {
  try {
    return new URL(base || manifestUrl).origin;
  } catch {
    return manifestUrl;
  }
};

onMounted(() => {
  const installed = readInstalledPacks();
  const initial: PackRow[] = [];
  for (const record of installed) {
    const base = packBaseFor(record.manifestUrl);
    initial.push({
      manifestUrl: record.manifestUrl,
      id: record.id,
      version: record.version,
      origin: originOf(record.manifestUrl, base),
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

// -------------------------------------------------------------- Add by URL

const url = ref('');
/** Disables the input and "Kiểm tra" while a manifest fetch is in flight, so a second press cannot start a second fetch. */
const checking = ref(false);
const checkError = ref<string | null>(null);

/** Set once `fetchPackManifest` succeeds — its presence is what opens `PackInstallConfirm`. Nothing here has imported, let alone run, the pack's own code yet. */
const pendingManifest = ref<RuntimePackManifest | null>(null);
const pendingManifestUrl = ref('');
const coreVersion = ref('');

/** Disables both confirmation buttons while `installPackNow` is in flight, so a second press of "Cài đặt" cannot start a second install. */
const installing = ref(false);
const installError = ref<string | null>(null);

/**
 * Step 2 of spec §3: fetch and check the manifest — plain JSON, nothing the
 * pack wrote as code has run. Step 3 (`import()`) only happens from
 * `confirmInstall`, behind the player's own press of "Cài đặt".
 */
const checkUrl = async (): Promise<void> => {
  // The input sits behind `PackInstallConfirm`'s full-body backdrop while a
  // confirmation is up (z-index, not a `disabled` attribute), so a click
  // cannot reach it — but a field that already had keyboard focus before the
  // backdrop appeared can still receive a stray `keyup.enter`. Guarded here
  // too, not only visually.
  if (checking.value || pendingManifest.value) return;
  const trimmed = url.value.trim();
  if (!trimmed) return;
  checking.value = true;
  checkError.value = null;
  try {
    // Dynamic: `packSource.ts` is a `pregame`-chunked module this screen has
    // no reason to fetch before a player actually presses this button — see
    // this file's own header.
    const { fetchPackManifest, CORE_VERSION } = await import('@/content/packSource');
    const manifest = await fetchPackManifest(trimmed);
    pendingManifest.value = manifest;
    pendingManifestUrl.value = trimmed;
    coreVersion.value = CORE_VERSION;
  } catch (thrown) {
    const error = thrown as PackLoadError;
    checkError.value = `${error.stage ?? 'import'}: ${error.message ?? String(thrown)}`;
  } finally {
    checking.value = false;
  }
};

/** Changes nothing: no manifest was ever imported, no pack was ever installed. */
const cancelInstall = (): void => {
  pendingManifest.value = null;
  pendingManifestUrl.value = '';
  installError.value = null;
};

/**
 * Step 3: the player has seen the origin and pressed through. `installPackNow`
 * is reached dynamically — `runtimePacks.ts` is the one `src/content/` module
 * pinned to the `game` chunk, and `tests/scenes/packsBootPath.test.ts` bans
 * the static form.
 */
const confirmInstall = async (): Promise<void> => {
  if (installing.value || !pendingManifest.value) return;
  const manifest = pendingManifest.value;
  const manifestUrl = pendingManifestUrl.value;
  installing.value = true;
  installError.value = null;
  try {
    const { installPackNow } = await import('@/content/runtimePacks');
    const outcome = await installPackNow(manifestUrl, manifest);
    if (outcome.ok === false) {
      installError.value = `${outcome.stage}: ${outcome.message}`;
      return;
    }
    // The pregame roster picker memoises its catalogue on the (now outdated)
    // assumption that it never changes at runtime — see that module's own
    // doc comment. Without this, the roster only grows after a reload, which
    // is exactly what spec §5.2 and this screen exist to not require.
    resetPregameCatalog();
    // A pack already present under this id (`skipped: true`) is already a
    // row in this list from the initial `onMounted` read — nothing to add.
    const alreadyListed = rows.value.some(row => row.manifestUrl === manifestUrl);
    if (!alreadyListed) {
      const base = packBaseFor(manifestUrl);
      const newRow: PackRow = {
        manifestUrl,
        id: outcome.id,
        version: manifest.version,
        origin: originOf(manifestUrl, base),
        base,
        entries: 0,
        bytes: 0,
      };
      rows.value = [...rows.value, newRow];
      void packCacheUsage(base).then(usage => {
        const current = rows.value.find(candidate => candidate.manifestUrl === manifestUrl);
        if (current) {
          current.entries = usage.entries;
          current.bytes = usage.bytes;
        }
      });
    }
    url.value = '';
    pendingManifest.value = null;
    pendingManifestUrl.value = '';
  } finally {
    installing.value = false;
  }
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
      <div class="packs-add">
        <label class="packs-add-label" for="pack-url-input">Thêm bằng URL</label>
        <div class="packs-add-row">
          <input
            id="pack-url-input"
            v-model="url"
            type="url"
            inputmode="url"
            autocomplete="off"
            placeholder="https://vi-du.com/pack/manifest.json"
            :disabled="checking"
            @keyup.enter="checkUrl"
          />
          <button
            type="button"
            id="pack-url-check"
            :disabled="checking || !url.trim()"
            @click="checkUrl"
            @touchend.prevent="checkUrl"
          >
            {{ checking ? 'Đang kiểm tra…' : 'Kiểm tra' }}
          </button>
        </div>
        <p v-if="checkError" class="packs-add-error">{{ checkError }}</p>
      </div>

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

      <PackInstallConfirm
        v-if="pendingManifest"
        :manifest-url="pendingManifestUrl"
        :manifest="pendingManifest"
        :core-version="coreVersion"
        :installing="installing"
        :error="installError"
        @confirm="confirmInstall"
        @cancel="cancelInstall"
      />
    </div>
  </div>
</template>
