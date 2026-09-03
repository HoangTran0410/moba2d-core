import { dirname, resolve, sep } from 'node:path';
import type { SeamCheck, SeamViolation } from './types';
import { readSource, walkTsFiles } from './shared';
import { scanImports } from './importScan';

/**
 * A pack reaches core through the injected `ContentApi` and core's declared
 * public subpaths, and nowhere else.
 *
 * This is the rule the whole extraction rests on, and until fix round 4 of
 * content-pack-extraction batch 5 task 6 it was the one rule enforced on the
 * **wrong side**. `tsconfig.base.json` publishes core's own `@/*` alias so a
 * pack's `tsc` can see types *through* `ContentApi.ts`'s own internal
 * imports — a real need — and the side effect is that a pack file can name
 * any file under core's `src/`. Measured, not reasoned about: with
 * `import type SlowInternal from '@/game/gameObject/buffs/Slow'` planted at
 * the top of a pack spell, the pack's own `typecheck` exited 0, the pack's
 * own `check-seams` printed `scanned 237 file(s), clean`, and the only thing
 * that went red was `tests/content/packBoundary.test.ts` — a test in *core's*
 * tree, run by *core's* `verify`. The task those gates exist for says a pack
 * that breaks an engine rule reddens the pack's build, not the engine's, and
 * this was the inversion of it for the rule where it matters most. Worse, it
 * was an inversion with a shelf life: once `packs/riot/` is a sibling
 * repository, that core-side test has no population left to scan.
 *
 * ## Scoped to a package, not to a scanned tree
 *
 * Every other seam in this module answers a question about the file in front
 * of it, so it runs over whatever root the caller points at — `./spells`,
 * `./monsters`. This one answers a question about a *package*: a pack's
 * entry point (`pack.ts`), its generated barrels, its map and vfx modules
 * are all just as able to reach into core as a spell is, and are not under
 * any of those trees. So `scripts/check-seams.mjs` calls this seam with the
 * **owning package's root** rather than the scanned tree, which is also why
 * it is exported separately instead of sitting in `seams` beside the other
 * thirteen: `checkSeams(root)` runs rules that all mean the same thing about
 * the same `root`, and this one would silently mean something narrower there.
 *
 * ## It does not apply to core's own trees
 *
 * `@/...` *is* how core's own source refers to itself; core's `check-seams`
 * script scans core's own `coreSpells/`, `spellObjects/`, `buffs/` and
 * `attackableUnits/`, and every one of those files reaches its neighbours
 * that way. The CLI decides by ownership — it resolves the `package.json`
 * that owns the scanned tree and skips this seam when that package is core
 * itself — rather than by a flag a pack could set, and rather than by a
 * hard-coded path that stops meaning anything once a pack is a repository of
 * its own. See `scripts/check-seams.mjs`'s `owningPackage`.
 *
 * ## No exemption set, on purpose
 *
 * Every other rule here ships with a licence to break it, because every
 * other rule met code that predated it. This one has never had an exception
 * in either pack, and an exception is not a debt that gets paid down later —
 * a pack file naming a core internal is a file that cannot leave the
 * repository. `skip` still applies (it is read by `walkTsFiles`, shared by
 * every seam), which is the one lever a pack has, and a `skip` entry is
 * itself checked for staleness.
 */

/** The package name core publishes itself under — its own name for itself. */
const CORE_PACKAGE = '@moba2d/core';

