#!/usr/bin/env node
/**
 * `moba2d-generate-maps` — turns a pack's map-editor exports into the
 * minified geometry it ships and the polygon-free meta its picker reads.
 *
 * The rules it enforces are about *core's* format — `src/mapEditor/`
 * writes it, and `src/content/activeMap.ts` is what stopped covering for the
 * fields that must not survive the trip — so the generator lives here and
 * every pack invokes the one copy, exactly as `moba2d-generate-assets` and
 * `moba2d-generate-spell-catalog` beside it do. `scripts/pack-assets.mjs`
 * records what the alternative cost: `@moba2d/content-riot` carried its own
 * full copy of the asset walk, and a fix to one was a fix to neither.
 *
 * Not wired into `moba2d-pack-new`'s scaffold — see the module's header for
 * why a new pack's hand-written TypeScript map is the right day-one shape,
 * and what a pack adds to its own `scripts` when it starts drawing maps.
 *
 * The module it drives is plain `node:fs`/`node:path` with no Vite and no
 * `ContentApi`, which is what makes it safe to run from a pack that has none
 * of core's runtime loaded.
 *
 * Usage:
 *   moba2d-generate-maps            write
 *   moba2d-generate-maps --check    fail on drift, write nothing
 */
import { resolve } from 'node:path';
import { generate, report, PACK_MAP_TREE } from './generate-maps.mjs';

/** `--name=value`, or the fallback. */
function flag(name, fallback) {
  const prefix = `--${name}=`;
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  }
  return fallback;
}

// All three are flags because a pack is free to lay itself out differently
// and this should not be the thing that stops it.
const tree = {
  mapsDir: flag('maps', PACK_MAP_TREE.mapsDir),
  outputDir: flag('out', PACK_MAP_TREE.outputDir),
  suffix: flag('suffix', PACK_MAP_TREE.suffix),
};

const root = resolve(process.cwd(), flag('root', '.'));

try {
  report(generate(root, process.argv.includes('--check'), tree));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
