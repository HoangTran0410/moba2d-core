import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/seams/importScan';

/**
 * **The mouse wheel does not zoom the camera**, and that is a rule rather than
 * an omission.
 *
 * p5 wires its input callbacks on `window`, not on the canvas — the same fact
 * `GameScene.syncTouches` already guards against by checking `event.target`.
 * A wheel notch therefore arrives whether the cursor is over the world or over
 * a HUD panel layered on top of it, so scrolling the shop's stock list zoomed
 * the map out from under the player at the same time. Every panel with a
 * scrollable body has that bug the moment a wheel handler exists, which is why
 * the answer is to delete the handler rather than to teach one panel to stop
 * it.
 *
 * Zoom is not lost with it: the Cài đặt tab's `#practice-zoom` slider sets the
 * factor directly, it persists through `setZoomFactorPreference`, and it is
 * reachable from inside a match as well as from the menu — which the wheel
 * never was on a phone.
 *
 * `SceneManager` keeps its empty `mouseWheel` and its name in the routing
 * list: that is p5's own callback surface, mirrored generically for every
 * scene, and pulling one name out of it would make the mirror a special case
 * for no behaviour. What matters is that no scene overrides it.
 *
 * Comments are stripped before matching, or this test flags the paragraph you
 * are reading.
 */

const SRC = join(process.cwd(), 'src');

const EXEMPT = new Set([
  /** p5's generic callback mirror. See the file comment. */
  'managers/SceneManager.ts',
  /**
   * `DomUtils.preventZoom`, which cancels ctrl+wheel — the *browser's* page
   * zoom, which resizes the canvas element and every HUD control on it. That
   * is the opposite of a camera control and the reason it is still wanted.
   */
  'utils/dom.utils.ts',
]);

/**
 * Directories this rule has no business in.
 *
 * `mapEditor/` is a *different page* — its own HTML entry, its own canvas, its
 * own camera, and no `SceneManager` anywhere in it. The rule above is about
 * one thing: a wheel notch over the game reaching the game's camera, because
 * it fires over every HUD panel too and there is no way to scroll a list
 * without zooming the world. An editor whose whole job is panning and zooming
 * a map has the opposite requirement, and it arrived under `src/` only when it
 * stopped being nine `<script>` tags in `public/`.
 */
const EXEMPT_TREES = ['mapEditor/'];

/**
 * Anything that means "a wheel notch happened". `deltaY` is deliberately not
 * on the list: it is an ordinary name for a y-difference, and `NavGrid`'s DDA
 * walk and `quadtree`'s circle test both use it for arithmetic that has never
 * seen an event.
 */
const WHEEL_TOKENS = ['mouseWheel', 'WheelEvent', 'onwheel', "'wheel'", '"wheel"'];

const sourceFiles = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|vue)$/.test(entry)) found.push(full);
  }
  return found;
};

describe('the wheel', () => {
  it('is not read anywhere outside p5’s own callback mirror', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (EXEMPT.has(rel)) continue;
      if (EXEMPT_TREES.some(tree => rel.startsWith(tree))) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const token of WHEEL_TOKENS) {
        if (source.includes(token)) offenders.push(`${rel}: ${token}`);
      }
    }
    expect(
      offenders,
      `a wheel notch reaches the game again — it fires over every HUD panel too:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('leaves the settings slider as the way to zoom, so the feature is moved and not removed', () => {
    // The assertion that stops the test above from being satisfied by deleting
    // zoom altogether.
    const tab = readFileSync(join(SRC, 'game/hud/config/SettingsTab.vue'), 'utf8');
    expect(tab).toContain('practice-zoom');
    expect(tab).toContain('ZOOM_FACTOR_MAX');
  });
});
