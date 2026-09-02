/**
 * Render quality and the FPS cap, as `localStorage` and nothing else.
 *
 * Split out of `Game.ts` for the reason `game/input/touchPreferences.ts` was
 * split out of `TouchControls.ts`: the match-config panel reads and writes
 * these, and that panel is mounted over the **menu** as well as over a running
 * match. `Game.ts` is the match — every spell, every unit, the navigation grid
 * — so a settings row asking "what FPS cap is stored?" would have pulled all of
 * it into the menu's chunk. Vite's `manualChunks` sends anything under
 * `src/game/` to the `game` chunk, but a module with no imports of its own
 * costs nothing to pull in.
 *
 * No p5 globals, no game objects: safe to import from the menu. `Game.ts`
 * re-exports all four so every existing `from '@/game/Game'` still resolves,
 * and remains the only thing that *applies* them (`frameRate`, the quality
 * branch in `ObjectManager`).
 */
import type { RenderQuality } from '@/game/managers/ObjectManager';

export type RenderFps = 30 | 60;

const RENDER_QUALITY_STORAGE_KEY = 'moba2d.renderQuality';
const RENDER_FPS_STORAGE_KEY = 'moba2d.renderFps';
const SCREEN_SHAKE_STORAGE_KEY = 'moba2d.screenShake';

export function renderQualityPreference(): RenderQuality {
  try {
    const stored = window.localStorage.getItem(RENDER_QUALITY_STORAGE_KEY);
    if (stored === 'low' || stored === 'high') return stored;
  } catch {
    /* storage blocked: use automatic quality */
  }
  return 'auto';
}

export function setRenderQualityPreference(quality: RenderQuality): void {
  try {
    window.localStorage.setItem(
      RENDER_QUALITY_STORAGE_KEY,
      quality === 'low' || quality === 'high' ? quality : 'auto'
    );
  } catch {
    /* storage blocked: the live setting still works */
  }
}

export function renderFpsPreference(): RenderFps {
  try {
    if (window.localStorage.getItem(RENDER_FPS_STORAGE_KEY) === '30') return 30;
  } catch {
    /* storage blocked: use 60 FPS */
  }
  return 60;
}

export function setRenderFpsPreference(fps: RenderFps): void {
  try {
    window.localStorage.setItem(RENDER_FPS_STORAGE_KEY, fps === 30 ? '30' : '60');
  } catch {
    /* storage blocked: the live setting still works */
  }
}

/**
 * Whether the camera may shake on the player's own heavy hits, kills and
 * death (`Camera.shake`, fed from `render/hitFeedback.ts`).
 *
 * On by default — except when the OS asks for reduced motion, which is the
 * one thing a player has already said about exactly this kind of effect. An
 * explicit choice in the settings tab wins over the OS either way.
 */
export function screenShakePreference(): boolean {
  try {
    const stored = window.localStorage.getItem(SCREEN_SHAKE_STORAGE_KEY);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
  } catch {
    /* storage blocked: fall through to the OS hint */
  }
  return !prefersReducedMotion();
}

export function setScreenShakePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(SCREEN_SHAKE_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* storage blocked: the live setting still works */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
    );
  } catch {
    return false;
  }
}
