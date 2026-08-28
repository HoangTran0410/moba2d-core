import { createApp, h, type App } from 'vue';
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
  private configApp: App | null = null;
  private configHost: HTMLElement | null = null;

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
      onOpenConfig: () => {
        void this.openConfig();
      },
    });
    this.app.mount(this.host);
  }

  /**
   * The match-config panel, *over* the lobby rather than instead of it.
   *
   * It cannot be a scene transition. The host holds its room open from Tạo
   * phòng — the lobby owns a live broker connection and the player list built
   * on it — and leaving this scene drops both, and strips `?net=`/`?room=` on
   * the way out. So the lobby stays mounted underneath and this goes on top,
   * in a host element of its own.
   *
   * **Imported dynamically, and that is load-bearing rather than tidy.** The
   * panel lives under `src/game/`, and this file's header is explicit that a
   * static import of anything there drags the whole match into the LAN chunk.
   * The import happens when the button is pressed, by which time the warm-up
   * has almost certainly fetched it anyway.
   *
   * `hideStart` because starting here is Vào trận: the footer's Bắt Đầu would
   * open a solo match and leave everyone in the room waiting on a dead lobby.
   */
  private async openConfig(): Promise<void> {
    if (this.configApp) return;

    const [{ default: MatchConfigPanel }, { default: PregameConfigSource }] = await Promise.all([
      import('@/game/hud/config/MatchConfigPanel.vue'),
      import('@/game/hud/config/PregameConfigSource'),
    ]);

    const overlay = document.createElement('div');
    overlay.id = 'lan-config-overlay';
    overlay.className = 'lan-config-overlay';
    this.host.appendChild(overlay);

    const source = new PregameConfigSource();
    this.configApp = createApp({
      render: () =>
        h(MatchConfigPanel, {
          source,
          hideStart: true,
          onClose: () => this.closeConfig(),
        }),
    });
    this.configApp.mount(overlay);
    this.configHost = overlay;
  }

  private closeConfig(): void {
    this.configApp?.unmount();
    this.configApp = null;
    this.configHost?.remove();
    this.configHost = null;
  }

  exit() {
    // The overlay first: leaving the lobby with a panel still mounted over it
    // leaves a detached Vue app and an orphan element in `#lan-scene`.
    this.closeConfig();
    this.app?.unmount();
    this.app = null;
    this.host.style.display = 'none';
  }
}
