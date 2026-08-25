/**
 * Rasterises `tools/icons/**\/*.svg` into the PNG (and one .cur) the game ships.
 *
 * The SVGs are the source: 1KB of path data anyone can open, diff, recolour or
 * re-export, the same way `assets/images/others/logo.svg` is the source every
 * favicon and PWA icon comes from. The PNGs beside them in `assets/` are build
 * output that happens to be committed, because `assets/` is what the manifest
 * generator walks and what the game loads.
 *
 * Chromium rather than a rasteriser dependency: `@playwright/test` is already
 * here for the e2e scripts, and adding a native image library to core for a
 * step that runs when somebody edits a glyph — not on every build — is the
 * wrong trade. This is deliberately **not** part of `npm run verify`: it needs
 * a browser, and `verify` is the gate everything else waits on.
 *
 *   node scripts/render-icons.mjs           # rewrite every PNG
 *   node scripts/render-icons.mjs --check   # fail if any is stale
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'tools', 'icons');

/**
 * Where each source folder lands, and how big.
 *
 * The buff sheet is 64px because that is what every existing buff icon is and
 * what `Buff`'s HUD row samples down from. The cursor is 48px for the same
 * reason: it replaces a 48px one, and a pointer that changes size is a
 * pointer that suddenly feels different under the hand.
 */
const TARGETS = {
  buffs: { out: join('assets', 'images', 'buffs'), size: 64 },
  spells: { out: join('assets', 'images', 'spells'), size: 64 },
  cursors: { out: join('assets', 'cursors'), size: 32, cur: true, hotspot: [1, 1] },
};

const check = process.argv.includes('--check');

/**
 * Wraps 32-bit BGRA pixels in a Windows cursor.
 *
 * A `.cur` is an `.ico` with `type = 2` and the two class fields reused as the
 * hotspot. Written by hand because the extension is load-bearing rather than
 * cosmetic: `generate-assets.mjs` keys `kind: 'url'` off `.cur` alone, which is
 * what keeps the pointer out of the p5 image loader — it is a CSS value, never
 * a texture. Renaming it to `.png` would silently make it one.
 */
function buildCur(rgba, size, [hotX, hotY]) {
  const stride = size * 4;
  const xor = Buffer.alloc(stride * size);
  // A DIB is bottom-up, and its channel order is BGRA.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const from = (y * size + x) * 4;
      const to = (size - 1 - y) * stride + x * 4;
      xor[to] = rgba[from + 2];
      xor[to + 1] = rgba[from + 1];
      xor[to + 2] = rgba[from];
      xor[to + 3] = rgba[from + 3];
    }
  }
  // The 1bpp AND mask, rows padded to 4 bytes. Alpha already carries the
  // transparency for every renderer that matters; this exists because the
  // format demands it and a truncated one makes the file unreadable.
  const maskStride = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskStride * size);

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR and AND stacked, per the format
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(xor.length + and.length, 20);

  const image = Buffer.concat([header, xor, and]);
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(2, 2); // 2 = cursor. 1 would be an icon.
  dir.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt16LE(hotX, 4);
  entry.writeUInt16LE(hotY, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(dir.length + entry.length, 12);

  return Buffer.concat([dir, entry, image]);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const stale = [];
let written = 0;

for (const [folder, target] of Object.entries(TARGETS)) {
  const from = join(SOURCE, folder);
  if (!existsSync(from)) continue;
  const outDir = join(ROOT, target.out);
  mkdirSync(outDir, { recursive: true });

  for (const file of readdirSync(from)
    .filter(name => name.endsWith('.svg'))
    .sort()) {
    const svg = readFileSync(join(from, file), 'utf8');
    const name = basename(file, '.svg');
    const { size } = target;

    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    const png = await page.screenshot({ omitBackground: true, type: 'png' });

    let bytes = png;
    let outPath = join(outDir, `${name}.png`);
    if (target.cur) {
      const rgba = await page.evaluate(async source => {
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
      }, svg);
      bytes = buildCur(Buffer.from(rgba), size, target.hotspot);
      outPath = join(outDir, `${name}.cur`);
    }

    const current = existsSync(outPath) ? readFileSync(outPath) : null;
    if (current && current.equals(bytes)) continue;
    if (check) stale.push(outPath.slice(ROOT.length + 1));
    else {
      writeFileSync(outPath, bytes);
      written += 1;
    }
  }
}

await browser.close();

if (check && stale.length > 0) {
  console.error(`stale icon output:\n  ${stale.join('\n  ')}\nrun: node scripts/render-icons.mjs`);
  process.exit(1);
}
console.log(check ? 'icons up to date' : `rendered ${written} icon file(s)`);
