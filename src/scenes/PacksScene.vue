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
 * in through a second, eager edge. `./setup/pregameCatalog` is reached
 * dynamically too, from `confirmInstall` — it statically imports
 * `@/game/config/spellCatalog`, and `packsBootPath.test.ts`'s per-file scan
 * cannot see that chain behind a specifier that does not itself say
 * `@/game/`, so keeping it dynamic here is what actually keeps it true
 * rather than merely untested.
 *
 * It opens with what a pack *is* — three steps and the warning that matters,
 * folded away once anything is installed. That explanation used to live on
 * the About screen, one scene away from every button that acts on it.
 *
 * Then three sections in the order a player meets them: **Đã cài**
 * (what this browser has), **Pack có sẵn** (the shelf, from
 * `./packs/suggestedPacks.ts`), and **Thêm bằng URL** last. Add-by-URL was
 * first when it was the only way to add anything; the shelf's Cài button runs
 * the same `checkUrl` a pasted URL runs, so being on the shelf buys a pack a
 * button and not a shortcut past the origin disclosure.
 *
 * `<script setup>` is this component's setup function — see CLAUDE.md — so
 * every ref below is rebuilt on each `enter()`. Nothing here needs to
 * outlive an unmount: the installed-pack list itself lives in
 * `localStorage`, read fresh every visit, and a pending "Kiểm tra" fetch or
 * an open confirmation is discarded the same way — see `PackInstallConfirm.vue`'s
 * own header on why that is safe rather than a leak: nothing installs until
 * "Cài đặt" is actually pressed.
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  readInstalledPacks,
  writeInstalledPacks,
  type InstalledPackRecord,
} from '@/content/installedPackStore';
import { packBaseFor, packCacheUsage, forgetPack } from '@/content/packCache';
import type { PackLoadError, RuntimePackManifest } from '@/content/packSource';
import { packStageLabel } from './packStageLabel';
import { SUGGESTED_PACKS, type SuggestedPack } from './packs/suggestedPacks';

const emit = defineEmits<{ close: [] }>();

interface PackRow {
  manifestUrl: string;
  id: string;
  version: string;
  /** The origin, unabbreviated. The whole reason this screen exists. */
  origin: string;
  base: string;
  /** `-1` until `packCacheUsage` answers — see `usageLabel`. */
  entries: number;
  bytes: number;
}

const rows = ref<PackRow[]>([]);

/**
 * What this browser has cached of a pack, in a sentence rather than in two
 * numbers that can both legitimately be zero.
 *
 * `entries` starts at `-1`, not `0`: the count arrives from `packCacheUsage`
 * one round trip after the row is drawn, so a row that has not been measured
 * yet and a row with genuinely nothing cached are different facts and used to
 * render identically — as `0 tệp · ~0.0 MB`, which reads as a broken row
 * rather than as "not saved yet". The second state is real and reachable
 * today: a pack whose manifest declares no `files` installs and plays and
 * prefetches nothing (see `packSource.ts`), so this is what the shipped
 * default pack currently shows.
 *
 * `content-length` is a floor, not an exact size — see `packCache.ts` — hence
 * the `~`, and KB below a megabyte so a small pack does not round to nothing.
 */