/**
 * The three a pack's *source* may name, and only as `import type` — "type
 * only" describes what these three specifiers are limited to, not what this
 * whole seam is limited to. A spell is handed its api; it never imports
 * one. `ContentApi` also exports a real function, `buildContentApi()`,
 * that only core's own `install.ts` may call — so a pack writing
 * `import { buildContentApi } from '@moba2d/core/content/ContentApi'` (no
 * `type` keyword) is reaching for a value, not a type, and is refused like
 * any other core import. The API itself arrives as the argument to the
 * pack's factory; it is never imported.
 *
 * A specifier in `ALLOWED_VALUE` below is legal as `import type` too — a
 * type import is strictly the weaker of the two forms, so refusing it where
 * the value form is already allowed would ban the safer half of a
 * permission this seam already grants; `import type { InstalledPackForTests }
 * from '@moba2d/core/testing'` is exactly the shape a pack test should be
 * free to write. Fix round 1 of task 6's own review: this generalization
 * was already true (see the `kind === 'type'` branch below, which checks
 * both sets) but went undisclosed — `tests/seams/exported-seams.test.ts`
 * had a fixture asserting `import type { Spell } from '@moba2d/core/seams'`
 * was refused, which stopped being true the moment `/seams` joined
 * `ALLOWED_VALUE`, and nothing said so here.
 */
const ALLOWED_TYPE_ONLY = new Set([
  `${CORE_PACKAGE}/content/ContentApi`,
  `${CORE_PACKAGE}/content/ContentPack`,
  `${CORE_PACKAGE}/content/types`,
]);

