import { installEngineGlobalsForTests, installPackForTests } from '../src/testing/setup';
import { installedPacks } from '../src/generated/installedPacks';
import { installSummonersRiftLanesForTests } from './game/lanesFixture';

/**
 * Every test file's environment runs this before its own top-level code.
 * The four installations it used to do inline — patching `Math.hypot`, the
 * p5 sketch globals, one installed pack's assets, and that pack's lanes —
 * now live in `src/testing/setup.ts` as `installEngineGlobalsForTests` and
 * `installPackForTests`, so core's own suite and every separated pack's own
 * suite run exactly the same implementation of all four, rather than two
 * copies that can quietly drift. See that module's own doc comments for why
 * each installation exists and what broke without it.
 *
 * Imported from `../src/testing/setup` directly, **not** from
 * `../src/testing` (the `@moba2d/core/testing` barrel that also re-exports
 * it) — and a separated pack's own setup file should do the same, from
 * `@moba2d/core/testing/setup`, its own published subpath. The barrel's
 * `export *` evaluates every module it re-exports, not only the bindings a
 * particular import destructures, so importing this pair from the barrel
 * also evaluates `api.ts`, which value-imports `content/ContentApi.ts`, which
 * value-imports `Champion` and `packAsset`, which value-imports the real
 * `AssetManager` — all of it for real, during
 * *this* file's own module graph, which runs before any individual test
 * file's own `vi.mock(...)` calls are registered. `ChampionSpellLifecycle.test.ts`'s
 * `vi.mock('.../AssetManager', ...)` measured the consequence: importing the
 * barrel here bound `packAsset.ts`'s `AssetManager` reference to the real
 * class before that test's mock could ever reach it, so a real "Unknown
 * asset key" replaced the mock's `undefined`. The narrower import avoids the
 * eager load; `setup.ts`'s own imports never reach `ContentApi.ts`, and that
 * is a contract that module's own header holds it to, not an accident of
 * what it happens to need today.
 *
 * Read out of `src/generated/installedPacks.ts` rather than importing a
 * pack's manifest by path, and not for tidiness: that static import used to
 * be Vitest's *global setup*, so with `packs/riot/` moved out of the tree it
 * was not the pack's own tests that failed, it was the entire suite failing
 * to start. Content-pack-extraction batch 5 task 8's departure drill
 * (`npm run verify:without-packs`) is what measured that, and reading this
 * generated, conditional barrel instead is what lets that drill even start.
 * Same barrel `src/content/install.ts` reads, deliberately: two files
 * answering "which packs exist" two different ways is how they drift.
 */

installEngineGlobalsForTests();

for (const pack of installedPacks) await installPackForTests(pack);

installSummonersRiftLanesForTests();
