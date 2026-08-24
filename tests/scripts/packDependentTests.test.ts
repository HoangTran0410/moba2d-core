import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — a plain .mjs build helper, shared with `vitest.config.ts`,
// with no types of its own and not part of any TypeScript program.
import { packDependentTests, readSource } from '../../scripts/pack-dependent-tests.mjs';

const ROOT = join(__dirname, '../..');

/**
 * `scripts/pack-dependent-tests.mjs` decides which test files Vitest skips
 * when a content pack this checkout does not have is their subject. It is the
 * thing that lets `npm run verify:without-packs` — content-pack-extraction
 * batch 5 task 8's departure drill — start at all: Vitest resolves every
 * collected file's imports before running anything, so one unresolvable
 * `packs/riot/spells/Yasuo_Q` fails the whole run rather than the file that
 * named it.
 *
 * Two properties matter and both have already been wrong once:
 *
 *   - **it excludes nothing in an ordinary checkout.** A deriver that
 *     over-matches silently deletes tests from every run anybody ever does,
 *     and the only symptom is a smaller number nobody was watching.
 *   - **it does not mistake a quoted import for a real one.** A source-scanning
 *     test's own fixture is an import statement written out as data, and this
 *     repository has both spellings — a template literal in
 *     `pregameBootPath.test.ts`, a double-quoted string in
 *     `importScan.test.ts`. The first version of the deriver marked both
 *     pack-dependent, which would have stopped the drill from running two of
 *     the very scans task 8 strengthened.
 *
 * The fixtures below are deliberately written the way the real files write
 * them, `packs/riot` and all. They are quoted strings, never imports, which is
 * exactly the distinction under test — and is why this file is not itself
 * pack-dependent.
 */