/**
 * What a pack's *tests* — and the package-root files a pack's own test
 * *tooling* depends on — may name, as values. An observer builds a world
 * and reads it, which a type cannot do. One rule over two trees, rather
 * than two rules — a file is judged by which set its specifier is in, not
 * by where the file happens to sit, so there is no mode to get wrong and
 * no directory name to keep in sync.
 *
 * Not the four a test file itself imports (`/testing`, `/testing/spell`,
 * `/testing/spells`, plus `/content/types`, which is type-only and so lives
 * in `ALLOWED_TYPE_ONLY` above): this seam is scoped to the whole package
 * (see "Scoped to a package" above), and content-pack-extraction batch 6
 * task 6 found four more package-root files, neither a spell and neither in
 * the tree a pack's content lives in, that need a value import to do their
 * own job:
 *
 *   - `/testing/spells` — batch 6 task 7 step 4b's own fix. Filling core's
 *     whole spell registry for a test genuinely does reach into core's
 *     content-install machinery (`src/game/spellRegistry.ts`, which reaches
 *     `src/content/install.ts` and, through it,
 *     `src/generated/installedPacks.ts`) — not a leak (that graph regenerates
 *     clean of any pack reference the moment a pack is not physically
 *     installed, which is how core actually ships), but real import-graph
 *     weight that a test which never calls `loadSpellsForTests` should not
 *     have to evaluate just because it imported something else from
 *     `/testing`. That is why it is no longer part of the `/testing` barrel
 *     a test would otherwise get it from for free — see
 *     `src/testing/index.ts`'s own header. A pack test that wants
 *     `loadSpellsForTests`/`resolveSpellBarrel` says so explicitly, at this
 *     subpath, rather than getting the whole registry for free from the
 *     barrel.
 *   - `/testing/vitest` — `packs/riot/vitest.config.ts` spreads
 *     `moba2dPackTestConfig` from it, so the pack's own runner shares one
 *     preset with core's instead of a hand-copied config drifting from it.
 *   - `/testing/setup` — `packs/riot/vitest.setup.ts` imports
 *     `installEngineGlobalsForTests`/`installPackForTests` from here rather
 *     than from `/testing` itself, for the same reason core's own
 *     `tests/setup.ts` does: the barrel's `export *` eagerly loads
 *     `ContentApi` before any test file's own `vi.mock(...)` calls
 *     register (see `src/testing/setup.ts`'s own header).
 *   - `/seams` — `packs/riot/tests/noCoreReach.test.ts` value-imports
 *     `scanImports`/`stripComments` from it to run its own copy of "does
 *     this pack's test speak only published core surfaces". That file's own
 *     header already states why it needs the scanning tool itself: "the
 *     code that enforces a boundary is not itself a resident of the tree
 *     the boundary applies to" — the same fact that keeps
 *     `checkPackCoreBoundary` out of `@moba2d/core`'s own `seams` array.
 *     `skip` cannot carry this exemption instead: `scripts/check-seams.mjs`
 *     calls this seam over the *package* root with no `options` at all —
 *     deliberately, so a pack cannot exempt the one place a leaked core
 *     import is most likely to hide (that file's own header again) — so a
 *     per-tree `seam-debt.mjs` skip list has nothing to attach to here.
 *     Widening this set is the cost: `/seams` is now nominally reachable
 *     from a pack spell too, not only from `noCoreReach.test.ts`. Accepted
 *     for the same reason Step 2's third probe accepts `/testing` being
 *     reachable from a spell — nothing under `src/seams/` does anything a
 *     spell could use (its own imports are `node:fs`/`node:path`, browser
 *     builds externalize both), so the only real consequence of a spell
 *     naming it is a spell that cannot run, caught by the pack's own
 *     runtime the first time that code path executes, not a hole in what
 *     ships.
 *   - `/testing/items` — `describeItemShop`, the assertions a pack's shop has
 *     to satisfy because they are facts about what *core* does with an item.
 *     A value import for the plainest reason: it is a function a test calls,
 *     and it value-imports core's `Item` and `Stats` for the two constants
 *     (`INVENTORY_SIZE`, `MAX_COOLDOWN_REDUCTION`) it exists so that no pack
 *     copies. Out of the `/testing` barrel for exactly `/testing/spells`'
 *     reason: `export *` evaluates the whole module, and a pack test that
 *     only wanted `createGame` should not pay for the engine's item graph.
 *   - `/testing/spellText` — `describeSpellDescriptions`, the rules a
 *     description's coloured numbers have to satisfy. Here for the sharpest
 *     version of `/testing/items`' reason: three packs had each written their
 *     own scan of the same markup and the three checked different things, so
 *     a defect caught in one shipped in the other two — 38 spans in one pack
 *     spent their whole life claiming a scaling their abilities did not have.
 *     The rules are facts about `combat/DamageText.ts` and
 *     `combat/Amplification.ts`, and they belong beside the parser that
 *     decides what valid means.
 *   - `/testing/maps` — `mapIssues`, the rules a map has to satisfy for the
 *     same reason `/testing/items` publishes the rules a shop has to satisfy:
 *     they are facts about what *core* does with a map, and both shipped packs
 *     had written their own half of them, differently, as tables of
 *     coordinates measured off the map on the day somebody looked at it. Not
 *     via `/seams`, where the same functions also appear: that barrel carries
 *     core's source scanners and its own boundary checker — this one — and a
 *     pack has no business reaching into either. A pack's map suite imported
 *     `/seams` for exactly one commit and this seam was right to refuse it.
 *   - `/testing/bots` — `describeBotRoles`, the sweep that asks whether a bot
 *     can reach a kit at all. It value-imports `BotBrain` on purpose: the
 *     scores it reports come out of `scoreSpell` itself, so a pack cannot end
 *     up gated on a table of role weights copied out of the engine on the day
 *     somebody looked at it. That import is also exactly why it is not in the
 *     `/testing` barrel — 84KB of engine dragged into every pack test file
 *     that only wanted a champion fixture.
 *   - `/testing/vfx` — `describeVfxRules`, the VFX rules a scan can hold.
 *     Facts about the engine (what a missile carries, which globals the
 *     harness supplies), so a pack cannot derive them from its own source.
 *   - `/testing/tempo` — `describeTempo`, the cooldown band. Cheap, and here
 *     for the same reason `/testing/items` is: the ceiling is a property of
 *     the *engine* — moba2d is a fast game — and every pack that adopts it
 *     was otherwise deciding it alone, in numbers nothing compared.
 *   - `/pack-webp` and `/pack-assets` — the two build helpers a pack's own
 *     tooling runs: a Vite plugin that re-encodes art on the way into
 *     `dist/`, and the asset-manifest generator (a bin, but a pack test may
 *     import `assetKeyForPath` from it to check its own keys). Same shape as
 *     `/testing/vitest` above and admitted for the same reason: a pack's
 *     `vite.config.ts` is read by Vite and is never part of `pack.js`, so a
 *     value import there cannot become the bare unresolvable specifier this
 *     seam exists to prevent. The scaffold added these the day this set did
 *     — the template's `vite.config.ts` imports `webpAssets`, and a
 *     scaffolded pack failed its own `check-seams` on the first run, which is
 *     the seam working rather than a reason to weaken it.
 */
