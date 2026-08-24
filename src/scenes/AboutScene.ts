import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import AboutSceneView from './AboutScene.vue';

/**
 * The About screen: what the game is, how to give it content, a link to the
 * source, any write-ups, and a player-facing changelog. Opened from the menu,
 * and only from there — and it leads on to the packs screen, which is the one
 * place its "cài thêm nội dung" section can be acted on.
 *
 * Mounted in `enter()` and unmounted in `exit()`, the same lifecycle
 * `SetupScene.ts` uses for the same reason: this scene is entered repeatedly
 * (every "Quay lại" round trip from the menu), and it carries no state that
 * needs to survive a re-mount, so a fresh mount each time costs nothing.
 *
 * **This file, `AboutScene.vue`, and everything under `./about/` must never
 * import a `src/game/` runtime value.** The screen is reached from the menu
 * before any match exists; one such import would drag the whole match into
 * whichever chunk this file ends up in. `tests/scenes/aboutBootPath.test.ts`
 * holds that line, the same way `menuBootPath.test.ts` and
 * `matchConfigChunk.test.ts` hold it for the screens beside this one.
 *
 * Reached only through a dynamic `import()` from `MenuScene.ts` (mirroring
 * `loadSetupScene`), so this file's own chunk is fetched the moment a player
 * actually opens it and not before.
 */
export default class AboutScene extends Scene {
  private host!: HTMLElement;
  private app: App | null = null;

  setup() {
    this.host = document.querySelector('#about-scene') as HTMLElement;
  }

  enter() {
    this.host.style.display = 'flex';
    this.app = createApp(AboutSceneView, {
      onClose: () => {
        // `./MenuScene` dynamically for the same reason `SetupScene.ts` does:
        // a static edge back to the scene that reaches this one is a cycle,
        // and a cycle between chunks is a single chunk.
        void import('./MenuScene').then(module => this.sceneManager.showScene(module.default));
      },
      // The About screen explains what a content pack is and how to install
      // one; sending the player back to the menu to find the button is one
      // step of nothing. Dynamic for the same reason `MenuScene.ts`'s own
      // `onOpenPacks` is — see that file, and `PacksScene.ts`'s header.
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
