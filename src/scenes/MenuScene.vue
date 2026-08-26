<script setup lang="ts">
/**
 * The main menu: background, logo, and the buttons. Scene transitions
 * ("Chơi", "Cấu Hình Trận Đấu", "Giới thiệu", "Nội dung / Pack") are
 * lifecycle, not presentation, so this only emits — `MenuScene.ts` maps
 * `play`/`openConfig`/`openAbout`/`openPacks` onto `sceneManager.showScene`,
 * the same split `LoadingScene.vue` uses for its own scene handover.
 *
 * The fullscreen toggle is pure view state with no scene-transition involved,
 * so — unlike the buttons above — it stays entirely local to this component
 * instead of being driven from `MenuScene.ts`.
 *
 * **Giới thiệu and Nội dung / Pack are not gated behind `ready`.** Neither
 * opens game code — see `AboutScene.ts` and `PacksScene.ts` — so there is no
 * reason to make a player wait through the warm-up bar to read what the game
 * is, and a player whose pack failed to load (the banner below) is exactly
 * the player who most needs the packs screen *before* the warm-up finishes.
 *
 * **The logo and the background are drawn, not fetched.** Both used to be
 * images, and both were Riot's: the Vietnamese *Liên Minh Huyền Thoại*
 * wordmark and a champion splash. Core ships no content of its own — every
 * champion, map and monster arrives in a pack from another repository under
 * its own licence — so a menu wearing one pack's artwork was the engine
 * claiming something that is not its. The wordmark is now text in this
 * project's own palette and the background is a gradient, which also happens
 * to remove 170KB and two precache entries from the first load.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import DomUtils from '@/utils/dom.utils';
import {
  offlineReady,
  requestUpdate,
  updateDownloadedCount,
  updateDownloading,
  updateQueued,
  updateReady,
} from '@/pwa/updates';
import { watchPreload, type PreloadState } from './gamePreload';
import { packStageLabel } from './packStageLabel';
import {
  dismissPackBanner,
  packBannerDismissed,
  packInstallFailures,
  retryPackInstall,
} from './packBanner';
import { packHealthDismissed, packProblems } from '@/content/packHealth';

/**
 * ## The pack-health notice
 *
 * Separate from the install banner above it, which reports a pack that could
 * not be installed *this boot*. This one reports a pack that installed fine
 * and has since gone out of date — the failure the player actually met: a
 * republished pack, a chunk graph pointing at files the host had deleted, and
 * a champion whose ability silently did nothing.
 *
 * `runtimePacks` is imported **dynamically** in the handler, never at the top
 * of this file. It reaches `ContentApi` and `install.ts`, i.e. the engine, and
 * a static import here would pull the whole match into the menu's chunk with
 * nothing on screen looking wrong (`scripts/check-chunks.mjs`). `packHealth`
 * itself is dependency-free apart from `vue` for exactly this reason, so the
 * state can be read statically while the action is fetched.
 */
const packProblem = computed(() => packProblems.value[0] ?? null);
const updatingPack = ref(false);
const packUpdateFailed = ref(false);

const packProblemText = computed(() => {
  const problem = packProblem.value;
  if (!problem) return '';
  const name = problem.name;
  if (problem.kind === 'update') return `Pack "${name}" đã có bản mới.`;
  const missing = problem.missingSpells;
  return missing
    ? `Pack "${name}" đã cũ — ${missing} chiêu thức không tải được, đang tạm dùng đòn đánh thường.`
    : `Pack "${name}" đã cũ — thiếu một phần nội dung.`;
});

async function updateProblemPack(): Promise<void> {
  const problem = packProblem.value;
  if (!problem || updatingPack.value) return;
  updatingPack.value = true;
  packUpdateFailed.value = false;
  try {
    const { updatePack } = await import('@/content/runtimePacks');
    if (await updatePack(problem.manifestUrl)) {
      // A reload, not a live swap. The old build's modules have already been
      // evaluated in this page and ES modules evaluate once, so carrying on
      // would leave the previous classes running behind the new manifest —
      // the exact mismatch the update exists to end.
      location.reload();
      return;
    }
    packUpdateFailed.value = true;
  } catch {
    packUpdateFailed.value = true;
  } finally {
    updatingPack.value = false;
  }
}

