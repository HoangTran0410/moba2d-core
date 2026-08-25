import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import DomUtils from '@/utils/dom.utils';
import { loadGameScene, loadSetupScene, preloadGame } from './gamePreload';
import MenuSceneView from './MenuScene.vue';

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
 * the buttons all live in `MenuScene.vue`; this owns mounting and the three
 * scene transitions the component can only ask for, not perform itself.
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
    });
    this.app.mount(this.host);
  }

  exit() {
    this.app?.unmount();
    this.app = null;
    this.host.style.display = 'none';
  }
}
