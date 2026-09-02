#!/usr/bin/env node
/**
 * `moba2d-shoot-vfx` — photograph a pack's abilities in the real renderer.
 *
 * ## Why this is a bin and not a script each pack copies
 *
 * Because the last three files `moba2d-pack-new` copied into a pack had all
 * drifted by the time anyone looked, and one of them shipped a published
 * manifest pointing at a 404. Tooling is core's, invoked by name.
 *
 * ## What it is for
 *
 * `npm run verify` cannot see whether an effect is legible, and no unit test
 * ever will. `@moba2d/core/testing/vfx` closes the rules a scan can hold;
 * this closes the rest, the only way they can be closed — run the ability and
 * look at it. The failures it exists to catch all shipped past a green build:
 * an ultimate that drew every projectile pointing east, a wave that vanished
 * on contact, a grip that rendered as a gold starburst.
 *
 *   moba2d-shoot-vfx [outDir] [championFilter]
 *
 * Reads `tests/e2e/vfx-casts.json` from the pack it is run in:
 *
 *   { "championName": "Gaara",
 *     "casts": [ { "champion": "Gaara", "slot": "R",
 *                  "aim": [600, 0], "frames": [300, 900, 1300] } ] }
 *
 * `frames` are milliseconds after the press, and they should straddle the
 * moments the ability *changes* — the windup, the strike, the settle —
 * because a single frame cannot tell an effect that animates from one that
 * pops in. Derive them from the spell's own tuning constants rather than
 * guessing. `aim` also places the punching bag, at 0.75x the aim vector.
 *
 * Then open **one or two** of the PNGs. A 1280x900 screenshot costs about
 * what 600 lines of source costs to read: trust the PASS/FAIL lines for "did
 * it fire", and spend the frames on judging the look.
 *
 * ## It needs a linked core checkout, and that is not a limitation
 *
 * The rig runs core's own Vite dev server, so it needs core's *source*, not
 * the published tarball — which means `npm run pack:link -- <pack>` from a
 * core checkout beside it. That is the same link `npm run dev` needs to see
 * the pack's champions at all, so anybody in a position to look at their own
 * VFX already has it.
 *
 * Deliberately **not** part of `verify`: it wants a real Chrome and real
 * minutes, and `verify` runs on every push. Run it once per ability that has
 * a shape in it, not once per commit.
 */
import { existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const packRoot = process.cwd();
const sheet = join(packRoot, 'tests/e2e/vfx-casts.json');

if (!existsSync(sheet)) {
  console.error(
    `\n  No cast sheet at tests/e2e/vfx-casts.json.\n` +
      `  It names the champion and which frames to photograph — see this\n` +
      `  script's header for the shape.\n`
  );
  process.exit(1);
}

/**
 * The core checkout, found through the pack's own `node_modules`.
 *
 * `realpathSync` on purpose: a symlink resolves to the checkout, and a plain
 * directory is the tarball npm fetched, which carries no `tests/`.
 */
const installed = join(packRoot, 'node_modules/@moba2d/core');
if (!existsSync(installed)) {
  console.error('\n  @moba2d/core is not installed. Run `npm install` first.\n');
  process.exit(1);
}

const coreRoot = realpathSync(installed);
const rig = join(coreRoot, 'tests/e2e/shoot-new-champion-vfx.mjs');

if (!existsSync(rig)) {
  console.error(
    `\n  This needs a *linked* core checkout, not the published package.\n` +
      `  Resolved @moba2d/core to:\n    ${coreRoot}\n` +
      `  which has no tests/e2e/. From a core checkout beside this pack:\n\n` +
      `    npm run pack:link -- ${packRoot}\n\n` +
      `  (The same link \`npm run dev\` needs to see this pack at all.)\n`
  );
  process.exit(1);
}

const [outDir = '/tmp/moba2d-pack-vfx', only] = process.argv.slice(2);
console.log(`shooting ${only ? `"${only}"` : 'the whole sheet'} into ${outDir}`);
console.log(`  core: ${coreRoot}`);

const result = spawnSync('node', [rig, outDir, ...(only ? [only] : [])], {
  cwd: coreRoot,
  stdio: 'inherit',
  env: { ...process.env, MOBA2D_VFX_CASTS: sheet },
});

process.exit(result.status ?? 1);