function dismissPackProblem(): void {
  packHealthDismissed.value = true;
}

const emit = defineEmits<{ play: []; openConfig: []; openAbout: []; openPacks: [] }>();

// Reads real document state rather than always starting from "not
// fullscreen": this component remounts on every menu entry (see
// MenuScene.ts), but the browser's actual fullscreen state does not reset
// just because the player visited the pregame screen and came back.
const isFullscreen = ref(!!document.fullscreenElement);

/**
 * ## The warm-up bar
 *
 * `gamePreload` fetches the game's code and every image a match draws while
 * the player is looking at this screen, and Chơi waits for it. Two reasons it
 * is a gate rather than a hint: pressing Play mid-fetch used to mean a black
 * pause of unknown length, and the match itself used to open on placeholder
 * squares that filled in over the first several seconds.
 *
 * The state is module-level and survives this component, which remounts on
 * every return from the pregame screen — so a second visit finds the load long
 * finished and never shows the bar at all.
 *
 * `codeFailed` still shows Play. A menu with no way into a match is a worse
 * failure than a slow one, and `loadGameScene` retries the fetch when pressed.
 */
const preload = ref<PreloadState>({
  loaded: 0,
  total: 0,
  ratio: 0,
  done: false,
  codeFailed: false,
});
let stopWatching: (() => void) | null = null;

const percent = computed(() => Math.round(preload.value.ratio * 100));
const ready = computed(() => preload.value.done);

onMounted(() => {
  stopWatching = watchPreload(state => {
    preload.value = state;
  });
});
onUnmounted(() => {
  stopWatching?.();
  stopWatching = null;
});

const toggleFullscreen = (): void => {
  isFullscreen.value = DomUtils.toggleFullscreen();
};

/**
 * ## The version stamp, and the update offer beside it
 *
 * `__APP_VERSION__` is `package.json`'s version, replaced at build time (see
 * `vite.config.ts`). It is on the menu rather than anywhere else for the
 * reason a version number is ever shown: so a player reporting "spell X is
 * broken" can say *which build* they are on. An installed PWA makes that
 * question real — it serves whatever it cached until it is told otherwise, so
 * two players can be on different builds of the same URL.
 *
 * Which is also why the update lives here. `src/pwa/updates.ts` holds the new
 * build back rather than swapping it in, and this is the screen where taking
 * the reload costs nothing: no match is running.
 *
 * The refs are module state, not component state — this component remounts on
 * every return to the menu, and a worker that finished installing while the
 * player was in a match must still be offered when they come back out.
 */
const appVersion = __APP_VERSION__;

/**
 * Core's semver, which is a different question from the build clock above.
 *
 * `__APP_VERSION__` answers "which build am I on". This answers "which core",
 * and it is the number a content pack's `coreRange` is measured against — so
 * it is the one that decides whether a pack installs.
 *
 * It is on screen because of the failure that put it there. An install was
 * refused with *"pack lol needs core >=1.4.0, this is 1.3.0"* on a machine
 * whose `package.json` said 1.4.0: a dev server that had been up since before
 * the bump was still serving the old `define`. There was nowhere in the
 * running app to see which core it really was, so the only evidence available
 * was the refusal — and the refusal was the thing in doubt. Now the menu says
 * it before anyone has to install anything to find out.
 *
 * The define, not `packSource`'s `CORE_VERSION` re-export: identical value,
 * and importing it would pull the pack loader into the menu's chunk for a
 * string. `versionStamp.test.ts` keeps the two reading the same identifier.
 */
const coreVersion = __CORE_VERSION__;
const updating = ref(false);

