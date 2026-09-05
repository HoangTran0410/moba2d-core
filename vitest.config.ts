import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { moba2dPackTestConfig } from './src/testing/vitest.mjs';
// @ts-expect-error — plain .mjs helpers shared with the build scripts, which
// have no types of their own and are not part of any TypeScript program.
import { installedContentPackages } from './scripts/installed-packs.mjs';
// @ts-expect-error — same.
import { packDependentTests } from './scripts/pack-dependent-tests.mjs';

/**
 * Test files whose subject is a content pack this checkout does not have.
 *
 * Written when this was empty in every ordinary checkout — both packs lived
 * here, so nothing was excluded, and this list was non-empty only inside
 * `npm run verify:without-packs`, the drill that moved `packs/riot/` out of
 * the tree for the run and put it back after. **That stopped being true at
 * content-pack-and-repo-split batch 6 task 10**: `packs/riot/` left this
 * repository for good, so `installed` below is permanently `['reference']`
 * and this list is non-empty on every ordinary `npm run verify`, not only
 * inside the drill — measured at task 11 and re-measured after task 11's own
 * follow-up changed the population, 54 files (458 `it`/`test` cases), none
 * of them failing, all of them silently not collected. Most name real Riot
 * content with no equivalent in the thin reference pack (Baron's pit,
 * Summoner's Rift's own wall polygons, the full spell catalogue) and were
 * always going to stay excluded the day the pack actually left — see
 * `scripts/pack-dependent-tests.mjs`'s own header for which. Growing the
 * reference pack far enough to give them a real subject again, or moving the
 * ones that are genuinely pack-repository content into `@moba2d/content-riot`
 * itself, is unfinished work named in this batch's own handover, not
 * something this comment should keep pretending is rare.
 *
 * **This count moves** whenever a file starts or stops reaching a pack this
 * checkout does not have — task 11's own follow-up round removed two e2e
 * scripts that used to import `packs/riot/...` directly and dropped the file
 * count from 56 to 54 without changing the case count at all (neither
 * removed script was a `.test.ts` file, so neither carried any `it`/`test`
 * cases). The whole-branch fix pass moved it again, 54 to 62: eight more
 * `tests/e2e/` drivers name riot content as plain string literals (a
 * `championName`, a map id, a CSS selector for a champion's kit shelf) where
 * no import scan could ever have seen them — `scripts/pack-dependent-tests.mjs`'s
 * own header, third bullet, has the list and why each stays pack-dependent
 * rather than repointed. Same case count again: none of the eight is a
 * `.test.ts` file. Re-derive rather than trust either number written here:
 * `packDependentTests(root, installedContentPackages(root).map(p => p.name))`,
 * the same call this file makes below, returns the current list; counting
 * `^\s*(it|test)\(` across its `.test.ts` members gives the case total.
 *
 * Without this exclusion the run cannot even start: Vitest resolves every
 * collected file's imports before running anything, so one unresolvable
 * `packs/riot/spells/Yasuo_Q` fails the whole run rather than the file that
 * named it.
 *
 * Derived, never listed: see `scripts/pack-dependent-tests.mjs` for why a glob
 * would have caught 69 of the original 138 and why the closure is over
 * `tests/`'s own import graph.
 */
const installed = installedContentPackages(__dirname).map((pack: { name: string }) => pack.name);
const packDependent: string[] = packDependentTests(__dirname, installed);

/**
 * Population-sensitive tests, excluded ONLY under the pre-push hook's linked
 * gate (`MOBA2D_LINKED_GATE=1`, set by `scripts/git-hooks/pre-push`).
 *
 * Each of these asserts the exact set of installed packs — registry
 * membership, map counts, the jungle camp namespace, the summoner-spell
 * list, a defence-profile fallback a linked champion legitimately overrides
 * — so a machine with dev-linked packs answers them differently by
 * construction, not by bug. They run everywhere else: CI, an unlinked push,
 * a plain local `vitest run`. The honest fix for each is deriving its
 * expectation from what is installed (`tests/support/installedPacks.ts` is
 * the pattern); do that, then delete its line. A seventh test failing only
 * under a link gets fixed or added here consciously — the linked gate skips
 * nothing it was not told about.
 */
const populationSensitive =
  process.env.MOBA2D_LINKED_GATE === '1'
    ? [
        'tests/content/registry.test.ts',
        'tests/game/preset.customKitDefence.test.ts',
        'tests/game/preset.runtimePack.test.ts',
        'tests/game/slotObjects.test.ts',
        'tests/game/config/matchConfigSource.contract.test.ts',
        'tests/game/hud/shopSubject.test.ts',
      ]
    : [];

/**
 * The same preset a separated pack's own `vitest.config.ts` spreads
 * (published as `@moba2d/core/testing/vitest`). Core runs under it too,
 * rather than merely resembling it, so core is the preset's first real
 * consumer and not just its publisher — the two cannot silently drift apart
 * the way core's suite and a pack's suite used to run two hand-written
 * copies of the same four `tests/setup.ts` installations.
 */
const packPreset = moba2dPackTestConfig({ setupFiles: ['tests/setup.ts'] });

export default defineConfig({
  ...packPreset,
  // This config is separate from vite.config.ts (Vitest does not read it),
  // so anything the app's build needs to parse the source has to be repeated
  // here. `.vue` files went unnoticed by this gap for a while: nothing a
  // test imported unmocked reached one. It stopped being invisible the
  // moment `Game.ts` (imported directly, not mocked, by
  // tests/game/integration/SpellAimIntegration.test.ts) started pulling in
  // `InGameHUD.ts` -> `InGameHUD.vue` — Vitest's own esbuild transform can't
  // parse SFC syntax without this plugin.
  plugins: [vue()],
  test: {
    ...packPreset.test,
    // Agent git worktrees live at .claude/worktrees/<name>/ — full checkouts of
    // this repo nested inside it. Without this, a run in the main tree collects
    // every worktree's copy of every suite too, so the totals balloon and a
    // half-finished edit in someone else's worktree fails the run here.
    //
    // `packs/*/tests/**` is content-pack-extraction batch 6 task 6's own
    // move: a pack's tests now live inside the pack (`packs/riot/tests/`)
    // and run under the pack's own `vitest.config.ts`, with its own setup
    // file that registers a pack differently (`installPackForTests({ id,
    // assetManifest, data })`, read off the pack's own barrel, rather than
    // core's `tests/setup.ts` looping `src/generated/installedPacks.ts`).
    // Without this exclusion core's own run collects the same 70 files a
    // second time, under a setup that was never meant to run them.
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/**',
      'packs/*/tests/**',
      ...packDependent,
      ...populationSensitive,
    ],
  },
});
