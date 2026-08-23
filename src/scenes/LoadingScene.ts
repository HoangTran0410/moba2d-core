import { createApp, type App } from 'vue';
import { Scene } from '@/managers/SceneManager';
import LoadingSceneView from './LoadingScene.vue';
import type MenuScene from './MenuScene';
import { installRuntimePacks, type PackInstallOutcome } from '@/content/runtimePacks';

/** What `LoadingScene.vue` exposes back to the scene driving it. */
interface LoadingView {
  setMessage(text: string): void;
  setProgress(percent: number): void;
  fail(text: string): void;
  reset(): void;
  setPackFailures(failures: PackInstallOutcome[]): void;
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
   * below fails). **Nothing in `installRuntimePacks()` may throw** — see
   * its own header — so the worst outcome here is a banner, never a dead
   * screen.
   */
  private async boot() {
    const outcomes = await installRuntimePacks();
    // A plain loop, not `.filter`: `Array.prototype.filter` is polyfilled in
    // this project and cannot narrow a type (see CLAUDE.md), and narrowing
    // the failure branch of the union is the whole point here — the banner
    // reads `failures[0].stage`, which only the `ok: false` member has.
    const failures: Extract<PackInstallOutcome, { ok: false }>[] = [];
    for (const outcome of outcomes) {
      if (outcome.ok === false) failures.push(outcome);
    }
    if (failures.length > 0) {
      // Not thrown, on purpose. See `runtimePacks.ts`'s own header.
      console.warn('[packs] some content did not install', failures);
    }
    this.view?.setPackFailures(failures);

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
