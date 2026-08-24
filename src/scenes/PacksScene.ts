import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import PacksSceneView from './PacksScene.vue';

/**
 * The packs screen: what content packs this browser has installed, and the
 * way to get rid of one. Opened from the menu, and only from there.
 *
 * Mounted in `enter()` and unmounted in `exit()`, the same lifecycle
 * `AboutScene.ts` uses for the same reason: this scene is entered repeatedly
 * (every "Quay lại" round trip from the menu), and it carries no state that
 * needs to survive a re-mount, so a fresh mount each time costs nothing.
 *
 * **This file, `PacksScene.vue`, and everything under `./packs/` must never
 * statically import a `src/game/` runtime value, nor `@/content/runtimePacks`
 * itself.** The screen is reached from the menu before any match exists, and
 * installing a pack for real needs `buildContentApi()` and
 * `rebuildContentRegistry()` — which live in `runtimePacks.ts`, pinned to the
 * `game` chunk in `vite.config.ts` precisely because they do. A static import
 * of either would drag the whole match into whichever chunk this file ends up
 * in. `tests/scenes/packsBootPath.test.ts` holds that line, the same way
 * `menuBootPath.test.ts` and `aboutBootPath.test.ts` hold it for the screens
 * beside this one; `chunks:check`'s `PacksScene` rule holds it again at the
 * compiled-bytes level.
 *
 * Reached only through a dynamic `import()` from `MenuScene.ts` (mirroring
 * `AboutScene`), so this file's own chunk is fetched the moment a player
 * actually opens it and not before.
 */
export default class PacksScene extends Scene {
  private host!: HTMLElement;
  private app: App | null = null;

  setup() {
    this.host = document.querySelector('#packs-scene') as HTMLElement;
  }

  enter() {
    this.host.style.display = 'flex';
    this.app = createApp(PacksSceneView, {
      onClose: () => {
        // `./MenuScene` dynamically for the same reason `AboutScene.ts`
        // does: a static edge back to the scene that reaches this one is a
        // cycle, and a cycle between chunks is a single chunk.
        void import('./MenuScene').then(module => this.sceneManager.showScene(module.default));
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
