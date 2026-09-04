import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The HUD paints over the world, and `position` is what makes that true.
 *
 * `#InGameHUD` has carried `z-index: 100` since the HUD existed, and for all
 * of that time it did nothing: `z-index` is ignored on a `position: static`
 * element. The HUD floated over the canvas by accident — an unpositioned,
 * unfiltered `<canvas>` paints in the background layer, below every
 * `position: fixed` child of the HUD, so the wrong rule and the right
 * behaviour never met.
 *
 * `#game-scene.dead-view canvas` is what introduced them. A `filter` makes an
 * element a stacking context, and a stacking context on a non-positioned
 * element paints with the `z-index: 0` group — the same group as the HUD's
 * `z-index: auto` children — and the canvas is appended *after* `#InGameHUD`
 * (`GameScene`: `createCanvas(...).parent('game-scene')`), so it won the tie.
 * Reported from a real match: the bottom bar and the team panel vanished the
 * moment the player died. Present in the DOM the whole time, clickable by a
 * script, invisible to the person playing — which is why no existing test saw
 * it and why this one reads the stylesheet rather than the DOM.
 *
 * A source scan, like `tests/scenes/viewportFit.test.ts`: the condition is a
 * paint-order fact that only a real browser with a real p5 canvas can produce,
 * and "the rule that fixes it is still written down" reads off the file in
 * milliseconds.
 */

const read = (file: string) => readFileSync(resolve(__dirname, '../../../', file), 'utf8');

/** Strip comments first, or the scan matches its own documentation. */
const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block for `selector`, comments already gone. */
const ruleFor = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has no rule of its own`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('the HUD outranks the canvas it floats over', () => {
  it('#InGameHUD backs its z-index with a position', () => {
    const rule = ruleFor(stripCss(read('styles/hud.css')), '#InGameHUD');

    expect(rule, 'the HUD root stopped declaring a rank at all').toMatch(/z-index:\s*\d/);
    expect(
      rule,
      'the HUD root has a z-index and no position — which is a comment, not a rank. ' +
        'Anything that makes the canvas a stacking context (a filter, an opacity, ' +
        'a transform) then paints over the whole HUD, because the canvas is ' +
        'appended after #InGameHUD inside #game-scene.'
    ).toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
  });

  /**
   * The other half of the same edit. `position: relative` on the HUD root
   * makes it the containing block for its `position: absolute` descendants,
   * and it is a zero-height box at the top of the scene — so the recap's
   * `top: 12%` would resolve against nothing and pin it to the ceiling.
   * `fixed` lands on `#game-scene` (transformed, see
   * `.center-page-container > div`), which is the full-viewport box it was
   * measuring against all along.
   */
  it('.death-recap is fixed, not absolute, now that the HUD root is positioned', () => {
    const rule = ruleFor(stripCss(read('styles/hud.css')), '.death-recap');

    expect(
      rule,
      'the death recap is position:absolute inside a positioned, zero-height ' +
        '#InGameHUD — its percentage offsets resolve against a box with no height'
    ).not.toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/position:\s*fixed/);
  });

  /**
   * The collapsed bar holds the panel's width rather than shrinking to its
   * content, and that is a decision, not a leftover.
   *
   * The panel is centred on the bottom edge, so a bar that resizes *moves*: at
   * respawn the countdown and the ally control go, an auto width closes up
   * behind them, and the two buttons on the right slide out from under a thumb
   * already reaching for one of them. `drive-kill-feed.mjs` measures the same
   * thing across a real respawn — this reads the rule that makes it true, in
   * milliseconds, and says why it is there.
   */
  it('.death-recap.collapsed keeps the panel’s width instead of shrinking to fit', () => {
    const css = stripCss(read('styles/hud.css'));
    for (const rule of css.split('.death-recap.collapsed {').slice(1)) {
      expect(
        rule.slice(0, rule.indexOf('}')),
        'the collapsed recap sizes to its content again — it is centred, so it ' +
          're-centres when the countdown goes at respawn and the buttons move ' +
          'under the thumb aiming at them'
      ).not.toMatch(/width:\s*auto/);
    }
  });

  /**
   * And the reason the first test exists at all, stated where a reader of
   * either file will find it: the death filter is what turns the canvas into
   * something that can climb. If it ever goes away this whole file can, too.
   */
  it('is guarding against a real filter on the canvas', () => {
    expect(
      stripCss(read('styles/game-scene.css')),
      'no filter on the canvas any more — see this file’s header before deleting it'
    ).toMatch(/#game-scene\.dead-view canvas\s*\{[^}]*filter:/);
  });
});
