import { vi } from 'vitest';
import { fastHypot } from '../utils/optimized.utils';
import AssetManager, { type PackAssetManifest } from '../managers/AssetManager';
import type { ContentPackData } from '../content/ContentPack';
import { cachedLanesForTests, setCachedLanesForTests } from './lanes';

/**
 * The four installations every test file's environment needs before its own
 * top-level code runs, shared by core's own `tests/setup.ts` and every
 * separated pack's own setup file — one implementation instead of two that
 * can drift apart. `installEngineGlobalsForTests` is pack-agnostic;
 * `installPackForTests` is not, and takes the pack it is installing as a
 * parameter rather than reading `src/generated/installedPacks.ts` itself —
 * that file is generated, exists only in core's own checkout, and says
 * nothing true in a separated pack's, while this module ships to every one
 * of them.
 *
 * Published on its own as `@moba2d/core/testing/setup`, not only as part of
 * `@moba2d/core/testing`'s barrel — a `setupFiles` entry (core's own
 * `tests/setup.ts`, and every separated pack's own) must import these two
 * functions from *this* subpath, never from the barrel. `export *` in
 * `src/testing/index.ts` evaluates every module it re-exports, not only the
 * bindings a particular import destructures, so importing this pair from the
 * barrel also evaluates `spellRegistry.ts` and `api.ts` — which reach
 * `content/ContentApi.ts`, and through it the real `Champion`, `packAsset`
 * and `AssetManager` — for real, before any individual test file's own
 * `vi.mock(...)` calls have registered. That is not hypothetical: it broke a
 * mocked `AssetManager` in core's own suite the first time this file's
 * exports were imported through the barrel from a setup file (task 3's own
 * fix round). **This module must never grow an import that reaches
 * `content/ContentApi.ts`** — being cheap enough to import from a
 * `setupFiles` entry without side effects is this file's contract, not an
 * accident of what it happens to need today.
 *
 * The lane cache this module writes through lives in `./lanes.ts`, not here
 * — a fact with its own history worth knowing before you move it back.
 * `cachedLanesForTests` used to live in this file, and being published as
 * `@moba2d/core/testing/setup` is exactly what stopped that working:
 * `package.json`'s `exports` publishes a file's *entire* export list, not
 * the bindings anyone intended, so the moment this subpath existed,
 * `cachedLanesForTests` — an implementation detail meant for this
 * checkout's own `tests/game/lanesFixture.ts` — became importable by any
 * pack too. `./lanes.ts` has no subpath of its own, so it has no such leak
 * to have.
 */

/**
 * `deltaTime`, `lerp`, `constrain`, `random` and `floor` are built once here,
 * at module scope, rather than inside `installEngineGlobalsForTests` itself
 * — a second call has to re-assign the *same* function references onto
 * `globalThis`, not fresh closures, or `globalThis.lerp` would be a
 * different function object after every call and nothing that compared it
 * by identity (Step 6's own idempotence test does exactly that) could ever
 * see the function as idempotent. `createVector` is a `vi.fn()` for the same
 * reason: one mock, reused, not a new spy replacing the last one's call
 * history on every call.
 */
const ENGINE_GLOBALS = {
  deltaTime: 16,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  constrain: (n: number, low: number, high: number) => Math.min(high, Math.max(low, n)),
  random: (min = 1, max?: number) =>
    max === undefined ? Math.random() * min : min + Math.random() * (max - min),
  floor: Math.floor,
  createVector: vi.fn(),
};

/**
 * Patches `Math.hypot` with `fastHypot` and assigns the p5 sketch baseline
 * (`deltaTime`, `lerp`, `constrain`, `random`, `floor`, `createVector`) onto
 * `globalThis`. Idempotent: every value it assigns is a stable reference
 * built once at module load, so calling this twice leaves `globalThis`
 * pointing at the exact same functions, not new ones.
 */
export function installEngineGlobalsForTests(): void {
  Math.hypot = fastHypot;
  Object.assign(globalThis, ENGINE_GLOBALS);
}

/**
 * One installed pack, from this module's point of view — the three fields
 * `installPackForTests` actually reads. A structural subset of
 * `src/generated/installedPacks.ts`'s own `InstalledPack`, not that type
 * itself: that type is declared in a generated file that exists only in
 * core's own checkout, and `src/testing/` ships to every pack, so it cannot
 * name a type that a separated pack's own checkout does not have.
 */
