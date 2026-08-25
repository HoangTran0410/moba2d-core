#!/usr/bin/env node
/**
 * `moba2d-generate-assets` — walks a pack's `assets/` and writes its
 * `generated/assetManifest.ts`, so that `api.asset('champ_hero')` is a
 * compile-time key rather than a string that might be a blank square.
 *
 * ## Why this is a bin now
 *
 * It was not, and the gap was quiet. The scaffold's `assetManifest.ts` tells
 * an author, in its own header, that "a pack with more than a handful of
 * images generates this file instead of writing it; core's own
 * `scripts/generate-assets.mjs` is the worked example" — and that file was
 * absent from `package.json`'s `files`, so it was in no pack's
 * `node_modules` and the sentence pointed at nothing the reader could open.
 * A scaffolded pack shipped one base64 placeholder tile and no way up from
 * it.
 *
 * `@moba2d/content-riot` solved that by copying the whole generator, and its
 * copy's header records why: a survey measured the asset walk as having zero
 * core dependency, so duplicating it let the pack "stand entirely on its own
 * ... as a sibling repository with no core checkout beside it". **That
 * reasoning no longer holds.** A pack cannot build without core today — its
 * `catalog:generate` invokes `moba2d-generate-spell-catalog` by name, and
 * `check-seams` and `@moba2d/core/testing` are both hard dependencies — so
 * the scenario the duplication bought is not one any pack is in. Invoking
 * this by name is the same shape as the catalogue generator beside it, and
 * it is one copy instead of one per pack.
 *
 * The module it drives (`generate-assets.mjs`) is still plain
 * `node:fs`/`node:path` with no Vite and no `ContentApi`, which is what makes
 * it safe to run from a pack that has none of core's runtime loaded.
 */
import { resolve } from 'node:path';
import { generate, PACK_ASSET_TREE } from './generate-assets.mjs';

/** `--name=value`, or `undefined`. */
function flag(name, fallback) {
  const prefix = `--${name}=`;
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  }
  return fallback;
}

/**
 * A pack's layout, which is not core's: `assets/` beside `package.json`, and
 * the manifest under `generated/` with the rest of what is written for you.
 * All three are flags because a pack is free to lay itself out differently
 * and this should not be the thing that stops it.
 */
const tree = {
  ...PACK_ASSET_TREE,
  assetsDir: flag('assets', PACK_ASSET_TREE.assetsDir),
  outputPath: flag('out', PACK_ASSET_TREE.outputPath),
  keyPrefix: flag('prefix', PACK_ASSET_TREE.keyPrefix),
};

const root = resolve(process.cwd(), flag('root', '.'));

generate(root, process.argv.includes('--check'), tree).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
