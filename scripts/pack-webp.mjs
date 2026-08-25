/**
 * A Vite plugin that re-encodes a pack's raster art to WebP **during the
 * build**, leaving the files in `assets/` untouched.
 *
 * That last part is the design, not a convenience. A pack that imports art
 * from somewhere else usually has to be able to say where each file came from
 * and prove it has not been altered — the reference pack's own provenance
 * check re-hashes every imported image against a recorded SHA-256 and refuses
 * a mismatch, and separately refuses a path whose extension disagrees with the
 * MIME type the source served. Re-encoding in place makes that claim false and
 * breaks the gate that states it. So the conversion belongs where the output
 * is made: re-running an import cannot fight it, and the sources stay the
 * originals they claim to be.
 *
 * ## Why it is worth doing
 *
 * Measured on the largest pack there is: `assets/` was 2188 KB of a 3407 KB
 * build — 64% of everything a player downloads, before a line of game code.
 * Its champion portraits are 128x128 **8-bit RGB with no alpha channel**:
 * photographic crops stored losslessly. That is paying lossless prices for
 * lossy content, and it is three quarters of their bytes. All 373 images came
 * to 674 KB, 70% smaller, and the whole pack to 1874 KB.
 *
 * Quality 80, and WebP rather than AVIF. At 2x zoom, 80 and 90 and the
 * original are indistinguishable on this kind of art — the worst case by PSNR
 * was a portrait whose *original* has visible banding, because the PNG was
 * already a lossy image stored losslessly. Core draws a portrait at 80px in
 * the HUD and smaller elsewhere, so a 128px source is already a retina
 * multiple rather than detail anyone can see. AVIF measured 5 percentage
 * points better on a 30-file sample, which does not pay for a slower decode on
 * a cheap phone across hundreds of small images.
 *
 * ## Why a `load` hook
 *
 * `generated/assetManifest.ts` imports every asset as `?url`. Hooking `load`
 * with `enforce: 'pre'` gets in ahead of Vite's own asset plugin, so the file
 * Rollup emits — and therefore the name it hashes and the URL it hands back —
 * is the WebP. Rewriting `dist/` afterwards would mean rewriting hashed
 * filenames inside the emitted chunks, which is the fragile version of this.
 *
 * `sharp` is imported dynamically and is the *pack's* dependency, not core's:
 * a native module has no business in the engine's install, and a build without
 * it still produces a correct pack, just a heavier one.
 */
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

/** Only formats where a lossy re-encode is the right trade. */
const CONVERTIBLE = new Set(['.png', '.jpg', '.jpeg']);

/**
 * GIFs are excluded by not being in the set above: `sharp`'s WebP encoder
 * takes the first frame of an animated GIF and silently drops the rest, which
 * turns a spell's animation into a still with nothing to say it happened.
 * Five files, and `gif2webp` is a different tool.
 */
export function webpAssets({ quality = 80 } = {}) {
  let enabled = false;
  let sharp = null;
  const saved = { files: 0, before: 0, after: 0 };

  return {
    name: 'moba2d:webp-assets',
    enforce: 'pre',
    apply: 'build',

    async buildStart() {
      try {
        ({ default: sharp } = await import('sharp'));
        enabled = true;
      } catch {
        // A build without `sharp` still produces a correct pack, just a
        // heavier one. Warned rather than thrown: a contributor who cloned
        // the pack to change one number should not meet a native-module
        // install failure as a wall.
        this.warn(
          'sharp is not installed, so images ship as-is — run `npm install` to halve the pack'
        );
      }
    },

    async load(id) {
      if (!enabled || !id.endsWith('?url')) return null;
      const file = id.slice(0, -'?url'.length);
      const extension = extname(file).toLowerCase();
      if (!CONVERTIBLE.has(extension)) return null;

      let encoded;
      try {
        encoded = await sharp(file).webp({ quality }).toBuffer();
      } catch (cause) {
        // One unreadable image must not fail a 592-file build. Falling
        // through to `null` hands the file back to Vite's own asset plugin,
        // which ships the original.
        this.warn(`could not re-encode ${basename(file)}, shipping it as-is: ${cause.message}`);
        return null;
      }

      // A re-encode that came out *bigger* is not an optimisation. Rare, but
      // real for art that is already tiny or already palette-compressed, and
      // shipping it would make the case for this plugin false on those files.
      //
      // `stat`, not `sharp().metadata().size`: that field is `undefined` for
      // a PNG, so the first version of this guard compared against `Infinity`
      // and could never fire — it reported "100% smaller" on a build that had
      // in fact shrunk by 69%, which is how it was caught.
      const { size: original } = await stat(file);
      if (encoded.byteLength >= original) return null;

      saved.files++;
      saved.before += original;
      saved.after += encoded.byteLength;

      const reference = this.emitFile({
        type: 'asset',
        name: `${basename(file, extname(file))}.webp`,
        source: encoded,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference}`;
    },

    closeBundle() {
      if (!enabled || saved.files === 0) return;
      const kb = n => Math.round(n / 1024);
      // eslint-disable-next-line no-console
      console.log(
        `webp: ${saved.files} image(s), ${kb(saved.before)} KB -> ${kb(saved.after)} KB ` +
          `(${Math.round(100 - (100 * saved.after) / saved.before)}% smaller)`
      );
    },
  };
}
