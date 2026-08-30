import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The shop's compact layout, scanned rather than mounted.
 *
 * ## What broke, and why a scan is the check
 *
 * The report was that the shelf was a slot: on a phone held sideways the panel
 * gets ~350px of height and the header, the search band, the chip row and the
 * bag were taking 180 of them, leaving two rows of tiles. The fix moves those
 * bands off the vertical axis — the search box into the header, the chips into
 * a rail beside the grid — and the panel becomes a CSS grid to hold the shape.
 *
 * There is no DOM here and no layout engine, so nothing in this file can
 * measure a pixel; `viewportFit.test.ts` is as close as this repo gets. What
 * *can* be checked is the pair of structural invariants the new layout rests
 * on, and both of them fail silently rather than loudly:
 *
 *   - **An unplaced grid child.** `display: grid` with `grid-template-areas`
 *     silently auto-places any child that names no area, into an implicit row
 *     off the bottom of the template. Nothing errors, nothing warns; the panel
 *     just comes apart on the one device that takes this branch, which is the
 *     device nobody is looking at while they work.
 *   - **A class with no rule.** Vue does not check them, the compiler does not
 *     check them, and a chip whose `.shop-chip-label` was renamed simply keeps
 *     its word on a phone — which is the bug, silently.
 *
 * The behaviour halves live in `shopFilter.test.ts` and `shopState.test.ts`,
 * which are pure functions precisely so most of this panel is testable
 * without a browser.
 */

const panel = (): string =>
  readFileSync(join(__dirname, '../../../src/game/hud/shop/ShopPanel.vue'), 'utf8');

const shopCss = (): string => readFileSync(join(__dirname, '../../../styles/shop.css'), 'utf8');

/** Every stylesheet `index.html` loads, concatenated — they are all global. */
const stylesheets = (): string => {
  const dir = join(__dirname, '../../../styles');
  const html = readFileSync(join(__dirname, '../../../index.html'), 'utf8');
  const names = [...html.matchAll(/href="styles\/([A-Za-z0-9_.-]+\.css)"/g)].map(m => m[1]);
  expect(names.length, 'no stylesheet links found in index.html').toBeGreaterThan(3);
  return names.map(name => readFileSync(join(dir, name), 'utf8')).join('\n');
};

/**
 * The `<template>`, with its comments removed.
 *
 * Load-bearing: the prose in this file quotes class names and selectors freely,
 * and a scan that read them would be checking the documentation rather than the
 * markup — the trap that has already turned one assertion in this repo into a
 * list of sentences.
 */
const markup = (): string => {
  const source = panel();
  const body = source.slice(source.indexOf('<template>'));
  return body.replace(/<!--[\s\S]*?-->/g, '');
};

/** One `@media` block, from its condition to its matching closing brace. */
const mediaBlock = (condition: string): string => {
  const css = shopCss();
  const at = css.indexOf(`@media (${condition}) {`);
  expect(at, `no @media (${condition}) block — gone, or reworded`).toBeGreaterThan(0);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`@media (${condition}) never closes`);
};

/** The height-only block: everything that buys vertical space back. */
const shortBlock = (): string => mediaBlock('max-height: 560px');

/** The width-only block: whether the grid and the pane both fit. */
const narrowBlock = (): string => mediaBlock('max-width: 700px');