describe('which tests need a pack this checkout does not have', () => {
  it('excludes nothing when every pack is installed', () => {
    // The installed set is passed in rather than read, so this states the
    // property directly rather than relying on the drill's own bookkeeping:
    // asking about a checkout that has both packs must answer "nothing".
    expect(packDependentTests(ROOT, ['reference', 'riot'])).toEqual([]);
  });

  it('excludes the absent pack importers', () => {
    // Content-pack-extraction batch 6 task 6 moved `tests/packs/riot/` into
    // `packs/riot/tests/` — not under `tests/` at all — so the "living under
    // `tests/packs/<pack>/`" signal (`pack-dependent-tests.mjs`'s own header)
    // has nothing left to match for this pack; the pack's own test suite is
    // now the pack's own `npm test --workspace=@moba2d/content-riot`, which
    // simply does not run without the pack. What is left here is signal 1:
    // the tests that stayed in `tests/` and reach a pack spell to check an
    // engine rule against a real subject.
    //
    // Signal 3 ("through a build script rather than a module") had exactly
    // one member — `tests/wiki/import-abilities.test.ts`, which drove
    // `scripts/wiki/import-abilities.mjs`'s pack-asset-download path — and
    // content-pack-and-repo-split batch 6 task 10 moved both the test and
    // the script it drove out of this repository entirely, along with the
    // rest of `scripts/wiki/`. There is nothing left under `tests/` for that
    // signal to find; it stays wired (`pack-dependent-tests.mjs` still walks
    // `scripts/` as well as `tests/`) for whichever future build script a
    // test reaches a pack through next.
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    // A direct import.
    expect(withoutRiot).toContain('tests/content/install.test.ts');
    // The named-list signal (`PACK_CONTENT_FIXTURE_TESTS`): content-pack-
    // and-repo-split batch 6 task 10 fix round 1 repointed
    // `tests/game/spell/registry.ts` at the reference pack's own barrel
    // instead of `packs/riot/spells/index` — a real fix, not a loophole,
    // since `loadSpellsForTests` was always meant to take its barrels as
    // arguments — so an import scan can no longer find a `registry.ts`
    // importer transitively. `vi-spell-names.test.ts` reaches the pack a
    // different way this scan cannot see at all: `readdirSync`ing
    // `packs/riot/spells/` directly, not importing anything from it.
    expect(withoutRiot).toContain('tests/game/spells/vi-spell-names.test.ts');
  });

  it('leaves a scan whose fixtures merely quote a pack path in the run', () => {
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    // A template-literal fixture (`pregameBootPath`) and a double-quoted one
    // (`importScan`). Both files' real imports are core's own.
    expect(withoutRiot).not.toContain('tests/scenes/pregameBootPath.test.ts');
    expect(withoutRiot).not.toContain('tests/seams/importScan.test.ts');
  });

  it("does not mistake core's own src/scenes/packs directory for a content pack", () => {
    // `src/scenes/packs/` is the packs *screen* — `PackInstallConfirm.vue` and
    // the suggested-pack shelf. Its specifiers read
    // `@/scenes/packs/suggestedPacks`, and the deriver's `packs/<name>`
    // pattern reported that as a content pack called `suggestedPacks`. No
    // checkout has one, so the first importer of that directory dropped
    // itself — and `tests/scenes/packsBootPath.test.ts` with it — out of
    // every run including `npm run verify`, with nothing but a smaller total
    // to notice by. The case above catches it as a number; this names the two
    // files, so the fix is pinned where it can be read.
    const everything = packDependentTests(ROOT, ['reference', 'riot']);
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    for (const named of [
      'tests/scenes/packsSuggested.test.ts',
      'tests/scenes/packsBootPath.test.ts',
    ]) {
      // Or both `not.toContain`s below are vacuously true.
      expect(existsSync(join(ROOT, named)), `${named} no longer exists`).toBe(true);
      expect(everything).not.toContain(named);
      expect(withoutRiot).not.toContain(named);
    }
  });

  it('leaves a scan that asks whether the pack is installed in the run', () => {
    // Task 7's four scans each *derive* — and therefore name — `packs/riot/…`
    // roots, and each guards with `packIsInstalled`. Skipping them would undo
    // the whole point of that task: they are supposed to run over whatever the
    // checkout does have.
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    expect(withoutRiot).not.toContain('tests/content/vocabularyBoundary.test.ts');
    expect(withoutRiot).not.toContain('tests/content/coreSpellsApiSurface.test.ts');
    expect(withoutRiot).not.toContain('tests/game/spells/terrain-field-seam.test.ts');
    // Each of the three above must actually exist, or `not.toContain` is
    // vacuously true — which is what this assertion was for a fourth entry,
    // `tests/content/packAssetKeyBoundary.test.ts`, from the moment the
    // whole-branch review moved that scan into the `pack-asset-key` seam and
    // deleted the file. A named file that is gone reads exactly like a named
    // file that is correctly kept in the run.
    for (const named of [
      'tests/content/vocabularyBoundary.test.ts',
      'tests/content/coreSpellsApiSurface.test.ts',
      'tests/game/spells/terrain-field-seam.test.ts',
    ]) {
      expect(existsSync(join(ROOT, named)), `${named} no longer exists`).toBe(true);
    }
  });

  it('leaves a file whose only pack reach is a gated dynamic import in the run', () => {
    // Round 1 excluded these four whole — 105 tests of stat ceilings, speed
    // floors, regen, line of sight, vision and blackboard bucketing, none of
    // which is about any pack — because one `it()` in each named a pack spell.
    // Each now reaches it through `packIsInstalled('riot') ? await import(…) : null`
    // and skips that one case.
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    expect(withoutRiot).not.toContain('tests/game/config/PregameConfig.test.ts');
    expect(withoutRiot).not.toContain('tests/game/Stats.test.ts');
    expect(withoutRiot).not.toContain('tests/game/ai/TeamBlackboard.test.ts');
    expect(withoutRiot).not.toContain('tests/game/combat/Vision.test.ts');
  });

  it('tells a static import from a deferred one, which is what the gate rests on', () => {
    // The gate excuses a deferred specifier and must never excuse a static one:
    // a static import of a module that is not there makes the *file*
    // unloadable, so there is nothing a runtime check could save. No file in
    // this repository carries both halves for a fixture to observe it through,
    // so the split itself is pinned here.
    const kinds = readSource(
      [
        "import a from './static';",
        "export { b } from './re-exported';",
        "vi.mock('./mocked');",
        "const c = await import('./deferred');",
        "const d = () => import('./lazy');",
      ].join('\n')
    );
    expect(kinds.static).toEqual(['./static', './re-exported', './mocked']);
    expect(kinds.deferred).toEqual(['./deferred', './lazy']);
  });

  it('is a real population, not an empty list that would pass either way', () => {
    // Guards the guard: every `not.toContain` above is vacuously true against
    // an empty result.
    //
    // Before content-pack-extraction batch 6 task 6, this compared the
    // derived list against `tests/packs/riot/`'s own file listing — the
    // population that could not be missing, since every file in it names the
    // pack by construction. That directory moved into `packs/riot/tests/`
    // and no longer exists under `tests/` at all, so there is no directory
    // listing left to compare against; the known importers from the test
    // above are what is left to anchor this one. Derived, not `> 100`: see
    // that literal's own history, three tasks removed from the class of bug
    // a floor stops describing the moment the tree it counted changes shape
    // again — which is exactly what just happened here.
    const excluded = packDependentTests(ROOT, ['reference']);
    const knownImporters = [
      'tests/content/install.test.ts',
      'tests/game/spells/vi-spell-names.test.ts',
    ];

    expect(excluded.length).toBeGreaterThanOrEqual(knownImporters.length);
    for (const file of knownImporters) {
      expect(excluded, `${file} missing from the derived list`).toContain(file);
    }
  });
});