const ALLOWED_VALUE = new Set([
  `${CORE_PACKAGE}/testing`,
  `${CORE_PACKAGE}/testing/spell`,
  `${CORE_PACKAGE}/testing/spells`,
  `${CORE_PACKAGE}/testing/vitest`,
  `${CORE_PACKAGE}/testing/setup`,
  `${CORE_PACKAGE}/testing/items`,
  `${CORE_PACKAGE}/testing/spellText`,
  `${CORE_PACKAGE}/testing/maps`,
  `${CORE_PACKAGE}/testing/boundary`,
  `${CORE_PACKAGE}/testing/bots`,
  `${CORE_PACKAGE}/testing/tempo`,
  `${CORE_PACKAGE}/testing/vfx`,
  `${CORE_PACKAGE}/seams`,
  `${CORE_PACKAGE}/pack-webp`,
  `${CORE_PACKAGE}/pack-assets`,
]);

/** Whether a relative specifier resolves outside the package being scanned. */
function escapesPackage(packageRoot: string, file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const resolved = resolve(dirname(resolve(packageRoot, file)), specifier);
  return resolved !== packageRoot && !resolved.startsWith(packageRoot + sep);
}

/**
 * `root` is the pack's own package root — the directory its `package.json`
 * sits in — not one of the trees the other seams scan.
 */
export const checkPackCoreBoundary: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];

  for (const file of walkTsFiles(root, options)) {
    // Comments are stripped by `scanImports` itself, or this rule's own
    // prose about `@/...` would flag the files that document it.
    for (const { specifier, kind } of scanImports(readSource(root, file))) {
      const isOldAlias = specifier === '@' || specifier.startsWith('@/');
      const isBareSrc = specifier === 'src' || specifier.startsWith('src/');
      const isCorePackage = specifier === CORE_PACKAGE || specifier.startsWith(`${CORE_PACKAGE}/`);
      const isRelativeEscape = escapesPackage(root, file, specifier);

      if (isOldAlias || isBareSrc) {
        violations.push({
          file,
          message: `${specifier} — a core internal named through an alias no separated pack can resolve`,
        });
      } else if (isRelativeEscape) {
        violations.push({
          file,
          message: `${specifier} — a relative path out of this package; a package is reached by its name`,
        });
      } else if (isCorePackage && kind === 'type') {
        // A specifier in either set may be named as a type — ALLOWED_VALUE's
        // members are legal in both import forms, not only the value one;
        // see ALLOWED_TYPE_ONLY's own doc comment for why refusing the
        // weaker form where the stronger one is already allowed would be
        // backwards.
        if (!ALLOWED_TYPE_ONLY.has(specifier) && !ALLOWED_VALUE.has(specifier)) {
          violations.push({
            file,
            message: `${specifier} — not one of core's public content subpaths`,
          });
        }
      } else if (isCorePackage) {
        // A value import (or a side-effect / dynamic one, neither of which
        // has a type-only form): a value is a violation unless the
        // specifier is one this seam allows as a value at all.
        if (!ALLOWED_VALUE.has(specifier)) {
          violations.push({
            file,
            message: ALLOWED_TYPE_ONLY.has(specifier)
              ? `${specifier} — imported as a value, not a type`
              : `${specifier} — not one of core's public content subpaths`,
          });
        }
      }
    }
  }

  return violations;
};
