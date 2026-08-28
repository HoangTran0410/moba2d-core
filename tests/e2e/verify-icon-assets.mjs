/**
 * The redrawn glyphs, as the browser actually sees them.
 *
 * `tools/icons/**\/*.svg` is the source and `scripts/render-icons.mjs` writes
 * what ships. Two things in that pipeline no unit test can see:
 *
 *   1. The pointer is a **hand-written `.cur`** — an ICONDIR with `type = 2`,
 *      a 32bpp bottom-up BGRA DIB and a 1bpp AND mask, composed byte by byte
 *      because `generate-assets.mjs` keys `kind: 'url'` off that extension
 *      alone, which is what keeps the pointer out of the p5 image loader. Get
 *      a field wrong and the file is silently not a cursor: CSS falls back to
 *      the default arrow, and nothing anywhere fails.
 *   2. Every buff icon is loaded by p5 into a `p5.Image` and drawn on the
 *      canvas. A glyph that rasterised to the wrong size, or did not decode at
 *      all, shows up as a missing HUD row (`hudState.ts` drops a buff whose
 *      image is missing) rather than as an error.
 *
 * So this boots the real game and asks the real decoder.
 *
 *   node tests/e2e/verify-icon-assets.mjs
 */
import { startHarness, startMatch } from './harness.mjs';
import { readdirSync, readFileSync } from 'node:fs';

/** Every glyph `tools/icons/buffs/` emits — the list the renderer walks. */
const BUFF_NAMES = readdirSync(new URL('../../tools/icons/buffs/', import.meta.url))
  .filter(name => name.endsWith('.svg'))
  .map(name => name.slice(0, -4))
  .sort();

/**
 * The size the cursor's *source* declares, read from the SVG rather than
 * written here. Hard-coding it would make this assertion agree with whatever
 * the renderer happened to emit; against the authored `width` it is two
 * independent artifacts having to match.
 */
const CURSOR_SIZE = Number(
  /width="(\d+)"/.exec(
    readFileSync(new URL('../../tools/icons/cursors/normal.svg', import.meta.url), 'utf8')
  )?.[1]
);

const { url, page, report, check, errors, guard } = await startHarness();

await guard(async () => {
  await page.goto(url, { waitUntil: 'load' });
  await startMatch(page);
  await page.waitForFunction(() => window.__lol2d?.scene?.oScene?.game?.objectManager, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(600);

  // 1. Every buff glyph decodes, at the size the sheet declares.
  //
  //    Fetched by source path because the harness serves the dev tree, where
  //    that is what the URLs are. The subject is the emitted file — a glyph
  //    that rasterised to the wrong box, or that the renderer wrote badly —
  //    and `createImageBitmap` is the same decoder p5's `<img>` path ends up
  //    in, so a file this accepts is one the game can draw.
  report.buffs = await page.evaluate(async names => {
    const sizes = {};
    for (const name of names) {
      try {
        const response = await fetch(`/assets/images/buffs/${name}.png`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        sizes[name] = `${bitmap.width}x${bitmap.height}`;
      } catch (error) {
        sizes[name] = `FAILED: ${error}`;
      }
    }
    return sizes;
  }, BUFF_NAMES);

  const wrong = Object.entries(report.buffs).filter(([, size]) => size !== '64x64');
  check(
    `all ${BUFF_NAMES.length} buff glyphs decode at 64x64`,
    wrong.length === 0,
    JSON.stringify(Object.fromEntries(wrong))
  );

  report.basicAttack = await page.evaluate(async () => {
    const response = await fetch('/assets/images/spells/basic_attack.png');
    const bitmap = await createImageBitmap(await response.blob());
    return `${bitmap.width}x${bitmap.height}`;
  });
  check(
    'the basic-attack icon decodes at 64x64',
    report.basicAttack === '64x64',
    report.basicAttack
  );

  // 2. The cursor: the game set one, and the browser can decode the file it
  //    named. A `.cur` Chromium refuses is a silent fall back to the default
  //    arrow, which looks like nothing at all having gone wrong.
  report.cursor = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const style = canvas ? getComputedStyle(canvas).cursor : '';
    const match = /url\(["']?([^"')]+)["']?\)/.exec(style);
    if (!match) return { style, decoded: null };
    try {
      const response = await fetch(match[1]);
      const bitmap = await createImageBitmap(await response.blob());
      return { style, href: match[1], decoded: `${bitmap.width}x${bitmap.height}` };
    } catch (error) {
      return { style, href: match[1], decoded: `FAILED: ${error}` };
    }
  });

  check(
    'the game sets a custom cursor',
    /url\(/.test(report.cursor.style ?? ''),
    report.cursor.style
  );
  check(
    `the browser decodes the hand-written .cur at ${CURSOR_SIZE}x${CURSOR_SIZE}`,
    report.cursor.decoded === `${CURSOR_SIZE}x${CURSOR_SIZE}`,
    `${report.cursor.decoded}`
  );
  check(
    'it is the .cur, not a fallback image',
    /\.cur/.test(report.cursor.href ?? ''),
    report.cursor.href
  );

  check('nothing went wrong', errors.length === 0, errors.join(' | '));
});
