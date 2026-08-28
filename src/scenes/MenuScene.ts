import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import DomUtils from '@/utils/dom.utils';
import { loadGameScene, loadSetupScene, preloadGame } from './gamePreload';
import MenuSceneView from './MenuScene.vue';
import { contentCatalog } from '@/content/catalog';
import { publishPackMaps } from '@/content/editorCatalog';
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
      // **Chơi opens the setup panel, not a match.** The menu used to carry a
      // separate Cấu hình link beside Nội dung and Giới thiệu, on the reading
      // that it is a screen you visit *between* matches. In use it is not: it
      // is the step before this one, every time, and a player who never found
      // the link never found the roster, the rules or the map picker either.
      //
      // So Play is the way in and the panel's own Bắt Đầu is the way through.
      // That does restore the shape this file's header argued against — a
      // button that opens a panel with a button in it — but the objection was
      // to three *peer* buttons where one was a setting. This is a line:
      // play, set up, start.
      onPlay: () => {
        void loadSetupScene().then(scene => this.sceneManager.showScene(scene));
      },
      // Whether this player has any roster at all beyond core's own single
      // champion — what the one-time nudge in front of Chơi is about. Asked
      // here rather than in the component: `contentCatalog` is content code,
      // and a static import of it from `MenuScene.vue` would put it in the
      // menu's chunk. Read on every entry, so installing a pack and coming
      // back stops the nudge without a reload.
      soloContent: contentCatalog().champions().length <= 1,
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
      // Tạo map is a plain link again. It used to unfold a map picker here,
      // which put a second map list in the menu — one holding pack maps while
      // the editor's own held drafts, neither able to see the other — and
      // could not fit on a landscape phone. The editor's own map screen is
      // the one list now; this just publishes what the game has on the way.
      onOpenEditor: () => {
        void this.openEditor();
      },
    });
    this.app.mount(this.host);
  }

  /**
   * Publish what the game has, then go to the editor.
   *
   * **Awaits the geometry.** `MapDefinition.geometry` is a `MapGeometrySource`
   * and a pack's is usually a `() => import(...)` — the whole point of the
   * summary/geometry split is that listing a map does not download its
   * polygons. The editor cannot reach `PackRegistry` from its own document, so
   * this is the one moment those polygons can be fetched for it.
   *
   * A failure still opens the editor. The player pressed a button that means
   * "take me to the editor", and arriving there with only their own maps beats
   * staying on the menu reading about a list they never asked to see.
   *
   * The navigation is relative, because `vite.config.ts` sets `base: './'` and
   * the game is served from a subpath on every host it has ever had. And
   * `index.html` is spelled out rather than the bare directory: this app is an
   * SPA, so the dev server answers any path that is not a file with the
   * *game's* own `index.html` — `/map-editor/` is a directory, so the bare
   * form silently served the menu again. Static hosts resolve it correctly,
   * which is what makes that a bug appearing only on a developer's machine.
   */
  private async openEditor(): Promise<void> {
    try {
      await publishPackMaps(contentCatalog());
    } catch (thrown) {
      console.error('[editor] could not publish the map list', thrown);
    }
    window.location.href = './map-editor/index.html';
  }

  exit() {
    this.app?.unmount();
    this.app = null;
    this.host.style.display = 'none';
  }
}
