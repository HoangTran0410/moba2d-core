import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// @ts-expect-error — a plain .mjs build helper with no types of its own.
import { webpAssets } from '@moba2d/core/pack-webp';

/**
 * The runtime-install build: `runtime-entry.ts` in, `dist/pack.js` plus its
 * chunks and assets out, and `scripts/write-manifest.mjs` describing the
 * result afterwards.
 *
 * Four settings here are load-bearing, and each one is a failure that has
 * actually happened rather than a preference:
 *
 * **Not `build.lib`.** Vite's asset plugin special-cases lib mode
 * unconditionally — `shouldInline()` opens with `if (config.build.lib)
 * return true;`, before it ever reads `assetsInlineLimit`. A pack built in
 * lib mode base64s every `?url` art import into `pack.js` however low the
 * limit is set. Everything lib mode would buy here (`fileName`, `formats`)
 * is spelled out by hand below, which does not carry that special case.
 *
 * **`base: ''`.** Vite's default `base: '/'` prepends a literal `/` to every
 * emitted asset path, and a runtime-installed pack is not served from the
 * root of the page that imports it — it is fetched cross-origin. `''` emits
 * `assets/foo.png`, which resolves against wherever `pack.js` itself came
 * from. The same property is what lets code splitting work at all here: the
 * browser resolves an emitted chunk specifier against the importing chunk's
 * own URL, so a pack can ship as a directory rather than one giant file.
 *
 * **`assetsInlineLimit: 0`.** Art belongs in `dist/assets/` as real files, so
 * the entry chunk — downloaded before the menu can draw — carries none of it.
 * `write-manifest.mjs`'s `assets: 'assets/'` is the promise this keeps.
 *
 * **`preserveEntrySignatures: 'strict'`.** What `build.lib` sets internally
 * and a plain build does not default to. Without it Rollup may restructure
 * the entry's exports, and a runtime install reads `default` and `data`
 * straight off `pack.js`'s namespace.
 *
 * Core is `external`: this pack's only crossings into it are `import type`,
 * which the compiler erases. If Rollup ever reports core as bundled, that is
 * a real boundary violation — the one `npm run check-seams` scans for —
 * not a config problem to work around here.
 */
export default defineConfig({
  // Raster art is re-encoded to WebP on the way into `dist/` — measured at
  // 70% smaller on the largest pack there is, with no code change anywhere:
  // an asset key strips the extension, so `champ_hero` is `champ_hero`
  // whether the file is a PNG or a WebP. The files under `assets/` are left
  // exactly as they are; see the plugin's own header for why that matters if
  // this pack ever imports art from somewhere that has to be cited.
  plugins: [webpAssets()],
  base: '',
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: resolve(__dirname, 'runtime-entry.ts'),
      external: [/^@moba2d\/core($|\/)/],
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: 'pack.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