describe('the shop panel', () => {
  /**
   * `.btn`, `.primary` and `.map-picker-later` were all shipped in this
   * codebase as class names with no rule behind them. Vue does not check
   * them and neither does the compiler: a class that matches nothing is not
   * an error anywhere in the toolchain, it is just a control that looks
   * wrong on the one screen that takes that branch.
   */
  it('names no class the stylesheets do not define', () => {
    const css = stylesheets();
    // The lookbehind skips `:class` and `v-bind:class`, whose value is a Vue
    // expression rather than a list of names — `:class="chip.icon"` would
    // otherwise be read as a class called `chip.icon` and reported missing.
    const classes = new Set(
      [...markup().matchAll(/(?<![:\w-])class="([^"{}]+)"/g)].flatMap(match =>
        match[1].split(/\s+/)
      )
    );
    classes.delete('');
    expect(classes.size, 'the class scan matched nothing').toBeGreaterThan(10);

    const undefinedClasses = [...classes].filter(name => {
      // Font Awesome is the one family the sheets cannot answer for: it is a
      // CDN `<link>` in `index.html`, not a file in `styles/`.
      if (/^fa[srlbd]?(-|$)/.test(name)) return false;
      // Matched to a boundary, not as a substring: `.shop-chip` reads as
      // defined inside `.shop-chip-label`, which would let a truncated name
      // through — the exact failure mode this test exists for.
      return !new RegExp(`\\.${name}(?![\\w-])`).test(css);
    });

    expect(undefinedClasses).toEqual([]);
  });

  /**
   * The search box has to be a child of the header, and the chips a child of
   * the panel, or the compact grid cannot put either where it needs them:
   * CSS grid places children, and it cannot reach inside a wrapper to hoist
   * one out. A band of its own is exactly what was costing the shelf its
   * height, so the wrapper that used to hold both must stay gone.
   */
  it('keeps the search in the header and the chips at panel level', () => {
    const source = markup();
    const header = source.slice(source.indexOf('<header class="shop-header">'), source.indexOf('</header>'));
    expect(header, 'the search box left the header').toContain('class="shop-search"');

    expect(source, 'the filter band came back').not.toContain('class="shop-filter"');
    expect(source).toMatch(/^ {4}<div v-if="chips\.length" class="shop-chips">$/m);
  });

  /**
   * The silent one. `display: grid` auto-places a child that names no area
   * into an implicit row past the bottom of the template — no error, no
   * warning, just a panel that comes apart on a phone. So every direct child
   * of `.shop-panel` in the markup must be assigned an area, and every area
   * the template names must be claimed by one of them.
   */
  it('gives every direct child of the panel a grid area', () => {
    const source = markup();
    // Direct children sit at four spaces; `.shop-panel` itself is at two and
    // everything inside `.shop-main` is at six or more.
    const children = [...source.matchAll(/^ {4}<\w+[^>]*?\bclass="([a-z-]+)/gm)].map(m => m[1]);
    expect(new Set(children)).toEqual(
      new Set(['shop-header', 'shop-warning', 'shop-chips', 'shop-main', 'shop-bag'])
    );

    const compact = shortBlock();
    const areas = new Set(
      [...compact.matchAll(/^ {2}\.([a-z-]+) \{[^}]*?\bgrid-area: (\w+);/gms)].map(m => m[2])
    );
    const placed = new Set(
      [...compact.matchAll(/^ {2}\.([a-z-]+) \{[^}]*?\bgrid-area: \w+;/gms)].map(m => m[1])
    );
    expect(placed, 'a child of the grid names no area').toEqual(new Set(children));

    const template = compact.slice(compact.indexOf('grid-template-areas:'));
    const named = new Set(
      [...template.slice(0, template.indexOf(';')).matchAll(/[a-z]+/g)].map(m => m[0])
    );
    named.delete('grid');
    named.delete('template');
    named.delete('areas');
    expect(named, 'the template names an area nothing is placed into').toEqual(areas);
  });

  /**
   * The rail hides the chip's word to fit seventeen of them down 48px, and
   * that is only acceptable while the word is still *there*. Delete either
   * attribute and the phone is left with a column of unlabelled glyphs — for
   * a screen reader, a column of unnamed buttons.
   */
  it('keeps the chip’s word when the rail hides it', () => {
    const source = markup();
    expect(source).toContain(':title="chip.label"');
    expect(source).toContain(':aria-label="chip.label"');
    expect(source).toContain('<span class="shop-chip-label">{{ chip.label }}</span>');
    expect(shortBlock()).toMatch(/\.shop-chip-label \{\s*display: none;/);
  });

  /**
   * Both rails scroll under a thumb only because they say so: `GameScene`
   * calls `preventDefault()` on every touch on the page, so a scroller with
   * no `touch-action` is a dead region — the failure this codebase has
   * shipped three times. The chip rail turned vertical, so its axis had to
   * turn with it.
   */
  it('lets the compact chip rail scroll on the axis it now runs on', () => {
    const compact = shortBlock();
    const rail = compact.slice(compact.indexOf('.shop-chips {'));
    const rule = rail.slice(0, rail.indexOf('}'));
    expect(rule).toContain('flex-direction: column;');
    expect(rule).toContain('touch-action: pan-y;');
    expect(rule).toContain('overflow-y: auto;');
  });

  /**
   * The report: "chiều ngang đủ thì cứ hiện detail side-by-side với list item".
   *
   * These were one query — `(max-width: 700px), (max-height: 560px)` — doing
   * two unrelated jobs, and the seam between them is where the bug lived. A
   * landscape phone is 844px wide and 390 tall, so it matched on **height**
   * and was handed the take-turns layout, losing a detail pane it had 844
   * pixels of room for. Neither clause is wrong; putting them in one query
   * was.
   *
   * So each block gets one axis and keeps to it: height decides how much
   * chrome the sheet can afford, width decides whether both columns fit.
   */
  it('decides the detail pane on width alone, never on height', () => {
    const short = shortBlock();
    const narrow = narrowBlock();

    expect(short.split('\n')[0], 'the short block reads a width').not.toContain('width');
    expect(narrow.split('\n')[0], 'the narrow block reads a height').not.toContain('height');

    // Taking turns is the width block's job, all of it.
    for (const rule of [
      '.shop-panel.has-detail .shop-shelf',
      '.shop-panel.has-detail .shop-detail',
      '.shop-detail-back',
    ]) {
      expect(narrow, `${rule} is not in the width block`).toContain(rule);
      expect(short, `${rule} is back in the height block`).not.toContain(rule);
    }

    // And the height block must leave the pane alone entirely, or a phone
    // loses it again by a different route.
    expect(short).not.toMatch(/\.shop-detail \{/);
  });
});