const usageLabel = (row: PackRow): string => {
  if (row.entries < 0) return 'Đang xem dung lượng đã lưu…';
  if (row.entries === 0) return 'Chưa lưu để chơi offline';
  const size =
    row.bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(row.bytes / 1024))} KB`
      : `${(row.bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${row.entries} tệp · ~${size}`;
};

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

/**
 * Built here rather than in `onMounted`, which is where it used to be.
 * `readInstalledPacks` is a `localStorage` read and needs no DOM, and
 * `onMounted` runs *after* the first render — so for one frame the list was
 * empty on every visit, and `nothingInstalled` below was briefly true. The
 * explainer at the top of the template binds its `open` state to that, so a
 * player with a pack installed watched it spring open and shut again each
 * time they opened this screen.
 */
const initialRows: PackRow[] = [];
for (const record of readInstalledPacks()) {
  const base = packBaseFor(record.manifestUrl);
  initialRows.push({
    manifestUrl: record.manifestUrl,
    id: record.id,
    version: record.version,
    origin: originOf(record.manifestUrl, base),
    base,
    entries: -1,
    bytes: 0,
  });
}
rows.value = initialRows;

onMounted(() => {
  // Fetched per row, not awaited as a batch before the list ever renders:
  // `packCacheUsage` walks the whole shared pack cache once per call, and
  // one slow or huge pack must not hold every other row's numbers off the
  // screen.
  for (const row of initialRows) {
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
 * Not a static `import PackInstallConfirm from './packs/PackInstallConfirm.vue'`
 * — see this file's own header. Declared here rather than beside the other
 * imports so `onError` below can close over `checkError`/`pendingManifest`/
 * `pendingManifestUrl`, already in scope by this point.
 *
 * **`onError` covers the offline case this whole plan is about.** If the
 * confirmation's own chunk cannot be fetched, `fail()` renders nothing
 * instead of retrying forever — and clearing the pending state here is what
 * stops `checkUrl`'s own `pendingManifest` guard from locking the player out
 * of ever pressing "Kiểm tra" again; without it the screen would look dead
 * with no dialog, no error, and no way forward but leaving it.
 */
const PackInstallConfirm = defineAsyncComponent({
  loader: () => import('./packs/PackInstallConfirm.vue'),
  onError(error, _retry, fail) {
    fail();
    checkError.value = `${packStageLabel('import')}: không tải được màn xác nhận (${(error as Error)?.message ?? String(error)})`;
    pendingManifest.value = null;
    pendingManifestUrl.value = '';
  },
});

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
  // The origin is the one field `PackInstallConfirm` exists to show, in the
  // largest type on the screen. A value `new URL()` cannot parse — a
  // relative path, a protocol-relative `//host/manifest.json` — must never
  // reach it: `resolveWithin` (`packSource.ts`) would refuse to *install*
  // from one, but this screen's own contract is the origin is never wrong,
  // not merely never dangerous.
  try {
    new URL(trimmed);
  } catch {
    checkError.value = `${packStageLabel('manifest')}: URL không hợp lệ (thiếu scheme, ví dụ https://)`;
    return;
  }
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
    checkError.value = `${packStageLabel(error.stage ?? 'import')}: ${error.message ?? String(thrown)}`;
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
    // Both dynamic, and both for the same reason (see this file's own
    // header): `runtimePacks.ts` is the one `src/content/` module pinned to
    // the `game` chunk, and `pregameCatalog.ts` statically imports
    // `@/game/config/spellCatalog` — a static import of either here would
    // put that chain on the packs screen's own chunk.
    const [{ installPackNow }, { resetPregameCatalog }] = await Promise.all([
      import('@/content/runtimePacks'),
      import('./setup/pregameCatalog'),
    ]);
    const outcome = await installPackNow(manifestUrl, manifest);
    if (outcome.ok === false) {
      installError.value = `${packStageLabel(outcome.stage)}: ${outcome.message}`;
      return;
    }
    if (outcome.skipped) {
      // The id was already installed — under this exact URL (already a row
      // from `onMounted`) or under a *different* one (never a row here at
      // all). Either way `installPackNow` wrote nothing new, so adding a row
      // keyed on `manifestUrl` would list a pack this browser does not
      // actually remember: it vanishes on the next reload, and removing it
      // here would `forgetPack` a base that was never cached under this URL.
      checkError.value = `Pack "${outcome.id}" đã được cài rồi.`;
    } else {
      // The pregame roster picker memoises its catalogue on the (now
      // outdated) assumption that it never changes at runtime — see that
      // module's own doc comment. Without this, the roster only grows after
      // a reload, which is exactly what spec §5.2 and this screen exist to
      // not require. Not called on a skip: nothing changed for it to see.
      resetPregameCatalog();
      const base = packBaseFor(manifestUrl);
      const newRow: PackRow = {
        manifestUrl,
        id: outcome.id,
        version: manifest.version,
        origin: originOf(manifestUrl, base),
        base,
        entries: -1,
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

// ------------------------------------------------------------ Suggested packs

/**
 * Is this shelf entry already installed?
 *
 * By id *or* by URL, not by URL alone: `installPackNow` refuses a second copy
 * of an id already in the registry (`skipped: true`) whatever URL it came
 * from, so a player who installed the riot pack from a mirror would otherwise
 * be offered a "Cài" button that can only ever answer "đã được cài rồi".
 */
const isInstalled = (pack: SuggestedPack): boolean => {
  for (const row of rows.value) {
    if (row.manifestUrl === pack.manifestUrl || row.id === pack.id) return true;
  }
  return false;
};

/**
 * The shelf's one-press install.
 *
 * It fills the URL field and runs the *same* `checkUrl` a pasted URL runs —
 * it does not reach `installPackNow`, and it must not start. Being listed in
 * `packs/suggestedPacks.ts` buys a pack a button, not trust: the origin
 * disclosure in `PackInstallConfirm.vue` stands in front of a suggested pack
 * exactly as it stands in front of a stranger's, and that is the whole of the
 * security model (see that component's own header).
 *
 * Filling the field rather than passing the URL straight to `checkUrl` is
 * deliberate too: whatever happens next — a confirmation, an error line — the
 * player can see which URL it was about.
 */
const installSuggested = (pack: SuggestedPack): void => {
  if (checking.value || pendingManifest.value || isInstalled(pack)) return;
  url.value = pack.manifestUrl;
  void checkUrl();
};

/** Which URL the copy button last managed to copy — the label flips back on a timer. */
const copiedUrl = ref<string | null>(null);
const copyFailed = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const flashCopied = (value: string | null): void => {
  copiedUrl.value = value;
  copyFailed.value = value === null;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copiedUrl.value = null;
    copyFailed.value = false;
  }, 1800);
};

/**
 * The pre-Clipboard-API copy, for where the modern one does not exist.
 *
 * `navigator.clipboard` is undefined outside a secure context, and this game
 * is served over plain `http` in every Playwright run and on any LAN address
 * a second device on the sofa would use — which is exactly the device whose
 * player wants to send themselves a URL.
 *
 * `user-select` is set inline because `styles/main.css` sets `user-select:
 * none` on `*`: without it the selection is empty, `execCommand('copy')`
 * returns true anyway, and the button says "Đã chép" having copied nothing.
 */
const copyByExecCommand = (value: string): boolean => {
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  field.style.opacity = '0';
  field.style.userSelect = 'text';
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
};

const copyUrl = async (value: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value);
    flashCopied(value);
    return;
  } catch {
    // No clipboard API, or the page does not have permission. Fall through.
  }
  flashCopied(copyByExecCommand(value) ? value : null);
};

