import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import LoadingSceneView from './LoadingScene.vue';
import type MenuScene from './MenuScene';
import { installRuntimePacks, type PackInstallOutcome } from '@/content/runtimePacks';
import { publishPackInstallOutcomes } from './packBanner';

/** What `LoadingScene.vue` exposes back to the scene driving it. */
interface LoadingView {
  setMessage(text: string): void;
  setProgress(percent: number): void;
  fail(text: string): void;
  reset(): void;
}

/**
 * The lifecycle half of the loading screen. The markup and the state live in
 * `LoadingScene.vue`; this owns mounting, the asset load, and the handover to
 * the menu.
 *
 * Mounted in `setup()` rather than `enter()` because this scene is entered
 * exactly once, at boot, and the container has to exist before p5 draws its
 * first frame. Scenes that are entered repeatedly should mount in `enter()`
 * and unmount in `exit()` instead, so a re-entry starts from clean state.
 */
export default class LoadingScene extends Scene {
  private app: App | null = null;
  private view: LoadingView | null = null;
  private host!: HTMLElement;

  setup() {
    this.host = document.querySelector('#loading-scene') as HTMLElement;
    this.app = createApp(LoadingSceneView);
    this.view = this.app.mount(this.host) as unknown as LoadingView;
  }

  enter() {
    this.host.style.display = 'block';
    this.view?.reset();

    // `enter()` itself stays synchronous (the base `Scene.enter(): void`
    // contract, and `SceneManager` fires it without awaiting) — the actual
    // work moves to `boot()`, an async method this call kicks off and does
    // not wait on here.
    void this.boot();
  }

  /**
   * Installs every remembered runtime pack, *then* hands off to the menu.
   *
   * Runtime packs install here rather than in `main.ts`'s `setup()` because
   * this is where the game is already allowed to be slow: the loading
   * screen is on the glass, and `setup()` is synchronous by design (see
   * `content/registry.ts` — the warm call there installs core and the
   * reference pack, which is what makes the game playable if everything
   * below fails).
   *
   * **The `try` is what makes "nothing in `installRuntimePacks()` may throw"
   * a fact rather than a comment.** `enter()` fires this as `void
   * this.boot()`, so a throw anywhere above the handover is an unhandled
   * rejection and the menu never opens — the dead screen the whole design
   * forbids, reached by the one path that had nothing watching it. The
   * handover below is deliberately outside every failure branch: whatever
   * happened to the packs, this method ends by showing the menu.
   *
   * The outcomes go to `packBanner.ts` rather than to this screen, because
   * this screen is about to be `display: none` — see that module's header.
   */
  private async boot() {
    let outcomes: PackInstallOutcome[] = [];
    try {
      outcomes = await installRuntimePacks();
    } catch (thrown) {
      // Reported, never rethrown. `installRuntimePacks` already answers with
      // outcomes rather than rejecting; reaching here means it broke its own
      // contract, and the player's menu must not be what pays for that.
      console.error('[packs] the install path threw', thrown);
      outcomes = [
        {
          manifestUrl: '',
          ok: false,
          stage: 'install',
          message: (thrown as Error)?.message ?? String(thrown),
        },
      ];
    }
    publishPackInstallOutcomes(outcomes);

    // Used to await `AssetManager.ensure('json_summoner_map')` here first —
    // the map's own terrain/turret/fountain data, read synchronously by
    // `preset.ts`'s (now-deleted) `getTurretPositions()`. Nothing on this
    // path reads that key synchronously any more: the active map's geometry
    // is fetched by `GameScene.startGame()`, alongside the match's spell and
    // art chunks, once a match is actually starting (see that method's own
    // doc comment). This scene's only remaining job is handing off to the
    // menu, whose own chunk is what `import('./MenuScene')` is fetching.
    import('./MenuScene')
      .then(({ default: MenuSceneClass }: { default: typeof MenuScene }) => {
        this.view?.setProgress(100);
        this.view?.setMessage('Đang khởi tạo game...');
        this.sceneManager.showScene(MenuSceneClass);
      })
      .catch(error => {
        console.error(error);
        this.view?.fail(
          'LỖI: Khởi tạo game không thành công. Vui lòng tải lại trang.<br/>' + error.message
        );
      });
  }

  exit() {
    this.host.style.display = 'none';
  }
}
