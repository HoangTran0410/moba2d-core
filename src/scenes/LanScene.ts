import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import { loadGameScene } from './gamePreload';
import LanSceneView from './LanScene.vue';

/**
 * The LAN lobby screen: create a room, or join one, then into the match.
 *
 * It was a fold-out drawer on the menu until this scene existed — see
 * `LanScene.vue`'s own header for what was wrong with that and why a screen is
 * the fix. This file is the lifecycle half only: mount, the two transitions the
 * component can ask for but not perform, unmount.
 *
 * Mounted in `enter()` and unmounted in `exit()`, the same lifecycle
 * `AboutScene.ts` and `SetupScene.ts` use for the same reason: the screen is
 * entered repeatedly and carries no state worth surviving a re-mount. It
 * carries one that must *not* survive — the room-code poll, which is also the
 * room's advertisement — and unmounting is what stops it.
 *
 * **This file and `LanScene.vue` must never statically import a `src/game/`
 * runtime value.** They are reached from the menu before any match exists, and
 * one such import would drag the whole match into whichever chunk they land in.
 * `loadGameScene` below is the sanctioned door: a function that performs the
 * dynamic `import('./GameScene')`, exactly as `MenuScene.ts` reaches it, and
 * `tests/scenes/lanBootPath.test.ts` holds the line the way `menuBootPath` and
 * `aboutBootPath` hold it for the screens beside this one.
 *
 * Play goes through `loadGameScene` rather than a bare dynamic import so that
 * the menu's warm-up (`preloadGame`) is what this press collects: by the time
 * anyone has typed a room code the chunk is already in the bundler's registry,
 * and a press after a failed warm-up retries the fetch instead of being dead.
 */
export default class LanScene extends Scene {
  private host!: HTMLElement;
  private app: App | null = null;

  setup() {
    this.host = document.querySelector('#lan-scene') as HTMLElement;
  }

  enter() {
    this.host.style.display = 'flex';
    this.app = createApp(LanSceneView, {
      onClose: () => {
        // `./MenuScene` dynamically, like every other scene's way back: a
        // static edge to the scene that reaches this one is a cycle, and a
        // cycle between chunks is a single chunk.
        void import('./MenuScene').then(module => this.sceneManager.showScene(module.default));
      },
      // The component has already written `?net=host|join&room=…` by this
      // point, which is the whole handover — `GameScene.startGame` reads the
      // URL and arms the session. Nothing about LAN is passed as a prop.
      onPlay: () => {
        void loadGameScene().then(scene => this.sceneManager.showScene(scene));
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