/**
 * Shown under the shelf only while nothing is installed — with a pack on the
 * list the screen already says what it has, and the sentence becomes noise.
 */
const nothingInstalled = computed(() => rows.value.length === 0);

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = null;
});
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

    <div class="packs-body-shell">
      <div class="packs-body">
        <!-- 0. What a pack even is. It was a section of the About screen —
             one scene away from every button that acts on it, and the reason
             that screen had grown to twice its length. Open by default only
             while nothing is installed: a returning player has answered this
             question already, and three steps at the top of every visit is
             the same noise the About screen was. -->
        <details class="packs-intro" :open="nothingInstalled">
          <summary class="packs-intro-summary">
            <i class="fas fa-circle-question" aria-hidden="true"></i>
            <span>Pack là gì?</span>
          </summary>
          <p class="packs-intro-text">
            Pack là gói nội dung: tướng, chiêu, quái rừng, bản đồ. Game không kèm sẵn tướng nào —
            pack mới là thứ mang chúng vào.
          </p>
          <ol class="packs-steps">
            <li class="packs-step">
              <i class="fas fa-download" aria-hidden="true"></i>
              <span>
                Bấm <strong>Cài</strong> ở pack có sẵn, hoặc dán link <code>manifest.json</code> của
                pack khác.
              </span>
            </li>
            <li class="packs-step">
              <i class="fas fa-shield-halved" aria-hidden="true"></i>
              <span>
                Xem kỹ <strong>tên miền</strong> ở màn xác nhận — pack chạy với toàn quyền trên
                trang này. Chỉ cài từ nguồn bạn tin.
              </span>
            </li>
            <li class="packs-step">
              <i class="fas fa-play" aria-hidden="true"></i>
              <span>Cài xong chọn tướng mới ngay, không phải tải lại trang.</span>
            </li>
          </ol>
        </details>

        <!-- 1. What this browser already has. First, because on a return
             visit it is the answer to the question the screen was opened
             with. `.packs-row` and `.packs-origin` are the installed list's
             alone — the shelf below uses classes of its own, so a Playwright
             `.packs-origin` read cannot silently pick up a suggestion. -->
        <section class="packs-section">
          <h2 class="packs-section-title">Đã cài</h2>

          <ul v-if="rows.length" class="packs-list">
            <li v-for="row in rows" :key="row.manifestUrl" class="packs-row">
              <div class="packs-row-head">
                <span class="packs-id">{{ row.id }}</span>
                <span class="packs-version">v{{ row.version }}</span>
              </div>
              <p class="packs-origin packs-selectable">{{ row.origin }}</p>
              <p class="packs-usage">{{ usageLabel(row) }}</p>
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

          <p v-else class="packs-empty">
            Chưa cài pack nào — game đang chạy với đúng một tướng mặc định.
          </p>
        </section>

        <!-- 2. The shelf. Every entry is a real card: a name, what it gives
             you, its URL as selectable text, and three things you can press.
             This replaced one unclickable, uncopyable `<span>` — see
             `packs/suggestedPacks.ts`'s own header. -->
        <section class="packs-section">
          <h2 class="packs-section-title">Pack có sẵn</h2>

          <ul class="packs-catalog">
            <li v-for="pack in SUGGESTED_PACKS" :key="pack.manifestUrl" class="packs-card">
              <div class="packs-card-head">
                <span class="packs-card-name">{{ pack.name }}</span>
                <span v-if="isInstalled(pack)" class="packs-card-installed">
                  <i class="fas fa-circle-check" aria-hidden="true"></i> Đã cài
                </span>
              </div>

              <p class="packs-card-desc">{{ pack.description }}</p>

              <!-- Selectable on purpose: `styles/main.css` sets
                   `user-select: none` on `*`, which is what made the old hint
                   impossible to copy by hand. The button beside it is the
                   easy path; this is the one that still works when the
                   clipboard API does not. -->
              <p class="packs-card-url packs-selectable">{{ pack.manifestUrl }}</p>

              <div class="packs-card-actions">
                <button
                  type="button"
                  class="packs-card-install"
                  :class="{ done: isInstalled(pack) }"
                  :disabled="isInstalled(pack) || checking || Boolean(pendingManifest)"
                  @click="installSuggested(pack)"
                  @touchend.prevent="installSuggested(pack)"
                >
                  <i
                    :class="isInstalled(pack) ? 'fas fa-check' : 'fas fa-download'"
                    aria-hidden="true"
                  ></i>
                  <span>{{ isInstalled(pack) ? 'Đã cài' : 'Cài' }}</span>
                </button>

                <button
                  type="button"
                  class="packs-card-action"
                  @click="copyUrl(pack.manifestUrl)"
                  @touchend.prevent="copyUrl(pack.manifestUrl)"
                >
                  <i class="fas fa-copy" aria-hidden="true"></i>
                  <span>{{ copiedUrl === pack.manifestUrl ? 'Đã chép' : 'Chép URL' }}</span>
                </button>

                <a
                  class="packs-card-action"
                  :href="pack.repoUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i class="fab fa-github" aria-hidden="true"></i>
                  <span>Mã nguồn</span>
                </a>
              </div>
            </li>
          </ul>

          <p v-if="copyFailed" class="packs-add-error">
            Trình duyệt không cho chép tự động — bạn chọn và chép URL ở trên nhé.
          </p>
          <p v-if="nothingInstalled" class="packs-hint">
            Bấm <strong>Cài</strong> rồi xem kỹ tên miền ở màn xác nhận trước khi đồng ý.
          </p>
        </section>

        <!-- 3. The power path, last: a URL from anywhere at all. It was first
             on the screen when it was the only way to add anything. -->
        <section class="packs-section">
          <h2 class="packs-section-title">Thêm bằng URL</h2>
          <div class="packs-add">
            <label class="packs-add-label" for="pack-url-input">
              Dán link manifest.json của pack
            </label>
            <div class="packs-add-row">
              <!-- `readonly` and `aria-disabled`, never `disabled`, while a
                   check is in flight. A browser blurs an element the moment it
                   becomes disabled, so `:disabled="checking"` moved focus to
                   `<body>` before the confirmation had even mounted — and the
                   confirmation's own focus restore then had nothing to give
                   back to. Both still refuse input: the field is `readonly`,
                   and `checkUrl` has guarded against a second run since it was
                   written. -->
              <input
                id="pack-url-input"
                v-model="url"
                type="url"
                inputmode="url"
                autocomplete="off"
                placeholder="https://vi-du.com/pack/manifest.json"
                :readonly="checking"
                :aria-busy="checking"
                @keyup.enter="checkUrl"
              />
              <button
                type="button"
                id="pack-url-check"
                :disabled="!url.trim()"
                :aria-disabled="checking"
                @click="checkUrl"
                @touchend.prevent="checkUrl"
              >
                {{ checking ? 'Đang kiểm tra…' : 'Kiểm tra' }}
              </button>
            </div>
            <p v-if="checkError" class="packs-add-error">{{ checkError }}</p>
          </div>
        </section>
      </div>

      <!-- A sibling of `.packs-body`, not a child of it: `.packs-body`
           scrolls (`overflow-y: auto`), and an absolutely positioned child of
           a scroll container scrolls with its content — the one thing a
           modal must never do. `.packs-body-shell` is the non-scrolling
           ancestor both share, which is also what keeps `.packs-header`'s
           close button outside the backdrop's `inset: 0` coverage — see
           `.packs-body-shell`'s own CSS comment. -->
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