const installUpdate = async (): Promise<void> => {
  // `requestUpdate`, not `applyUpdate`: the button is now offered on the fast
  // signal, seconds before there is a build to hand over to, so a press that
  // arrives early is remembered rather than refused. See `src/pwa/updates.ts`.
  await requestUpdate();
  if (updateReady.value) updating.value = true;
};

/**
 * What the one update button says, which is three different things.
 *
 * One button and not three states of two elements: the player's decision is
 * the same in all of them — *take the new build* — and the only thing that
 * changes is how much of it has arrived. A dead "đang tải…" line that becomes
 * a button twenty seconds later is two things to notice instead of one.
 */
const updateLabel = computed(() => {
  if (updating.value) return 'Đang cập nhật…';
  if (updateQueued.value && !updateReady.value) {
    // The count is what makes a wait of up to twenty seconds legible as
    // progress rather than as a hang. Omitted until the first file lands, so
    // the label never reads "0 tệp".
    return updateDownloadedCount.value > 0
      ? `Đang tải… ${updateDownloadedCount.value} tệp`
      : 'Sẽ cập nhật khi tải xong…';
  }
  return 'Có bản mới — cập nhật';
});

/** `downloading` | `queued` | `ready` — the hook `e2e:pwa-update` measures against. */
const updateState = computed(() => {
  if (updateReady.value) return 'ready';
  return updateQueued.value ? 'queued' : 'downloading';
});

/**
 * ## The failed-pack banner
 *
 * Spec §7 puts it here rather than on the loading screen, and says it does
 * not dismiss itself: a game quietly missing 58 champions reads as a broken
 * game, so the player has to be the one who decides to ignore it. Both refs
 * are module state (`./packBanner`) for the same reason the update refs
 * above are — this component remounts on every return to the menu, and a
 * banner that came back after being dismissed, or a failure list that
 * nothing ever set again, are the two shapes component state would give.
 */
</script>