export interface InstalledPackForTests {
  id: string;
  assetManifest: PackAssetManifest;
  data: ContentPackData;
}

/**
 * Registers `pack.assetManifest` under `pack.id`, then — if the pack has a
 * first map and no earlier pack has already supplied one — resolves that
 * map's geometry and caches its lanes (`./lanes.ts`'s `setCachedLanesForTests`)
 * for `tests/game/lanesFixture.ts` to install as the active lane set.
 * Returns without effect on the lane half when the pack has no maps, or when
 * the cache is already filled; the asset half still runs regardless.
 *
 * ## Assets
 *
 * Batch 4 task 4 moved 377 champion portraits, spell icons and monster art
 * files out of core's `assets/` into `packs/riot/assets/`, so `spell_flash`,
 * `champ_yasuo` and the rest are no longer keys `AssetManager`'s own
 * manifest knows — only a *registered* pack manifest does
 * (`registerPackAssets`, resolved by `AssetManager.resolveDescriptor`'s
 * install-order fallback). In the real app that registration is a side
 * effect of importing `src/content/install.ts`; a great many spell tests
 * construct a real spell class straight from `buildContentApi()` and a pack
 * factory (`makeFlash(buildContentApi())`, `stacks.test.ts` and others)
 * without ever touching `install.ts` or `contentRegistry()`, so without this
 * every one of those constructors threw "Unknown asset key" the moment its
 * `image = api.asset('spell_x')` field initializer ran. One registration
 * here, run once per pack from the file every test file's environment
 * already runs before its own top-level code, covers every one of them — the
 * same shape `install.ts`'s own registration takes.
 *
 * `?.` because dozens of test files `vi.mock('.../AssetManager', ...)` with a
 * bare `{ get, getAsset }` double that has no `registerPackAssets` at all —
 * hoisted mocks apply to this module's own import too, and a no-op under one
 * is correct: those doubles never resolve a real key.
 *
 * ## Lanes
 *
 * Batch 4 task 6 moved Summoner's Rift's own lane waypoints out of
 * `src/game/lanes.ts` and into `packs/riot/maps/summonersRiftGeometry.ts` —
 * core's own default is an empty, laneless map now (Spec §7), because core
 * ships no map's coordinates
 * (`tests/content/summonersRiftCoordinateBoundary.test.ts` is the scan that
 * holds it to that). Before that move, `lanes.ts`'s own out-of-the-box
 * default *was* Summoner's Rift's three lanes, so every test that reads
 * `LANES`/`LANE_WAYPOINTS`/`getLaneWaypoints` without constructing a real
 * `Game` (nothing in this suite does — see `world.ts`'s `createGame`, always
 * the lightweight test double) got a concrete lane for free, including at
 * *module* scope — `MinionSpawner.test.ts`'s `WAVE_SIZE = 2 * LANES.length *
 * ...` is computed once, at import time, which no per-test `beforeEach`
 * could ever reach in time to fix. Caching the same real, checked-in map's
 * lanes here — once, before any test file's own top-level code runs —
 * covers every one of those the same way the asset registration above
 * covers `api.asset()`.
 *
 * The "no earlier pack has already supplied one" guard restores this
 * function's predecessor's own behaviour (`tests/game/lanesFixture.ts`'s old
 * `loadPackLanesForTests`, which only ever read `installedPacks[0]`): the
 * first map-bearing pack in install order wins, later ones do not overwrite
 * it. `tests/setup.ts`'s loop calls this once per installed pack for the
 * asset half regardless — this task's own move, not a redesign of pack
 * ordering — so the lane half needs its own guard to keep the old,
 * first-wins semantics rather than silently becoming "last pack with a map
 * wins." Inert with the one pack this checkout installs today.
 *
 * Async because `MapDefinition.geometry` is a lazy loader for a map the size
 * of Summoner's Rift — the terrain and lanes sit behind a dynamic import so
 * the menu's chunk never carries them — and both `tests/setup.ts` and a
 * separated pack's own setup file are allowed a top-level `await`.
 */
export async function installPackForTests(pack: InstalledPackForTests): Promise<void> {
  AssetManager.registerPackAssets?.(pack.id, pack.assetManifest);

  if (cachedLanesForTests().length > 0) return;

  const map = pack.data.maps?.[0];
  if (!map) return;

  const source = map.geometry;
  const geometry = typeof source === 'function' ? await source() : source;
  setCachedLanesForTests(geometry.lanes ?? []);
}
