/**
 * main.ts — MOBA2D application entry point
 *
 * p5 is loaded via CDN <script> tag in global mode. p5 waits for the window
 * `load` event, and only boots (binding loadImage, createVector, background,
 * etc. onto window) if a global setup()/draw() exists at that point.
 *
 * This module runs before `load` fires (module scripts are deferred), so
 * assigning window.setup here is what activates p5. All game code that uses
 * p5 globals must therefore run inside setup() — NOT at module eval time.
 */
import { every, fastHypot, filter, forEach, map, some } from './utils/optimized.utils';
import SceneManager from './managers/SceneManager';
import LoadingScene from './scenes/LoadingScene';
import { registerServiceWorker } from './pwa/updates';
import AssetManager from './managers/AssetManager';
import { contentRegistry } from './content/registry';
import { installGlobalErrorReporter } from './managers/RenderGuard';

/*
 * No `import { System } from './libs/detect-collisions'` here.
 *
 * This file used to hang it on `window.ABC` "for code that accesses
 * window.ABC". Nothing did — not src, not tests, not the e2e scripts — but the
 * import was real, so the entry chunk depended on detect-collisions, sat and
 * poly-decomp, and Vite emitted a `<link rel="modulepreload">` that fetched all
 * 44KB of them before the menu could draw. `ObjectManager` imports `System`
 * itself, which is what actually needs it, and that lands in the game chunk
 * where it belongs. `tests/scenes/menuBootPath.test.ts` holds the line.
 */

/*
 * First, and deliberately at module scope rather than inside `setup()`.
 *
 * It binds two `window` listeners and touches no p5 global, so the rule in the
 * header above does not apply to it — and the errors most worth catching are
 * the ones thrown *before* `setup()` ever runs, when a rejected pack load or a
 * bad asset leaves a player looking at a loading screen that never moves.
 *
 * This is the outermost of three layers and the weakest by design: it can only
 * report. `guardDraw` (p5's frame chain) and `guardUpdate` (the match tick) are
 * what keep the game running through a bad frame; by the time an event reaches
 * here the stack is already unwound. See `managers/RenderGuard.ts`.
 */
installGlobalErrorReporter();

// Patch Math.hypot with fast 2D scalar implementation
Math.hypot = fastHypot;

// Patch Array prototype for performance (mirrors original app.js behaviour)
/* eslint-disable @typescript-eslint/no-explicit-any */
(Array.prototype as any).map = function (callback: any) {
  return map(this, callback);
};
(Array.prototype as any).forEach = function (callback: any) {
  forEach(this, callback);
};
(Array.prototype as any).some = function (callback: any) {
  return some(this, callback);
};
(Array.prototype as any).every = function (callback: any) {
  return every(this, callback);
};
(Array.prototype as any).filter = function (callback: any) {
  return filter(this, callback);
};
/* eslint-enable @typescript-eslint/no-explicit-any */

(window as any).setup = function setup() {
  // Warm the content registry now, during the loading screen, rather than on
  // the pregame screen's first read. Installing 60+ champions is free here;
  // it is not free on the pregame screen's first paint. `contentRegistry()`
  // touches no p5 global, but it still belongs inside setup() rather than at
  // module eval time — see the header comment above.
  contentRegistry();

  const mgr = new SceneManager() as any;
  mgr.wire();

  // holding global data
  mgr.gameData = {};

  // Dev-only handle so end-to-end tests can reach the live scene and game.
  // Stripped from production builds by Vite's import.meta.env.DEV constant.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lol2d = mgr;

  // open loading scene
  mgr.showScene(LoadingScene);

  // Coming back from the background is where every image in the game can be
  // gone. See the note on the probe in `AssetManager`: p5 keeps each one as an
  // off-DOM canvas, and that is the memory a phone reclaims first while the app
  // is not on screen. The probe is armed here, once, and read on every return —
  // but the probe alone is not the whole detection any more: it is one 1x1
  // canvas, small enough to survive a purge that took every real asset
  // (reported from a real installed PWA after the probe shipped), so a return
  // from a *long* stay in the background restores unconditionally
  // (`FORCED_RESTORE_HIDDEN_MS`), and only the short hops stay probe-gated.
  //
  // Three return signals, not one. `visibilitychange` is the ordinary pair;
  // `pageshow` with `persisted` is the back/forward cache handing back a page
  // whose canvases went cold while it slept; `focus` is the belt-and-braces
  // for installed iOS home-screen apps, where `visibilitychange` has a history
  // of not firing on return. A resume with no recorded absence just reads the
  // probe, so a spurious signal costs one 1x1 getImageData.
  AssetManager.armBackingStoreProbe();
  if (typeof document !== 'undefined') {
    let hiddenAtMs: number | null = null;

    const resume = (forcedHiddenForMs?: number) => {
      const hiddenForMs =
        forcedHiddenForMs ?? (hiddenAtMs === null ? 0 : performance.now() - hiddenAtMs);
      hiddenAtMs = null;
      void AssetManager.recoverIfLost(undefined, hiddenForMs);
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hiddenAtMs = performance.now();
      else resume();
    });
    window.addEventListener('pagehide', () => {
      hiddenAtMs = performance.now();
    });
    window.addEventListener('pageshow', event => {
      // A bfcache restore froze the page for however long it was away; treat
      // it as a long absence rather than trusting a probe that slept with it.
      if ((event as PageTransitionEvent).persisted) resume(Number.POSITIVE_INFINITY);
      else resume();
    });
    window.addEventListener('focus', () => {
      if (!document.hidden) resume();
    });
  }

  // Last, and fire-and-forget: caching the app must never be on the path
  // between the player and a running game. See src/pwa/updates.ts.
  registerServiceWorker();
};