<template>
  <div class="background"></div>

  <div class="menu-brand">
    <div class="shiny">
      <h1 id="menu-logo" class="menu-wordmark">
        <span class="menu-wordmark-main">MOBA</span><span class="menu-wordmark-2d">2D</span>
      </h1>
    </div>
  </div>

  <!-- The bar stands exactly where the buttons will, so the menu does not jump
       when it is replaced by them. -->
  <div v-if="!ready" id="menu-loading" class="menu-loading">
    <div class="menu-loading-track">
      <div class="menu-loading-fill" :style="{ width: `${percent}%` }"></div>
    </div>
    <p class="menu-loading-label">Đang tải tài nguyên trận đấu… {{ percent }}%</p>
  </div>

  <template v-else>
    <button id="play-btn" class="hextech-btn" @click="emit('play')">Chơi</button>
    <button id="config-btn" class="hextech-btn secondary" @click="emit('openConfig')">
      Cấu Hình Trận Đấu
    </button>
    <p v-if="preload.codeFailed" class="menu-loading-warning">
      Tải dữ liệu chưa xong — bấm Chơi để thử lại.
    </p>
  </template>

  <!-- Both `@click` and `@touchend.prevent` on each button: once a
       `GameScene` is on screen it calls `preventDefault()` on every touch on
       the page, which stops the browser synthesising a trailing `click`, so a
       click-only handler is dead under a thumb. -->
  <div v-if="packInstallFailures.length && !packBannerDismissed" class="pack-banner" role="alert">
    <span>
      Chưa tải được nội dung — {{ packStageLabel(packInstallFailures[0].stage) }}. Đang chơi với
      tướng mặc định.
    </span>
    <div class="pack-banner-actions">
      <button
        id="pack-banner-retry"
        type="button"
        @click="retryPackInstall"
        @touchend.prevent="retryPackInstall"
      >
        Thử lại
      </button>
      <button
        id="pack-banner-dismiss"
        type="button"
        class="ghost"
        @click="dismissPackBanner"
        @touchend.prevent="dismissPackBanner"
      >
        Bỏ qua
      </button>
    </div>
  </div>

  <!-- A pack that installed fine and has since gone out of date. Its own
       banner rather than a line in the one above: that one is about this
       boot's install, this one is about a pack the player already has, and
       the way out of each is different. -->
  <div
    v-if="packProblem && !packHealthDismissed"
    class="pack-banner"
    :class="{ 'pack-banner-broken': packProblem.kind === 'broken' }"
    role="alert"
  >
    <span>
      {{ packProblemText }}
      <template v-if="packUpdateFailed"> Không cập nhật được — thử lại khi có mạng. </template>
    </span>
    <div class="pack-banner-actions">
      <button
        id="pack-update"
        type="button"
        :disabled="updatingPack"
        @click="updateProblemPack"
        @touchend.prevent="updateProblemPack"
      >
        {{ updatingPack ? 'Đang cập nhật…' : 'Cập nhật' }}
      </button>
      <button
        id="pack-update-dismiss"
        type="button"
        class="ghost"
        @click="dismissPackProblem"
        @touchend.prevent="dismissPackProblem"
      >
        Để sau
      </button>
    </div>
  </div>

  <!-- In the column, under the two buttons above — not pinned to the top-right
       corner beside the fullscreen toggle, which is where both spent their
       whole life as unlabelled 1em glyphs. Neither was findable there, and
       "Nội dung / Pack" is now the screen a player gets a roster from at all,
       so it cannot also be the least visible control on the menu.

       Still outside the `ready` gate above, for the reason in this file's
       header: neither opens game code, so neither waits on the warm-up. -->
  <div class="menu-links">
    <button
      id="packs-btn"
      class="menu-link"
      title="Nội dung / Pack"
      @click="emit('openPacks')"
      @touchend.prevent="emit('openPacks')"
    >
      <i class="fas fa-cubes" aria-hidden="true"></i>
      <span>Nội dung / Pack</span>
    </button>

    <button
      id="about-btn"
      class="menu-link"
      title="Giới thiệu"
      @click="emit('openAbout')"
      @touchend.prevent="emit('openAbout')"
    >
      <i class="fas fa-circle-info" aria-hidden="true"></i>
      <span>Giới thiệu</span>
    </button>
  </div>

  <button id="fullscreen-btn" @click="toggleFullscreen">
    <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
  </button>

  <!-- Bottom corner, dim: findable when someone asks "what version are you
       on", invisible the rest of the time. -->
  <p id="menu-version" class="menu-version">
    v{{ appVersion }}
    <!-- Core's own semver, dimmer than the build clock beside it: it matters
         on exactly one day, when a pack refuses to install and its message
         names a number this is the only place to check. -->
    <span
      id="menu-core-version"
      class="menu-version-core"
      title="Phiên bản core, dùng để kiểm tra pack"
    >
      core {{ coreVersion }}
    </span>
    <span v-if="offlineReady" class="menu-version-offline" title="Đã lưu để chơi offline">
      <i class="fas fa-circle-check" aria-hidden="true"></i> offline
    </span>
  </p>

  <!-- Offered on the *fast* signal — `updatefound`, about a second — not on
       the slow one. Pressing before the download finishes is a promise, not a
       refusal: `requestUpdate` remembers it and applies the moment the build
       is ready. See src/pwa/updates.ts for why the two are ~19s apart.

       Only ever on the menu, which is the one screen where losing the page
       costs nothing. -->
  <button
    v-if="updateDownloading || updateReady"
    id="menu-update-btn"
    class="menu-update"
    :data-state="updateState"
    :data-downloaded="updateDownloadedCount"
    :disabled="updating || (updateQueued && !updateReady)"
    @click="installUpdate"
  >
    <i
      class="fas fa-arrow-rotate-right"
      :class="{ 'fa-spin': updating || (updateQueued && !updateReady) }"
      aria-hidden="true"
    ></i>
    <span>{{ updateLabel }}</span>
  </button>
</template>
