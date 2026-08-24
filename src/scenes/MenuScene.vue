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
 * **One background, not a carousel.** Six full-bleed JPEGs used to rotate on a
 * 5s timer: 1.1MB of art for a screen the player looks at for a few seconds,
 * none of it precached (the workbox glob has never listed `jpg`), so the
 * offline menu came up bare. It is now a single WebP — 88KB against 151KB for
 * the JPEG it was encoded from — which is small enough to precache, so the
 * installed app looks the same with the network off as with it on.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AssetManager from '@/managers/AssetManager';
import DomUtils from '@/utils/dom.utils';
import { applyUpdate, offlineReady, updateDownloading, updateReady } from '@/pwa/updates';
import { watchPreload, type PreloadState } from './gamePreload';
import { packStageLabel } from './packStageLabel';
import {
  dismissPackBanner,
  packBannerDismissed,
  packInstallFailures,
  retryPackInstall,
} from './packBanner';

const emit = defineEmits<{ play: []; openConfig: []; openAbout: []; openPacks: [] }>();

const logo = AssetManager.get('other_newlogo_vi').url;
const backgroundUrl = AssetManager.get('other_menu_bg').url;
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
const updating = ref(false);

const installUpdate = async (): Promise<void> => {
  updating.value = true;
  await applyUpdate();
};

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
  <div class="background" :style="{ backgroundImage: `url(${backgroundUrl})` }"></div>

  <div class="logo">
    <div class="shiny">
      <img id="menu-logo" alt="logo" class="logo" :src="logo" />
    </div>
    <p class="p2d slide-bck-center">2D</p>
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
    <span v-if="offlineReady" class="menu-version-offline" title="Đã lưu để chơi offline">
      <i class="fas fa-circle-check" aria-hidden="true"></i> offline
    </span>
  </p>

  <!-- The fast half: a newer build has been detected and is downloading in
       the background, well before it is ready to apply. Not a button — there
       is nothing to press yet, see src/pwa/updates.ts. -->
  <p
    v-if="updateDownloading && !updateReady"
    id="menu-update-checking"
    class="menu-update-checking"
  >
    <i class="fas fa-arrow-rotate-right fa-spin" aria-hidden="true"></i>
    Đang tải bản cập nhật mới…
  </p>

  <!-- Only ever on the menu, and only when a build is already downloaded and
       waiting — so pressing it is a reload, not a download that might fail. -->
  <button
    v-if="updateReady"
    id="menu-update-btn"
    class="menu-update"
    :disabled="updating"
    @click="installUpdate"
  >
    <i class="fas fa-arrow-rotate-right" aria-hidden="true"></i>
    <span>{{ updating ? 'Đang cập nhật…' : 'Có bản mới — cập nhật' }}</span>
  </button>
</template>
