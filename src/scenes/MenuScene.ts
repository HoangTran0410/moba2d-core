import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import DomUtils from '@/utils/dom.utils';
import { loadGameScene, loadSetupScene, preloadGame } from './gamePreload';
import MenuSceneView from './MenuScene.vue';
import { armPlaytestMap, takePlaytestMapId } from './playtest';

/**
 * Whether this page load has already asked each pack's host what it is
 * serving. Module state, not instance state: `MenuScene` is entered on every
 * "Quay lại" and re-asking on each one would put a network request behind a
 * back button for no new information.
 */
let updatesChecked = false;

/**
 * Ask, once, after the menu is on screen.
 *
 * **Deliberately not on the boot path.** The pinned pack already works — that
 * is what pinning bought — so this only decides whether to offer the player
 * something newer, and putting it in front of the menu would trade the
 * dead-screen risk the pinning design exists to remove for a nicety. Fire and
 * forget: nothing here has a caller with anything to do about a failure, and
 * an unreachable host means a player on a train, not a broken pack.
 *
 * Dynamically imported for the reason every other import in this file is:
 * `runtimePacks` reaches `ContentApi` and `install.ts`, so a static import
 * would pull the whole match into the menu's chunk.
 */
function checkForPackUpdates(): void {
  if (updatesChecked) return;
  updatesChecked = true;
  void import('@/content/runtimePacks').then(module => module.checkPackUpdates()).catch(() => {});
}

/**
 * The lifecycle half of the main menu. The background carousel, the logo and
 * the buttons all live in `MenuScene.vue`; this owns mounting and the scene
 * transitions the component can only ask for, not perform itself.
 *
 * Mounted in `enter()` and unmounted in `exit()`, not `setup()`: this scene
 * is entered repeatedly (every "Quay lại" from the pregame or About screen),
 * and a fresh mount is what gives the background carousel a clean restart
 * each time instead of accumulating intervals across visits.
 *
 * **Every onward scene is imported dynamically**, and that is load-bearing
 * rather than stylistic: a static `import GameScene` put the entire game —
 * every spell, every unit, the navigation grid — inside the menu's own chunk,
 * 2.1MB of it, fetched and parsed before the logo could appear. `gamePreload`
 * then fetches Play's and Cấu Hình's targets anyway while the player reads
 * the menu, so that split costs nothing at the moment Chơi is pressed;
 * `AboutScene` opens no game code at all, so it is not part of that warm-up
 * and is fetched only when actually opened.
 */
export default class MenuScene extends Scene {
  private host!: HTMLElement;
  private app: App | null = null;

  setup() {
    this.host = document.querySelector('#menu-scene') as HTMLElement;
    DomUtils.preventZoom();
  }

  enter() {
    this.host.style.display = 'flex';
    void preloadGame();
    checkForPackUpdates();

    // Coming back from the map editor with a map to try. Checked before the
    // menu is even built: the player asked for a match, and showing them the
    // menu first only to replace it a frame later is a flash, not a screen.
    // `takePlaytestMapId` consumes the param whatever it answers, so a "Quay
    // lại" from the match it starts lands on a real menu — see its header.
    const playtestMapId = takePlaytestMapId();
    if (playtestMapId !== null) {
      armPlaytestMap(playtestMapId);
      void loadGameScene().then(scene => this.sceneManager.showScene(scene));
      return;
    }

    // "Chơi" stays a single click into a match, with whatever config is
    // already persisted (defaults, if the player has never opened the setup
    // screen) — the setup screen is additive, never a gate in front of Play.
    this.app = createApp(MenuSceneView, {
      onPlay: () => {
        void loadGameScene().then(scene => this.sceneManager.showScene(scene));
      },
      onOpenConfig: () => {
        void loadSetupScene().then(scene => this.sceneManager.showScene(scene));
      },
      // The LAN lobby. Not through `gamePreload.ts` and not part of the
      // warm-up: the lobby itself opens no game code (it writes URL params and
      // polls the broker — see `LanScene.ts`), and it is `LanScene`'s own
      // "Vào trận" that reaches `loadGameScene`, by which time the warm-up
      // this menu started has long finished.
      onOpenLan: () => {
        void import('./LanScene').then(module => this.sceneManager.showScene(module.default));
      },
      // Not routed through `gamePreload.ts`: that module warms only what
      // Play needs, and this screen opens no game code at all — see
      // `AboutScene.ts`'s own comment. A plain dynamic import here keeps
      // that module's scope to the match.
      onOpenAbout: () => {
        void import('./AboutScene').then(module => this.sceneManager.showScene(module.default));
      },
      // Same reasoning as `onOpenAbout`, and see `PacksScene.ts`'s own
      // header: listing what is installed opens no game code either, and a
      // static import here would drag the whole match into the menu's chunk.
      onOpenPacks: () => {
        void import('./PacksScene').then(module => this.sceneManager.showScene(module.default));
      },
      // The map editor is a separate document under `public/map-editor/`, not a
      // scene — plain HTML and globals, no bundler. So this is a navigation
      // rather than a `showScene`, and the way back is the editor's own
      // "Chơi thử", which returns here with `?playtest=`.
      //
      // Relative, because `vite.config.ts` sets `base: './'` and the game is
      // served from a subpath on every host it has ever had. And `index.html`
      // spelled out rather than the bare directory: this app is an SPA, so
      // the dev server answers any path that is not a file with the *game's*
      // own `index.html` — `/map-editor/` is a directory, so it silently served
      // the menu again. Static hosts resolve the directory correctly, which
      // is what makes the bare form a bug that only ever appears locally.
      onOpenEditor: () => {
        window.location.href = './map-editor/index.html';
      },
    });
    this.app.mount(this.host);
  }

  exit() {
    this.app?.unmount();
    this.app = null;
    this.host.style.display = 'none';
  }
}
