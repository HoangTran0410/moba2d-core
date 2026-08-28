# Core becomes a pack SDK, and the riot pack leaves — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Core publishes a designed test harness (`@moba2d/core/testing`) and a scaffold CLI, the riot pack's 69 test files stop reaching into core's checkout, and `packs/riot/` plus everything Riot at the repo root moves to a sibling repository that proves itself green with core installed as a real dependency and no symlink home.

**Architecture:** Three movements, in order. First core grows the second published surface the spec names — `api` is what a *spell* sees, `@moba2d/core/testing` is what an *observer* sees — built by moving core's own two fixture modules into `src/testing/` rather than writing new ones, so core's suite and the pack's suite run the same harness and cannot drift. Then the pack's tests are rewritten against that surface and moved into `packs/riot/tests/`, still inside this repo, where `verify:all` proves them green before anything moves. Only then does the content physically leave, into a git repository of its own, with a hermetic drill (core installed from a tarball into a temp directory) standing in for the private remote the author has not created yet.

**Tech Stack:** TypeScript 5.4, Vite 5, Vitest 1.6, npm workspaces, `moduleResolution: bundler`, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-23-pack-sdk-and-repo-split-design.md` — read it; this plan argues from it and every ruling resolves against it.

**Surveys — read the one your task names, never both:**
- `docs/superpowers/surveys/2026-08-23-pack-test-api-mapping.md` — the 55-specifier classification and the two fixture modules, line by line
- `docs/superpowers/surveys/2026-08-23-pack-authoring-surface.md` — what core publishes today, what `new-spell.mjs` does, the `@/` alias hole

**Prior ledger:** `.superpowers/sdd/2026-08-23-pack-sdk-and-repo-split/decisions.md` records the author's eight decisions verbatim. Read it before ruling on anything that looks like a preference.

## Global Constraints

- **Never merge this branch into `main` or `dev`.** CI deploys on push to either. The branch is `content-pack-batch-6`, worktree `/Users/hoangtran/Desktop/Github/MOBA2D-batch6`. Merging is the author's decision and is gated on the deploy question in Task 11.
- **Never delete `packs/riot/`, `tests/packs/riot/`, `docs/abilities/` or any asset.** Copy, verify byte-for-byte, commit in the destination, and only then remove from core through `git rm`. Task 9 states the exact sequence. `rm -rf` on any of those paths is a stop-and-ask.
- **Commit with explicit paths.** Never `git add -A`, never `git add .`, never a bare `git commit`. Concurrent agents share this worktree's parent checkout.
- **Never run `prettier --write` across a directory.** Several files predate the config and fail `--check` on `main`; reformatting them as a side effect buries the real diff. Format only files you wrote, by naming them.
- **Package names, exactly:** core is `@moba2d/core`, the riot pack is `@moba2d/content-riot`, the reference pack is `@moba2d/content-reference`. Bins are `moba2d-`prefixed.
- **Nothing is published to any npm registry.** The scaffold is a bin on core, invoked through `npx`. `npm create moba2d-pack` is a later, optional alias and is not in scope.
- **The player-facing name of the game does not change.** `moba2d:` localStorage prefixes, `window.__moba2d`, the PWA manifest name, the `<title>` and every string of in-game copy stay exactly as they are. Renaming the package is not renaming the game.
- **The pack's test count may not fall.** Measured on `dbb8b56`: `npx vitest run tests/packs/riot` → **69 files, 566 tests, all passing**. That number is the only evidence that no test quietly stopped running. A task that changes it must say why, in its report, with the new number.
- **Every widening of core's published surface is a deliberate act.** `tests/content/publicSurface.test.ts` pins `exports` and `bin` exactly; adding a subpath means editing that test in the same commit, and the test's doc comment says what the new entry is for.
- **p5 runs in global mode.** `map`, `text`, `fill`, `color`, `pop`, `random`, `line`, `point`, `scale`, `rotate`, `image` are globals; a local of the same name shadows one and `tsc` cannot see it. Name locals for what they mean.
- **`Array.prototype.filter` cannot narrow types** — it is polyfilled and re-declared in `src/types/global.d.ts` with the non-predicate overload first. Write a plain loop, never a cast.
- **`packs/reference/` never leaves, and never departs in a drill.** It is core's own content and the reason core is a game rather than a menu. `scripts/installed-packs.mjs`'s `CORE_OWN` is what keeps it out of every "move the packs aside" path; do not widen that.
- **Prose moving into `src/` must lose its Riot vocabulary — comments included.** `tests/content/vocabularyBoundary.test.ts` scans every `.ts`/`.vue` under `src/` and `tests/content/corePackTarball.test.ts` scans core's shipped tarball, under three rules: a champion or monster name from the installed pack (comments are deliberately **not** stripped), a spell-id **shape** (`/\b[A-Z][a-z]+(?:IV)?_[QWERP][A-Za-z0-9]*\b/` — so `Vera_Q` trips it as surely as `Malphite_Q`), and a quoted summoner-spell id. `tests/` was never in that scope; `src/testing/` is. Tasks 1, 2, 3 and 4 all move heavily-commented files from `tests/` into `src/`, and "moved verbatim" applies to **code bodies and to the lessons those comments teach — never to the champion names they teach them with**. Generalise the example, keep the point. There is no exemption to reach for: grandfathering new vocabulary into a published tarball is the leak this programme exists to close.
- **Use `git worktree`, never `git stash`.** Another agent's uncommitted work rides along with a stash.

## Measured facts — do not re-derive these

Every line below was produced by a command run against this worktree at `dbb8b56` while this plan was written. Trust them; if one turns out false, say so in your report rather than working around it silently.

1. **A `.ts`-source package installed from a tarball is consumable by Vitest in another repo.** `npm pack` on core (290 files, 1.4M) installed into a scratch package, `import { buildContentApi } from '@moba2d/core/content/ContentApi'` in a test file: **passes**, returning a live api whose `buffs.Slow`, `units.AttackableUnit` and `Spell` are real constructors. `node_modules/@moba2d/core` is a real directory, not a symlink.
2. **The `@` alias is load-bearing for that consumer, and nothing else is.** Without `resolve.alias['@'] = <core>/src` the run dies on `Failed to load url @/managers/AssetManager … in node_modules/@moba2d/core/src/content/ContentApi.ts`. Without `test.server.deps.inline` it still **passes** — so the preset must set the alias and need not set `deps.inline`. If a later file does fail to load out of `node_modules`, `server: { deps: { inline: [/@moba2d\/core/] } }` is the first thing to try, and the report should say it was needed.
3. **A consumer cannot locate core's root the usual way.** `require.resolve('@moba2d/core/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. Task 1 adds `"./package.json": "./package.json"` to `exports` for that reason, and the vitest preset resolves its own location from `import.meta.url` rather than depending on it.
4. **`AssetManager.get` throws on an unregistered key** (`src/managers/AssetManager.ts:388`, `Unknown asset key "<key>"`); `AssetManager.placeholder()` is a different path that `get` never falls through to. Registration, not mocking, is the answer.
5. **The 48 `vi.mock('.../AssetManager')` calls are dead weight.** Probed on `tests/packs/riot/spells/Malphite_E.test.ts`: deleting the three-line mock leaves the file at **7 passed (7)**. Batch 5's `tests/setup.ts` pack-asset registration already covers what the mock was there for. Task 4 is therefore *delete and prove*, not *design a replacement* — but prove it file by file, because one green sample is not 48.
6. **The two fixture modules are not interchangeable, and must not be merged.** Their `TestVector`s differ four ways — the general one alone has `div` and `rotate`, the spell one alone has `lerp` and `sub` (both have `limit` and `normalize`; an earlier draft of this line had that wrong, corrected against the real method lists). Their `createGame`s differ too: `mapSize = 6_400` with a full-map camera box, versus `mapSize: 1_000` with a 200×200 one. 46 files depend on the spell module, 12 on the general one. They move to two subpaths, keeping both names and both bodies verbatim.
8. **A `vitest.config.ts` cannot import a `.ts` module out of `node_modules`.** Probed directly: a config importing `@moba2d/core/content/ContentApi` dies on `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` — Vite's config loader externalises bare specifiers and hands them to Node, and Node refuses to strip types under `node_modules`. **The preset is therefore plain `.mjs`, not `.ts`**, and the same probe with an `.mjs` target passes end to end: the pack's config gets its alias and a test importing core's `.ts` source runs. This is why Task 3 writes `src/testing/vitest.mjs`. Test *files* are unaffected — those go through Vite's transform, which is the whole of Measured fact 1.
9. **None of the observer vocabulary reaches a `.vue` file.** All fifteen roots Task 4 publishes (`EventManager`, `Minion`, `Stats`, `FogOfWar`, `PackRegistry`, `validate`, `SpellInputController`, `preset`, both `BasicAttack`s, `lanes`, `constants`, `TeamId`, `ObjectManager`, `NavGrid`) close over `src/` without touching an SFC. Task 1's second isolation assertion and Task 4's additions therefore do not collide — but keep the assertion, because it is the thing that will catch the sixteenth.
11. **Moving the spell fixtures into `src/` trips the vocabulary boundary, and this is not hypothetical.** Measured during Task 1: four offences, all in doc comments — `Jhin`, `Malphite`, `Veigar` and the shape `Malphite_Q`. Both `vocabularyBoundary` and `corePackTarball` went red.

    The blast radius for the later moves was then measured with the same two rules, against the same roster derived from `packs/riot/spells` and `packs/riot/monsters`:

    | File, and the task that moves it | Offences |
    |---|---|
    | `tests/game/spell/registry.ts` (Task 2) | one shape offence: `Ahri_Q` |
    | `tests/setup.ts` (Task 3) | clean — its `champ_yasuo`/`spell_flash`/`packs/riot/...` mentions are lowercase or path-shaped and match neither rule |
    | `tests/game/lanesFixture.ts` (Task 3) | clean |

    Write the generalised prose as you move it. Then run both suites anyway: the rules are the authority and this table is a note about one afternoon's tree.
12. **`tsconfig.strict-core.json` already typechecks `tests/game/spell/**/*.ts`**, so the spell fixtures are under strict today and must stay under strict after the move. `tsconfig.strict-core-boundary.json` names `tests/game/spell/registry.ts` explicitly — Task 2 changes that file and must revisit that config.

## File structure

**New, in core:**

| File | Responsibility |
|---|---|
| `src/testing/world.ts` | The general world: `createGame(mapSize)`, `withWalls`, `indexObjects`, `stubGameGlobals`, `TestVector`, `TEST_AVATAR_KEY`, `TestGame`. Body moved verbatim from `tests/game/fixtures.ts`. |
| `src/testing/spellWorld.ts` | The spell world: `createGame()`, `createUnit`, `castContextFor`, `pressSpell`, `releaseSpell`, `withCastTime`, `installSpellObjectGlobals`, `installSketchMathGlobals`, `TestVector`, `TestGame`. Body moved verbatim from `tests/game/spell/fixtures.ts`. |
| `src/testing/api.ts` | `buildTestApi(overrides?)` — an observer's `ContentApi` with named members swapped, for the one test that needs to intercept what a pack spell constructs internally. |
| `src/testing/spellRegistry.ts` | `loadSpellsForTests(...barrels)` — the pack-parameterised replacement for `tests/game/spell/registry.ts`'s hard import. |
| `src/testing/setup.ts` | `installEngineGlobalsForTests()` and `installPackForTests(pack)` — the four things `tests/setup.ts` installs, minus any knowledge of which pack exists. |
| `src/testing/vitest.mjs` | `moba2dPackTestConfig(options)` — the Vitest preset a pack's own `vitest.config.ts` spreads, carrying the `@` alias fact from Measured fact 2. Plain `.mjs` on purpose: Measured fact 8. |
| `src/testing/index.ts` | The `./testing` barrel: `world` + `api` + `spellRegistry` + `setup`. |
| `scripts/pack-new.mjs` | `moba2d-pack-new <dir>` — scaffolds a whole runnable pack. |
| `scripts/pack-add.mjs` | `moba2d-pack-add <spell\|champion\|map\|monster> <name>` — adds one piece of content plus its test, to the pack the cwd is in. |
| `scripts/templates/pack/` | The scaffold's template tree, real files rather than template literals in a script. |
| `scripts/verify-pack-standalone.mjs` | The hermetic drill: core tarball + a copy of the pack in a temp dir, `npm test` and `check-seams` green, no symlink home. |
| `docs/PACK_AUTHORING.md` | Engine-generic authoring guide, the transferable ~90% of `ADDING_SPELLS.md`. |

**Changed shape:** `tests/game/fixtures.ts` and `tests/game/spell/fixtures.ts` become one-line re-export shims so core's own 58 dependent files do not churn. `tests/setup.ts` becomes a caller of `src/testing/setup.ts`. `tests/packs/riot/` becomes `packs/riot/tests/`.

**Leaving in Task 9:** `packs/riot/` (with its tests), `docs/abilities/`, `assets/source-manifest.json`, `scripts/wiki/`, `docs/spell-names-vi.json`, `docs/all-champions.jpg`, `docs/Health_bar_guide.webp`, and the Riot-specific sections of `docs/ADDING_SPELLS.md` and `docs/VFX_STANDARD.md`.

---

### Task 1: `@moba2d/core/testing` — the two worlds, moved not rewritten

**Files:**
- Create: `src/testing/world.ts`, `src/testing/spellWorld.ts`, `src/testing/index.ts`
- Modify: `tests/game/fixtures.ts`, `tests/game/spell/fixtures.ts` (both become shims), `package.json`, `tsconfig.strict-core.json`, `tests/content/publicSurface.test.ts`
- Test: `tests/content/publicSurface.test.ts`, `tests/testing/harnessIsolation.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, from `@moba2d/core/testing`:
  - `class TestVector` — the **general** one (`div` and `rotate` are its alone; it has no `lerp`, no `sub`)
  - `type TestGame = GameObjectRuntimeContext & { setPlayer(player: AttackableUnit): void }`
  - `const TEST_AVATAR_KEY = 'other_logo'`
  - `function createGame(mapSize?: number): TestGame` — `mapSize` defaults to `6_400`
  - `function withWalls(...)` — signature unchanged from `tests/game/fixtures.ts:154`
  - `function indexObjects(game: GameObjectRuntimeContext, objects: GameObject[]): void`
  - `function stubGameGlobals(): Record<string, ReturnType<typeof vi.fn>>`
- Produces, from `@moba2d/core/testing/spell`:
  - `class TestVector` — the **spell** one (`lerp` and `sub` are its alone; it has no `div`, no `rotate`)
  - `interface TestGame extends GameObjectRuntimeContext { setPlayer(...): void }`
  - `function createGame(): TestGame` — no parameter, `mapSize: 1_000`
  - `function createUnit(game: TestGame, x?: number, teamId?: string): AttackableUnit`
  - `function installSpellObjectGlobals(): void`, `function installSketchMathGlobals(): void`
  - `function castContextFor(...)`, `function pressSpell(...)`, `function releaseSpell(...)`, `function withCastTime<T extends Spell>(...)` — all signatures unchanged
  - `export { withWalls } from '@moba2d/core/testing'` — re-exported, not duplicated, exactly as `tests/game/spell/fixtures.ts:252` does today

**Why two subpaths and not one merged module:** Measured fact 6. The two `TestVector` classes and the two `createGame` functions have different bodies and 58 files depend on the difference. Merging them is a behaviour change disguised as a tidy-up. Two subpaths keep both names, both bodies and both call sites intact.

- [ ] **Step 1: Move the general fixtures into `src/testing/world.ts`**

`git mv tests/game/fixtures.ts src/testing/world.ts`, then fix only the import paths at the top — the bodies do not change. Old paths were `../../src/...`; from `src/testing/` they are `../...`:

```ts
import { vi } from 'vitest';
import { Rectangle } from '../libs/quadtree';
import ObjectManager from '../game/managers/ObjectManager';
import EventManager from '../managers/EventManager';
import NavGrid from '../game/nav/NavGrid';
import TerrainField from '../game/gameObject/map/TerrainField';
import TerrainType from '../game/enums/TerrainType';
import type AttackableUnit from '../game/gameObject/attackableUnits/AttackableUnit';
import type GameObject from '../game/gameObject/GameObject';
import type { GameObjectRuntimeContext } from '../game/gameObject/GameObject';
```

Add a file header saying what this module is and what it is not:

```ts
/**
 * The observer's half of core's public surface.
 *
 * `ContentApi` is what a *spell* sees: it is handed a world and acts on it.
 * This is what an *observer* sees: it builds a world, runs it, and reads the
 * result. Two roles, two doors, and neither is a place to leak core internals
 * through — if this module becomes a re-export barrel for `src/game/`, then
 * changing `AttackableUnit` is a breaking change for every pack again, just
 * through the back door.
 *
 * Moved here from `tests/game/fixtures.ts` unchanged. It lives in `src/`
 * rather than `tests/` because a separated pack's test files must be able to
 * reach it by package name, and `files` in `package.json` ships `src`.
 */
```

- [ ] **Step 2: Move the spell fixtures into `src/testing/spellWorld.ts`**

`git mv tests/game/spell/fixtures.ts src/testing/spellWorld.ts`, fix the import paths the same way (`../../../src/x` → `../x`), and change the final re-export line from `export { withWalls } from '../fixtures';` to `export { withWalls } from './world';`. Nothing else in the body changes.

- [ ] **Step 3: Write the barrel**

`src/testing/index.ts`:

```ts
/**
 * `@moba2d/core/testing` — everything an observer needs to build a match,
 * run it and read what happened. `@moba2d/core/testing/spell` is the second
 * door, for driving a single spell the way a keypress does.
 *
 * The spell world is deliberately not re-exported here: its `createGame` and
 * its `TestVector` are different from this module's, and a barrel that
 * exported both would have to rename one of them.
 */
export * from './world';
```

- [ ] **Step 4: Turn the two old fixture files into shims**

`tests/game/fixtures.ts`, whole file:

```ts
/**
 * Moved to `src/testing/world.ts`, so a pack that is its own repository can
 * reach it by package name. This shim exists so core's own 12 dependent test
 * files keep their import path; delete it when they are repointed, not before.
 */
export * from '../../src/testing/world';
```

`tests/game/spell/fixtures.ts`, whole file:

```ts
/**
 * Moved to `src/testing/spellWorld.ts` — see `../fixtures.ts` for why the
 * shim exists. 46 files import this path today.
 */
export * from '../../../src/testing/spellWorld';
```

- [ ] **Step 5: Publish the two subpaths**

In `package.json`, `exports` becomes exactly this — ten entries, with the three new ones last:

```json
  "exports": {
    "./content/ContentApi": "./src/content/ContentApi.ts",
    "./content/ContentPack": "./src/content/ContentPack.ts",
    "./content/types": "./src/content/types.ts",
    "./seams": "./src/seams/index.ts",
    "./tsconfig.base.json": "./tsconfig.base.json",
    "./types/global.d.ts": "./src/types/global.d.ts",
    "./types/poly-decomp.d.ts": "./src/types/poly-decomp.d.ts",
    "./testing": "./src/testing/index.ts",
    "./testing/spell": "./src/testing/spellWorld.ts",
    "./package.json": "./package.json"
  },
```

`./package.json` is there for Measured fact 3: without it a consumer's own config cannot locate core's root, and `require.resolve('@moba2d/core/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.

Add, beside `devDependencies`:

```json
  "peerDependencies": {
    "vitest": ">=1.6.0"
  },
  "peerDependenciesMeta": {
    "vitest": { "optional": true }
  },
```

`src/testing/` imports `vi` from `vitest`; a consumer that never imports `@moba2d/core/testing` never loads it, which is what `optional` says.

- [ ] **Step 6: Update the surface test — it must fail first**

Edit `tests/content/publicSurface.test.ts`: change the `it(...)` title from "seven" to "ten", add the three new subpaths to the expected array, and extend the doc comment with one paragraph naming what `./testing`, `./testing/spell` and `./package.json` are for and why they are not content API.

Run `npx vitest run tests/content/publicSurface.test.ts` **before** editing `package.json` if you did Step 5 out of order — the point is to see it fail on the count, once. Expected failure: `expected [ 7 items ] to deeply equal [ 10 items ]`.

- [ ] **Step 7: Keep the strict program honest**

`tsconfig.strict-core.json` includes `tests/game/spell/**/*.ts` today, which is how the spell fixtures were strictly typechecked. Add `"src/testing/**/*.ts"` to its `include` array so they still are after the move. Leave `tests/game/spell/**/*.ts` in place — the shim is in it and must also compile.

- [ ] **Step 8: Write the isolation test — the one rule this surface lives or dies by**

Create `tests/testing/harnessIsolation.test.ts`. Two source scans, using `tests/support/importScan.ts` for parsing (`scanImports`, `stripComments`) exactly the way the seam tests do:

```ts
import { describe, expect, it } from 'vitest';
// …read every .ts under src/, skipping src/testing/ itself…

describe('the test harness is a leaf of the app', () => {
  it('no shipping source file imports src/testing', () => {
    // Walk src/**/*.ts and src/**/*.vue outside src/testing/.
    // For each, scanImports(); fail on any specifier resolving into src/testing.
    // Failure message must name file and specifier.
  });

  it('src/testing reaches no .vue file, directly or transitively', () => {
    // Close over src/testing/'s own import graph, following relative
    // specifiers only. Fail if the closure contains a .vue file.
  });
});
```

The second assertion is the load-bearing one and it is not decoration: a pack's own Vitest run will not have `@vitejs/plugin-vue` installed (it is core's devDependency), so the day the harness's import closure touches an SFC, every separated pack's suite dies on an esbuild parse error with nothing in the diff to explain it. Core's own `vitest.config.ts` has the plugin and would stay green, which is exactly why a test has to hold the line.

Both scans need a non-empty population guard — assert the walk found at least 200 files for the first and at least 4 for the second, or a bad glob makes the test pass by finding nothing.

- [ ] **Step 9: Prove the isolation test can fail**

Temporarily add `import { createGame } from './testing/world';` to `src/game/Game.ts`, run `npx vitest run tests/testing/harnessIsolation.test.ts`, confirm it fails naming `src/game/Game.ts`, then revert the edit. Record the failure message in your report. Do the same for the second assertion by pointing a scratch file in `src/testing/` at `src/game/hud/InGameHUD.vue`, confirming the failure, then deleting it.

- [ ] **Step 10: Run the suite and commit**

```bash
npm run typecheck:core 2>&1 | tail -5
npx vitest run 2>&1 | grep -E "^ Test Files|^      Tests"
```

Expected: no typecheck errors, and the file/test totals unchanged from `dbb8b56` apart from the two files this task adds. Record both numbers.

```bash
git add src/testing tests/game/fixtures.ts tests/game/spell/fixtures.ts \
        tests/testing/harnessIsolation.test.ts tests/content/publicSurface.test.ts \
        package.json tsconfig.strict-core.json
git commit -m "feat(testing): publish the observer's half of core's surface"
```

---

### Task 2: the spell registry stops naming a pack, and `buildTestApi` replaces the last mock

**Files:**
- Create: `src/testing/spellRegistry.ts`, `src/testing/api.ts`
- Modify: `src/testing/index.ts`, `tests/game/spell/registry.ts`, `tests/game/preset.catalog.test.ts`, `tsconfig.strict-core-boundary.json`
- Test: `tests/testing/spellRegistry.test.ts` (create)

**Interfaces:**
- Consumes: `src/testing/index.ts` from Task 1.
- Produces, from `@moba2d/core/testing`:
  - `function loadSpellsForTests(...barrels: Record<string, unknown>[]): void` — resolves each barrel's factories against one shared `buildContentApi()` and fills the spell registry synchronously. Core's own `coreSpells` barrel is **always** included by the function itself; callers pass only their own.
  - `function resolveSpellBarrel(barrel: Record<string, unknown>): Record<string, unknown>` — the factory-to-class resolution, exported because a test may want the classes without touching the registry.
  - `function buildTestApi(overrides?: DeepPartial<ContentApi>): ContentApi` — a `ContentApi` with named members replaced. Implemented by building the real one and layering a shallow-per-namespace merge over it; it must not mutate the shared singleton.

- [ ] **Step 1: Write the failing test**

`tests/testing/spellRegistry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSpellsForTests, resolveSpellBarrel, buildTestApi } from '../../src/testing';

describe('loadSpellsForTests', () => {
  it('registers a barrel handed in by the caller, without naming any pack', () => {
    class Fake {}
    loadSpellsForTests({ ProbeSpell: () => Fake });
    // the registry is src/game/spellRegistry.ts; assert ProbeSpell resolves to Fake
    // NB: not `Probe_Q`. That shape matches the spell-id rule in
    // `tests/support/riotVocabulary.ts` — a placeholder is not exempt from it,
    // and this file is not under `src/`, but the habit is what carries into files
    // that are.
  });

  it('always registers core\'s own spells even when no barrel is passed', () => {
    loadSpellsForTests();
    // assert a coreSpells member (BasicAttack) is registered
  });
});

describe('buildTestApi', () => {
  it('swaps one member and leaves the rest of the namespace alone', () => {
    class FakeTelegraph {}
    const api = buildTestApi({ vfx: { CastTelegraph: FakeTelegraph } });
    expect(api.vfx.CastTelegraph).toBe(FakeTelegraph);
    expect(typeof api.vfx.CastBar).toBe('function');
    expect(typeof api.buffs.Slow).toBe('function');
  });

  it('does not mutate the shared api', () => {
    class FakeTelegraph {}
    buildTestApi({ vfx: { CastTelegraph: FakeTelegraph } });
    // assert buildContentApi().vfx.CastTelegraph is still the real one
  });
});
```

- [ ] **Step 2: Run it and read the message**

`npx vitest run tests/testing/spellRegistry.test.ts`. Expected: `Failed to resolve import "../../src/testing"` or `loadSpellsForTests is not a function`. Quote the actual message in your report.

- [ ] **Step 3: Write `src/testing/spellRegistry.ts`**

Move the body of `tests/game/spell/registry.ts` here, with one change and one addition. The change: delete `import * as AllSpellFactories from '../../../packs/riot/spells/index'` — the barrel arrives as a parameter now. The addition: `resolveSpellBarrel`, factored out of the existing `Object.fromEntries(...)` expression, because two callers want it.

Keep the existing doc comment about why this exists (238 dynamic imports) and add:

```ts
/**
 * The barrels arrive as arguments because core does not get to know which
 * packs exist. That is the same rule `TeamBlackboard` learned and the same
 * one `src/generated/installedPacks.ts` exists to serve: a list of installed
 * content is derived at build time, never written into engine source. The old
 * version of this file imported `packs/riot/spells/index` by relative path,
 * which is a specifier that resolves to nothing the day that directory is a
 * repository of its own.
 */
```

- [ ] **Step 4: Write `src/testing/api.ts`**

`buildTestApi(overrides)` builds the real api via `buildContentApi()` and returns a new object with each named namespace shallow-merged. `ContentApi`'s namespaces are frozen (`Object.freeze`, `src/content/ContentApi.ts:366`), so merge into fresh objects rather than assigning into the originals — a mutation would leak into every other test in the file, which `clearMocks` does not undo.

Its doc comment states the one job: `vi.mock()` on a core module path is not available to a separated pack, and the single test that needs to intercept what a pack spell constructs internally (`Janna_R.test.ts`, `CastTelegraph`) gets this instead.

- [ ] **Step 5: Run the test, expect green**

`npx vitest run tests/testing/spellRegistry.test.ts` → 4 passed.

- [ ] **Step 6: Repoint the old registry, and decide where `preset.catalog.test.ts` belongs**

`tests/game/spell/registry.ts` keeps its path (two files import it) and becomes:

```ts
import * as AllSpellFactories from '../../../packs/riot/spells/index';
import { loadSpellsForTests, resolveSpellBarrel } from '../../../src/testing';
import * as CoreSpells from '../../../src/game/gameObject/coreSpells/index';

const AllSpells = resolveSpellBarrel(AllSpellFactories);

export function loadEverySpellForTests(): void {
  loadSpellsForTests(AllSpellFactories);
}

export { AllSpells, CoreSpells };
```

It still names the pack — deliberately, and only until Task 5 moves the pack's tests out. It is a **core** test helper that will have no pack to name afterwards.

`tests/game/preset.catalog.test.ts` **stays in core** and needs no change in this task. Its own header says what it is: the pregame free-form kit builder's data source (`listSpellCatalog`, `getSpellDisplay`, the `mode: 'custom'` branch of `getChampionPresetFromLoadout`), plus an audit that every export in the `AllSpells` barrel is reachable from `SpellGroups` and present in `listSpellCatalog`. That audit is over *whatever content is installed*, and it stays meaningful when the installed content is the reference pack.

It needs a change in Task 10, and this is where that is written down so nobody has to rediscover it: once the riot pack leaves, `tests/game/spell/registry.ts` composes core's own `coreSpells` barrel with the reference pack's four spell factories, imported directly from `../../../packs/reference/spells/Vera_Q` and its three siblings. `packs/reference/` has no barrel of its own (`pack.ts` imports the four by relative path) and never leaves the repository, so a direct relative import there is legitimate rather than the coupling this programme is removing.

`preset.catalog.test.ts` also carries a `vi.mock('.../AssetManager')` of its own. It is a **core** test in core's own tree, so the ban Task 5 introduces does not reach it and it may stay — but check whether it is still load-bearing (Measured fact 5 says the pack's 48 were not) and delete it if it is not.

- [ ] **Step 7: Revisit the boundary tsconfig**

`tsconfig.strict-core-boundary.json` names `tests/game/spell/registry.ts` in its `include`. Run `npm run typecheck:pack-boundary` and confirm it still passes. If Step 6 moved `preset.catalog.test.ts`, check whether that config or `tsconfig.strict-core.json` named it too.

- [ ] **Step 8: Full suite, then commit**

```bash
npx vitest run 2>&1 | grep -E "^ Test Files|^      Tests"
npm run typecheck:core 2>&1 | tail -3
npm run typecheck:pack-boundary 2>&1 | tail -3
```

```bash
git add src/testing tests/testing/spellRegistry.test.ts tests/game/spell/registry.ts \
        tests/game/preset.catalog.test.ts tsconfig.strict-core-boundary.json
git commit -m "feat(testing): the spell registry takes the pack as a parameter"
```

---

### Task 3: one setup, one preset, two consumers

**Files:**
- Create: `src/testing/setup.ts`, `src/testing/vitest.mjs`
- Modify: `tests/setup.ts`, `src/testing/index.ts`, `vitest.config.ts`, `package.json`, `tests/content/publicSurface.test.ts`, `tests/game/lanesFixture.ts`
- Test: `tests/testing/setup.test.ts` (create)

**Interfaces:**
- Produces, from `@moba2d/core/testing`:
  - `function installEngineGlobalsForTests(): void` — patches `Math.hypot` with `fastHypot` and assigns the p5 sketch baseline (`deltaTime`, `lerp`, `constrain`, `random`, `floor`, `createVector`) onto `globalThis`. Idempotent.
  - `function installPackForTests(pack: InstalledPackForTests): Promise<void>` — registers `pack.assetManifest` under `pack.id` via `AssetManager.registerPackAssets`, then resolves `pack.data.maps?.[0]?.geometry()` and installs its `lanes` as the active lane set. Returns without effect when the pack has no maps.
  - `interface InstalledPackForTests { id: string; assetManifest: PackAssetManifest; data: ContentPackData }`
- Produces, from `@moba2d/core/testing/vitest` (new subpath, and a **plain `.mjs` file**):
  - `moba2dPackTestConfig({ setupFiles } = {})` → `{ resolve: { alias: { '@': <core>/src } }, test: { environment: 'node', clearMocks: true, setupFiles } }` — the Vitest config fragment a pack spreads into its own `defineConfig`.

- [ ] **Step 1: Write `src/testing/setup.ts`**

Move the four installations out of `tests/setup.ts`. Two of them are already pack-agnostic and move verbatim (`Math.hypot`, the p5 globals). The other two currently read `src/generated/installedPacks.ts` — a generated file that exists in core's checkout and says nothing true in a separated pack's checkout — and become parameters.

The lane half absorbs `tests/game/lanesFixture.ts`'s `loadPackLanesForTests`, whose whole body is "read `installedPacks[0]`, await its first map's geometry, keep the lanes". Keep `installSummonersRiftLanesForTests()` where it is: two core AI tests call it in an `afterEach` and its doc comment explains why a bare `resetLanesForTests()` is not enough there. Have it read the lanes this module cached, so there is still one cache.

Carry the *reasons* across, not just the code. `tests/setup.ts:9-40` and `:44-68` are two of the best doc comments in this repository and they explain failures that cost real time — a spell constructor throwing `Unknown asset key` on a field initializer, and `MinionSpawner.test.ts`'s `WAVE_SIZE` being computed at module scope where no `beforeEach` can reach it. Move those comments with the code they explain.

- [ ] **Step 2: Rewrite `tests/setup.ts` as a caller**

```ts
import { installEngineGlobalsForTests, installPackForTests } from '../src/testing';
import { installedPacks } from '../src/generated/installedPacks';
import { installSummonersRiftLanesForTests } from './game/lanesFixture';

installEngineGlobalsForTests();

for (const pack of installedPacks) await installPackForTests(pack);

installSummonersRiftLanesForTests();
```

Keep a header saying that core's suite and every pack's suite now run the same four installations from one implementation, and that reading `installedPacks` — the generated, conditional barrel — is what makes `npm run verify:without-packs` able to start at all.

- [ ] **Step 3: Write `src/testing/vitest.mjs`**

**It is `.mjs` and not TypeScript, and that is measured rather than stylistic.** A pack's `vitest.config.ts` importing a `.ts` module out of `node_modules` dies on `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`: Vite's config loader externalises bare specifiers and hands them to Node, which refuses to strip types under `node_modules`. The identical probe against an `.mjs` target passes. Write the file in plain JavaScript, and say so in its header so nobody helpfully converts it back.

```js
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The Vitest configuration a separated pack needs, so a pack author does not
 * copy core's `vitest.config.ts` and then drift from it.
 *
 * The alias is the load-bearing part and it is not a preference. Core ships
 * unbundled `.ts`, and its own internals import through `@/*`; without this
 * mapping a pack's first test dies on
 * `Failed to load url @/managers/AssetManager … in
 * node_modules/@moba2d/core/src/content/ContentApi.ts`, which names a file
 * the pack author has never opened. Measured 2026-08-23 against a real
 * tarball install.
 *
 * It resolves from this file's own location rather than from
 * `require.resolve('@moba2d/core/package.json')`, which throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` unless the consumer is on a version of core
 * that exports it — and this must work on the version that does not.
 *
 * `server.deps.inline` is deliberately absent: measured unnecessary on
 * Vitest 1.6 with a tarball install. If a pack ever fails to load a core
 * module out of `node_modules`, add `server: { deps: { inline: [/@moba2d\/core/] } }`
 * and say so, rather than adding it here on suspicion.
 */
const coreSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function moba2dPackTestConfig({ setupFiles = [] } = {}) {
  return {
    resolve: { alias: { '@': coreSrc } },
    test: { environment: 'node', clearMocks: true, setupFiles },
  };
}
```

Note `coreSrc` is `src/` — this file lives at `src/testing/vitest.mjs`, so one `..` reaches `src/`. Verify it by printing the resolved path once during Step 6 rather than reasoning about it.

This exact body was probed against a real tarball install and a real `vitest.config.ts` that spreads it: **1 passed (1)**. Keep the shape.

- [ ] **Step 4: Core's own config uses the same preset**

Rewrite `vitest.config.ts` to spread `moba2dPackTestConfig()` and then add only what core needs on top: the `vue()` plugin, the `exclude` list with `**/.claude/**` and `packDependent`, and `setupFiles: ['tests/setup.ts']`. This is the whole point of the task — one implementation, two consumers, so the preset cannot silently stop matching what core actually runs with.

Keep every existing comment in that file. The `vue()` plugin comment in particular explains a real bug and must not be lost.

- [ ] **Step 5: Publish the subpath**

`package.json` `exports` gains **two**: `"./testing/vitest": "./src/testing/vitest.mjs"` and `"./testing/setup": "./src/testing/setup.ts"` — twelve entries.

`./testing/setup` exists because of a failure measured inside this very task, and it is the task's own principle rather than a convenience. `src/testing/index.ts`'s `export *` evaluates **every** module it re-exports, not merely the bindings an importer destructures — so importing the two setup functions from the barrel also loads `spellRegistry.ts` and `api.ts`, which value-import `ContentApi`, which value-imports `Champion`, `packAsset` and the real `AssetManager`. In a Vitest `setupFiles` entry that eager, real load happens **before** any test file's own `vi.mock()` is registered, and thirteen of core's own tests went red on exactly that: a mocked `AssetManager.get` was bypassed and the real one threw `Unknown asset key`.

Core's own `tests/setup.ts` therefore imports `../src/testing/setup` directly. **A pack must be able to import the same narrow module** — otherwise core and every pack run different shapes of the same file, which is the drift this task exists to prevent, and the documented path for packs would be the one that carries the landmine. Update `tests/content/publicSurface.test.ts` to twelve and extend its comment, saying what each new subpath is for — including the eager-load reason above, which is the kind of thing that reads as redundant until someone consolidates the two.

**Do not re-export `vitest.ts` from `src/testing/index.ts`.** It imports `node:url` and `node:path`, and the barrel is loaded by every test file in every pack; a config helper has no business on that path. It is a separate subpath because it is loaded once, by a config file, in a different phase than the tests it configures.

- [ ] **Step 6: Write the setup test**

`tests/testing/setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { installEngineGlobalsForTests } from '../../src/testing';
import { moba2dPackTestConfig } from '../../src/testing/vitest.mjs';

describe('installEngineGlobalsForTests', () => {
  it('is idempotent', () => {
    installEngineGlobalsForTests();
    const first = globalThis.lerp;
    installEngineGlobalsForTests();
    expect(globalThis.lerp).toBe(first);
  });
});

describe('moba2dPackTestConfig', () => {
  it('points @ at core\'s own src, which is where ContentApi.ts lives', () => {
    const alias = moba2dPackTestConfig().resolve.alias['@'];
    expect(existsSync(join(alias, 'content', 'ContentApi.ts'))).toBe(true);
  });
});
```

The second assertion is written to check the *property* the alias must have — that the directory it names actually contains the file whose `@/` imports need resolving — rather than comparing the path to a string this test computed the same way the code did. A transform asked to verify itself agrees with itself however wrong it is.

- [ ] **Step 7: Prove it fails**

Change the `..` in `src/testing/vitest.mjs` to `../..`, run the test, confirm it fails with the wrong directory, revert. Quote the message.

- [ ] **Step 8: Full suite and commit**

```bash
npx vitest run 2>&1 | grep -E "^ Test Files|^      Tests"
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL" | tail -20
```

`verify` must stay green end to end — this task rewrote the config every suite runs under, so a partial run proves nothing.

```bash
git add src/testing tests/setup.ts tests/game/lanesFixture.ts vitest.config.ts \
        tests/testing/setup.test.ts tests/content/publicSurface.test.ts package.json
git commit -m "feat(testing): one setup and one vitest preset, shared by core and every pack"
```

---

### Task 4: the observer's vocabulary — the fifteen gaps, admitted by role

**Files:**
- Create: `src/testing/engine.ts`, `tests/testing/testingSurface.test.ts`
- Modify: `src/testing/index.ts`, `src/content/types.ts`
- Check, expect no change: `tests/content/contentApi.test.ts` — measured during Task 4 to reference `content/types` nowhere at all, so adding two type re-exports there touches nothing it pins
- Test: `tests/testing/testingSurface.test.ts`

**Interfaces:**
- Consumes: `src/testing/index.ts` from Tasks 1-3.
- Produces: the table below, and nothing beyond it.

**The table. This is the whole task's scope — do not add a fourteenth row.** Every entry answers "what does an observer need this for"; that sentence is the admission criterion the spec sets (§3.4), and the answer goes in the doc comment beside the export.

| Export from `@moba2d/core/testing` | Source | What an observer needs it for |
|---|---|---|
| `EventManager` | `src/managers/EventManager` | Seeding a hand-built game context's event bus. Both fixture modules already construct one internally. |
| `Minion` | `src/game/gameObject/attackableUnits/Minion` | Putting a real wave on the board — a spell's behaviour against minions is a different case from against champions. |
| `Stats`, `MAX_ATTACK_SPEED` | `src/game/gameObject/Stats` | Building a synthetic stat block, and checking a pack's numbers against core's own ceiling. |
| `TeamId` | `src/game/enums/TeamId` | Standing two units on opposite sides. A spell never picks a team; an observer always does. |
| `LANES`, `getLaneWaypoints`, `Lane`, `type LaneWaypoint` | `src/game/lanes` | Reading where a map's lanes actually go, to assert a map's geometry. `Lane` is a runtime value (`export const Lane = {...}`), not a type — an earlier draft of this row had it as `type Lane`, corrected against the source during Task 4. |
| `FogOfWar` | `src/game/gameObject/map/FogOfWar` | Asking what a unit can see, directly, without painting a frame. |
| `spellGroups` | `src/game/preset` | Walking a champion's kit as the loadout screen groups it. |
| `BasicAttack` | `src/game/gameObject/coreSpells/BasicAttack` | Putting a real auto-attack in a slot, so a key-press-to-swing sequence is the real one. |
| `SpellInputController` | `src/game/spell/input/SpellInputController` | Driving the same input pipeline the player drives, rather than calling `press()` directly. |
| `HotKeys`, `SpellHotKeys` | `src/game/constants` | Naming the key to press, for the same reason. |
| `MELEE_RANGE_THRESHOLD`, `MELEE_WINDUP_MS`, `BasicAttackSwing` | `src/game/combat/BasicAttack` | Checking a pack's attack-profile table against the mechanism constants those numbers have to agree with. |
| `PackRegistry` | `src/content/PackRegistry` | Installing a pack and reading the errors it refuses on. The installer sits one level above what a pack is handed, which is exactly the observer's altitude. |
| `validatePack` | `src/content/validate` | The same, for shape validation without a full install. |

**And two types, which go to `content/types` and not to `testing`**, because they are contract vocabulary rather than observation tools (spec §3.5):

- `MatchRules` — re-export from `src/game/config/PregameConfig` in `src/content/types.ts`.
- `GameObject` (the class type, `export type { default as GameObject }`) — `src/content/types.ts` already re-exports `GameObjectRuntimeContext` off that module and not the base type itself.

- [ ] **Step 1: Write the surface test first, and watch it fail**

`tests/testing/testingSurface.test.ts` pins the exact named exports of both testing subpaths, the same way `publicSurface.test.ts` pins `exports`:

```ts
import { describe, expect, it } from 'vitest';
import * as testing from '../../src/testing';
import * as spellTesting from '../../src/testing/spellWorld';

/**
 * `@moba2d/core/testing` is a designed entry point, not a hole in the wall.
 * If it becomes the place core internals leak out of, then changing
 * `AttackableUnit` is a breaking change for every pack again — through the
 * back door, with none of the review that closing the front door bought.
 * Widening this list is allowed and is meant to be a visible act: add the
 * name here, in the same commit, with a sentence saying what an observer
 * needs it for.
 */
describe('@moba2d/core/testing', () => {
  it('exports exactly this list', () => {
    expect(Object.keys(testing).sort()).toEqual([
      'BasicAttack', 'BasicAttackSwing', 'EventManager', 'FogOfWar', 'HotKeys',
      'LANES', 'MAX_ATTACK_SPEED', 'MELEE_RANGE_THRESHOLD', 'MELEE_WINDUP_MS',
      'Minion', 'PackRegistry', 'SpellHotKeys', 'SpellInputController',
      'Stats', 'TEST_AVATAR_KEY', 'TeamId', 'TestVector', 'buildTestApi',
      'createGame', 'getLaneWaypoints', 'indexObjects',
      'installEngineGlobalsForTests', 'installPackForTests',
      'loadSpellsForTests', 'resolveSpellBarrel', 'spellGroups',
      'stubGameGlobals', 'validatePack', 'withWalls',
    ].sort());
  });
});
```

That array is this plan's best reading of what Tasks 1-3 plus this table produce. **It is not authoritative** — run the test, read what the module actually exports, and correct the array to match reality if the difference is a name this plan got wrong. Correct the *code* instead if the difference is a name that should not be there. Say which you did.

Add the same shape for `spellWorld`, listing its own exports.

- [ ] **Step 2: Run it**

`npx vitest run tests/testing/testingSurface.test.ts` — expect a failure listing the missing thirteen. Quote it.

- [ ] **Step 3: Write `src/testing/engine.ts`**

One file, thirteen re-exports, each with the one-sentence justification from the table above it as a doc comment. Re-export from `src/testing/index.ts`.

Do not re-export anything by wildcard. `export * from '../game/constants'` would publish every constant in that file, and the next person to add one to it would widen core's public surface without touching a public file.

- [ ] **Step 4: Add the two types**

`src/content/types.ts` gains `export type { MatchRules } from '../game/config/PregameConfig';` and `export type { default as GameObject } from '../game/gameObject/GameObject';`, each beside the existing re-exports in the same style.

`tests/content/contentApi.test.ts` pins `ContentApi`'s own shape and, measured during Task 4, references `content/types` nowhere — so it needs no change. Look before concluding that, but expect a no-op. (`publicSurface.test.ts` pins `package.json`, not module shape; it needs no change here either.)

- [ ] **Step 5: Green, then commit**

```bash
npx vitest run tests/testing tests/content 2>&1 | grep -E "^ Test Files|^      Tests"
npm run typecheck:core 2>&1 | tail -3
```

```bash
git add src/testing src/content/types.ts tests/testing/testingSurface.test.ts tests/content/contentApi.test.ts
git commit -m "feat(testing): admit the observer vocabulary the pack's tests actually need"
```

---

### Task 5: rewrite the 69 pack test files

**Files:**
- Modify: all 69 files under `tests/packs/riot/`
- Test: the files themselves, plus `tests/packs/riot/noCoreReach.test.ts` (create)

**Interfaces:**
- Consumes: everything Tasks 1-4 published.
- Produces: 69 files whose only non-relative imports are `vitest`, `node:*`, `@moba2d/core/content/types`, `@moba2d/core/testing`, `@moba2d/core/testing/spell` — and whose relative imports all resolve inside `packs/riot/`.

**The invariant:** `npx vitest run tests/packs/riot` reported **69 files / 566 tests** before this task and must report 69 / 566 after it. Not "about 566". If a number changes, stop and find out why before continuing — that number is the only evidence that no test quietly stopped running.

- [ ] **Step 1: Delete the 48 asset mocks, in one pass, and measure**

Measured fact 5 says the mock is dead weight. Prove it at population scale, not on one file:

```bash
grep -rln "vi.mock('.*src/managers/AssetManager'" tests/packs/riot --include="*.ts" | wc -l   # expect 48
```

Delete each `vi.mock('…/src/managers/AssetManager', …)` call and only that call. Then:

```bash
npx vitest run tests/packs/riot 2>&1 | grep -E "^ Test Files|^      Tests|FAIL"
```

Expect 69 / 566. **Any file that now fails is a real finding, not an obstacle** — it means that file depended on the asset lookup returning `undefined` rather than a real handle. Report each one by name with its failure, and fix it by making the test say what it means (assert on the key, not on the handle), never by putting the mock back.

Leave the `vi` import in place only where the file still uses `vi` for something else; delete it where it does not, or `noUnusedLocals` will fail the pack's own strict typecheck later.

- [ ] **Step 2: Replace the one `CastTelegraph` mock**

`tests/packs/riot/spells/Janna_R.test.ts:11` mocks `src/game/vfx/CastTelegraph` to intercept what `packs/riot/spells/Janna_R.ts` constructs internally. Rewrite it with `buildTestApi({ vfx: { CastTelegraph: SpyTelegraph } })` from Task 2 and build the spell from that api. Run the file alone and confirm the same assertions still hold; if the spy no longer sees the construction, that means the spell reaches for the class some other way — find out how and say so, rather than reinstating the mock.

- [ ] **Step 3: Repoint the fixture imports**

`tests/game/spell/fixtures` → `@moba2d/core/testing/spell`; `tests/game/fixtures` → `@moba2d/core/testing`; `tests/game/spell/registry` → `@moba2d/core/testing` with the pack's own barrel passed in (`loadSpellsForTests(AllSpellFactories)` where `AllSpellFactories` is imported from `../../spells/index` relative to the test).

A codemod is appropriate here — 58 files, three mechanical substitutions. Write it under `scripts/migrations/2026-08-batch6-pack-test-imports/`, the way batch 4 task 3 did, and keep it: the next pack to be extracted will want it.

- [ ] **Step 4: Repoint the 34 reachable value imports onto `api`**

For each of the 34 REACHABLE specifiers in `docs/superpowers/surveys/2026-08-23-pack-test-api-mapping.md`'s table, delete the relative import and read the name off the file's existing `__api`. The survey's table gives the exact access path for every one (`api.buffs.Slow`, `api.units.AttackableUnit`, `api.utils.Quadtree.Rectangle`, `api.combat.ExecuteTargeting.lethalTargets`, …). Do not re-derive them.

Three of them are used type-only in some files (`AttackableUnit`, `Spell`, `Rectangle`): those become `InstanceType<typeof api.units.AttackableUnit>` and friends, per the same table.

The 5 files with no `__api` in scope get `const __api = buildTestApi();` — but note `buildContentApi` is banned from pack *source* by the `pack-core-boundary` seam, and Task 6 extends that seam over the test tree. Use `buildTestApi()` from `@moba2d/core/testing`, which is published for exactly this.

- [ ] **Step 5: Repoint the type-only imports**

`src/game/spell/runtime/types`' `CastContext` → `@moba2d/core/content/types`. `src/content/ContentPack`'s `MapGeometry`/`StructureSlot`/`ContentPack` → the same. `MatchRules` and `GameObject` → the same, now that Task 4 put them there.

- [ ] **Step 6: Repoint the thirteen gaps**

Every remaining `../../../../src/...` import is one of Task 4's thirteen. They all come from `@moba2d/core/testing`.

- [ ] **Step 7: Write the scan that closes the class**

`tests/packs/riot/noCoreReach.test.ts` — a source scan over `tests/packs/riot/**/*.ts` using `tests/support/importScan.ts`:

```
for every .ts file under tests/packs/riot:
  for every import specifier:
    fail if it starts with '@/' or 'src/'
    fail if it is a relative path resolving outside packs/riot/ and outside tests/packs/riot/
    fail if it starts with '@moba2d/core' and is not one of:
        @moba2d/core/content/types
        @moba2d/core/testing
        @moba2d/core/testing/spell
    fail if the file contains a vi.mock() whose argument resolves into core
```

Population guard: assert the walk found 69 files (70 once this file counts itself — state which and why in the assertion message).

The `vi.mock` half is the one that matters most and is invisible to an import scan, which is exactly how the 48 stayed unnoticed: `scanImports` cannot see them. Match `vi.mock(` calls textually, after `stripComments`.

- [ ] **Step 8: Prove the scan fails**

Add `import Slow from '../../../../src/game/gameObject/buffs/Slow';` to one pack test, run the scan, confirm it names the file and the specifier, revert. Then do the same with a `vi.mock('../../../../src/managers/AssetManager', () => ({}))` line. Quote both messages.

- [ ] **Step 9: The whole gate**

```bash
npx vitest run tests/packs/riot 2>&1 | grep -E "^ Test Files|^      Tests"     # 69 files (70 with the scan) / 566+
npm run verify:all 2>&1 | grep -E "Tests |Test Files |error|FAIL" | tail -20
```

- [ ] **Step 10: Commit**

```bash
git add tests/packs/riot scripts/migrations/2026-08-batch6-pack-test-imports
git commit -m "refactor(tests): the pack's tests speak only published core surfaces"
```

---

### Task 6: the boundary rule covers the test tree, and the tests move into the pack

**Files:**
- Modify: `src/seams/packCoreBoundary.ts`, `packs/riot/package.json`, `packs/reference/package.json`, `package.json`, `vitest.config.ts`, `scripts/pack-dependent-tests.mjs`, `tests/content/packBoundary.test.ts`
- Create: `packs/riot/vitest.config.ts`, `packs/riot/vitest.setup.ts`
- Move: `tests/packs/riot/` → `packs/riot/tests/`

**Interfaces:**
- Consumes: Task 5's rewritten tests and Task 3's `moba2dPackTestConfig`.
- Produces: `npm test --workspace=@moba2d/content-riot` as the pack's own gate, wired into `verify:all`.

- [ ] **Step 1: Teach the boundary seam about test vocabulary**

`src/seams/packCoreBoundary.ts`'s `ALLOWED_TYPE_ONLY` is three specifiers, all `import type`. A test file legitimately imports **values** from `@moba2d/core/testing` — so the rule needs a second, value-legal set rather than a second mode:

```ts
/**
 * The three a pack's *source* may name, and only as `import type`. A spell is
 * handed its api; it never imports one.
 */
const ALLOWED_TYPE_ONLY = new Set([...]);

/**
 * The two a pack's *tests* may name, as values. An observer builds a world
 * and reads it, which a type cannot do. One rule over two trees, rather than
 * two rules — a file is judged by which set its specifier is in, not by where
 * the file happens to sit, so there is no mode to get wrong and no directory
 * name to keep in sync.
 */
const ALLOWED_VALUE = new Set([
  `${CORE_PACKAGE}/testing`,
  `${CORE_PACKAGE}/testing/spell`,
  `${CORE_PACKAGE}/testing/vitest`,
]);
```

The `isCorePackage && kind !== 'type'` branch becomes: a value import is a violation *unless* the specifier is in `ALLOWED_VALUE`. Everything else — the `@/` ban, the bare-`src/` ban, the relative-escape ban — applies unchanged to both trees, which is the property that makes this one rule.

- [ ] **Step 2: Prove the extended seam fails on the right things**

Four probes, each added then reverted, each message quoted in your report:

1. `@/game/gameObject/buffs/Slow` in a pack test → refused as an alias.
2. `@moba2d/core/content/ContentApi` as a **value** import in a pack test → refused (`buildContentApi` is core's alone; `buildTestApi` is the observer's).
3. `@moba2d/core/testing` in a pack **spell** file → this is the interesting one. Under the design above it is *allowed*, because the rule is by specifier and not by tree. Decide whether that is acceptable and say so: a spell importing the test harness would be caught by the pack's own build failing (`vitest` is not a runtime dependency), so the seam not catching it costs nothing. If you disagree, the alternative is a per-scan option and a second `check-seams` invocation, which is the mode this step is written to avoid — take it only with a stated reason.
4. `../../../src/game/Game` (a relative escape) in a pack test → refused.

- [ ] **Step 3: Move the tests**

```bash
git mv tests/packs/riot packs/riot/tests
```

Task 5's `noCoreReach.test.ts` moves with them and **its own path rules move with it**: it currently says "resolving outside `packs/riot/` and outside `tests/packs/riot/`", and the second half has no meaning after this step. Rewrite it to "resolving outside the pack root" and re-run it — a scan whose escape rule still names a directory that no longer exists passes for the wrong reason.

Then fix the relative depth: files were four levels below `tests/packs/riot/spells/`, they are now two below `packs/riot/tests/spells/`. The pack-internal imports (`../../../../packs/riot/spells/X` → `../../spells/X`) are the bulk of it — 152 specifiers per the authoring survey. Extend Task 5's codemod rather than hand-editing.

- [ ] **Step 4: Give the pack its own runner**

`packs/riot/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { moba2dPackTestConfig } from '@moba2d/core/testing/vitest';

const preset = moba2dPackTestConfig({ setupFiles: ['./vitest.setup.ts'] });

export default defineConfig({
  resolve: preset.resolve,
  test: { ...preset.test, include: ['tests/**/*.test.ts'] },
});
```

`packs/riot/vitest.setup.ts` — the names below are the real ones, read off `packs/riot/pack.ts:1` (`export { data, BUNDLED_PACK_ID } from './data'`) and `packs/riot/generated/assetManifest.ts:383` (`export const assetManifest`). Note the import is `@moba2d/core/testing/setup`, **not** the barrel: Task 3 measured that a setup file importing the barrel eagerly loads `ContentApi` and everything under it before any test file's mocks register, and this is the same narrow module core's own `tests/setup.ts` uses:

```ts
import { installEngineGlobalsForTests, installPackForTests } from '@moba2d/core/testing/setup';
import { data, BUNDLED_PACK_ID } from './pack';
import { assetManifest } from './generated/assetManifest';

installEngineGlobalsForTests();
await installPackForTests({ id: BUNDLED_PACK_ID, assetManifest, data });
```

`BUNDLED_PACK_ID` rather than the literal `'riot'`: the pack states its own id once, in its own data, and its test setup reads it from there — the same rule this task applies to core.

`packs/riot/package.json` gains `"test": "vitest run"` and `vitest` in `devDependencies` (`^1.6.1`, matching core's).

- [ ] **Step 5: Point the seam at the new tree**

`packs/riot/package.json`'s `check-seams` becomes `moba2d-check-seams ./spells && moba2d-check-seams ./tests`. Keep `check-seams:monsters` as it is.

- [ ] **Step 6: Wire `verify:all`, and stop core collecting the pack's tests**

Root `verify:all` gains `npm run test --workspace=@moba2d/content-riot`. Core's `vitest.config.ts` gains `'packs/*/tests/**'` in `exclude` — without it core's own run collects them twice, under a config whose setup registers packs differently.

`scripts/pack-dependent-tests.mjs` exists to keep `verify:without-packs` able to start when `tests/packs/riot/**` is unresolvable. With the tests inside the pack directory, most of its population goes away. Read its header before touching it, re-run `npm run verify:without-packs`, and report what its derived list contains now — do not delete it on the assumption that it is empty.

`tests/content/packBoundary.test.ts` asserts every pack declares a `check-seams` script naming the CLI. Extend it to also assert every pack declaring tests declares a `test` script, and that `verify:all` runs each one — same shape as its existing three checks.

- [ ] **Step 6b: Pin what each subpath actually publishes**

Add to `tests/content/publicSurface.test.ts` — or a sibling beside it, whichever reads better — an assertion over the **bindings** each `exports` subpath makes reachable, not merely the list of subpaths.

This is here because the gap has now cost twice. `package.json` publishes a module's entire export list, and `publicSurface.test.ts` pins the subpath list and each target's existence, never what is behind them. Task 3 published `./testing/setup` and silently made a checkout-only lane cache importable by any pack; Task 5 added `stripComments` to `src/seams/index.ts`, widening `./seams` with nothing to notice. Both were reasonable changes. Neither was a *deliberate act* in the sense the constraint means, because nothing made them visible.

Six subpaths are unpinned today: `./seams`, `./content/ContentApi`, `./content/ContentPack`, `./content/types`, `./testing/setup`, `./testing/vitest`. (`./testing` and `./testing/spell` already have `tests/testing/testingSurface.test.ts`; `./tsconfig.base.json`, `./types/*` and `./package.json` are data files with no bindings.) Import each as a namespace, sort `Object.keys`, and compare against a written list — the same shape `testingSurface.test.ts` uses, and for the same reason.

Prove it fails: add a throwaway export to `src/seams/index.ts`, watch the pin name it, revert. Quote the message.

Type-only exports do not appear in `Object.keys`, so this pins runtime bindings only. Say that in the doc comment rather than leaving the next reader to discover it — it is the limitation that decides what the test can and cannot promise.

- [ ] **Step 7: Both suites, then commit**

```bash
npm test --workspace=@moba2d/content-riot 2>&1 | grep -E "^ Test Files|^      Tests"   # 69-70 files / 566+
npx vitest run 2>&1 | grep -E "^ Test Files|^      Tests"                              # core's own, 69 fewer files
npm run verify:all 2>&1 | grep -E "Tests |Test Files |error|FAIL" | tail -20
```

Record all three totals. Core's file count dropping by exactly the number moved is the check that nothing was collected twice.

```bash
git add packs/riot src/seams/packCoreBoundary.ts package.json vitest.config.ts \
        scripts/pack-dependent-tests.mjs tests/content/packBoundary.test.ts \
        packs/reference/package.json
git commit -m "refactor(packs): the riot pack owns and runs its own tests"
```

---

### Task 7: the hermetic standalone drill

**Files:**
- Create: `scripts/verify-pack-standalone.mjs`
- Modify: `package.json` (one script)
- Test: the drill is the test.

**Interfaces:**
- Consumes: Task 6's pack-owned test tree.
- Produces: `npm run verify:pack-standalone` — the acceptance criterion of spec §7, runnable today, before any repository exists.

**Why this exists and what it is standing in for.** Spec §7's criterion is a checkout of the pack repo, outside this tree, with core installed as a real dependency and no symlink home. The private remote does not exist yet, so this drill builds the same situation out of a tarball in a temp directory. That substitution is legitimate: `npm pack` and a git dependency select files by the same `files` rules, and the failure mode being guarded against is a specifier that only resolves because the file physically sits in core's checkout.

**The trap this is written against.** Batch 5 shipped a test that claimed to prove the pack worked as a sibling repository, and it symlinked `node_modules/@moba2d/core` back into the monorepo — so `realpath` found core's devDependencies and the simulation leaked at exactly the point that breaks. *A fixture that can reach the thing it is simulating the absence of proves nothing.* Step 3 is that lesson made executable.

- [ ] **Step 1: Write the drill**

`scripts/verify-pack-standalone.mjs`, taking a pack directory as its argument (default `packs/riot`):

1. `mkdtemp` a working directory under the OS temp dir. Everything below happens inside it; the script never writes to or deletes anything in the repository.
2. `npm pack --pack-destination <tmp>` on core. Assert the tarball exists and record its file count.
3. Copy the pack directory to `<tmp>/pack`, excluding `node_modules`.
4. Rewrite `<tmp>/pack/package.json`: `devDependencies["@moba2d/core"]` becomes the absolute tarball path (`file:<tmp>/moba2d-core-1.0.0.tgz`), and add `vitest`, `typescript`, `vite`, `@types/p5` at core's own versions — read them out of core's `package.json` rather than hardcoding, so they cannot drift.
5. `npm install --no-audit --no-fund` in `<tmp>/pack`.
6. Run, in order, and collect each exit code: `npm run check-seams`, `npm run check-seams:monsters`, `npm run typecheck`, `npm run assets:check`, `npm run catalog:check`, `npm test`.
7. Print a numeric summary and exit non-zero if any step failed.

- [ ] **Step 2: Assert the test count, not just the exit code**

Parse `npm test`'s output for Vitest's `Tests  N passed` line and compare N against the number recorded in Task 5. A suite that collects nothing exits 0 in some configurations; a count is what makes "green" mean something. Fail with both numbers in the message.

- [ ] **Step 3: Assert no path escapes the temp directory**

Walk `<tmp>/pack/node_modules` and, for every symlink, resolve it. Fail naming the link if any `realpath` lands outside `<tmp>`. Then assert specifically that `<tmp>/pack/node_modules/@moba2d/core` is a real directory (`lstat().isDirectory()`, not `isSymbolicLink()`).

Write the failure message so it says what the leak means, not just that a check failed — the next person to see it will be looking at a green-looking suite.

- [ ] **Step 4: Prove the drill can fail, three ways**

Each of these is added, run, and reverted; quote each message in your report.

1. **The symlink check.** Replace `<tmp>/pack/node_modules/@moba2d/core` with a symlink to the monorepo before the assertions run — hand-edit the script temporarily — and confirm it fails.
2. **The `files` check.** Temporarily remove `"src"` from core's `files` array, run the drill, confirm the pack's install cannot resolve `@moba2d/core/testing`. This is the check that would have caught batch 5's `npm pack` leak in the other direction.
3. **The count check.** Temporarily point `include` in `packs/riot/vitest.config.ts` at a glob matching nothing, confirm the drill fails on the count rather than passing on the exit code.

- [ ] **Step 4b: what the drill found, and the correction it forced**

The drill's first real run failed on this chain:

```
src/testing/index.ts -> src/testing/spellRegistry.ts -> src/game/spellRegistry.ts
  -> src/content/registry.ts -> src/content/catalog.ts -> src/content/install.ts
  -> src/generated/installedPacks.ts -> import from '@moba2d/content-riot/pack'
```

The first reading of that — recorded here, then disproved — was that `@moba2d/core/testing` is structurally unusable by any separated pack. **That was wrong, and the way it was wrong is worth keeping.** `src/generated/installedPacks.ts` is *generated*: with no optional pack in the tree it regenerates with no pack import at all, which `npm run verify:without-packs` already proves every time it runs — its step 4 runs the whole of `verify`, including `typecheck` over `src/`, with the pack absent and green.

So the leak is an artefact of **packing core while the pack is still installed in core's own tree**. After the departure, core's tarball carries no pack reference and the barrel is clean for the first pack and the second alike.

**The fix belongs to the drill, not to the barrel.** Before `npm pack`, the drill must produce core *as core will ship*: move optional packs aside, regenerate `src/generated/installedPacks.ts`, pack, then restore. `scripts/verify-without-packs.mjs` already does exactly that move-and-restore, safely, and its `restore()`/`cleanup()` pair carries hard-won rules about never deleting what it moved — reuse it rather than writing a second one.

Two things stay, for reasons of their own rather than as parts of the fix:

- **`spellRegistry` leaves the barrel** for its own subpath (`./testing/spells`). Not because it leaks — it does not, post-split — but because a world-building surface should not evaluate core's whole content-install graph in every pack test file. Task 3 measured what eager barrel loading costs when it beat `vi.mock`; this is the same lesson, and the closure shrinks for free.
- **`spellGroups` comes out of the observer vocabulary** — reversed, on evidence, after being left in place once. The first full standalone run showed why, and it is not the reachability question at all: `spellGroups()` reads `contentRegistry()`, which is filled solely from core's own generated `installedPacks.ts` — correctly **empty** for a separated pack. So a pack's standalone test can never see its own champion's kit through that path. It is a promise core cannot keep, which is a worse defect than a heavy import. A pack knows its own kit; its tests should read the pack's own data.

**A pack's tests must derive their own root, never climb to it.** The same run found `ahri-palette.test.ts` and `generate-assets.test.ts` computing a pack root from a fixed `__dirname` climb plus a hardcoded `packs/riot` literal — which resolves only inside this monorepo's layout and breaks identically in a real separated repo. That is precisely the class of defect this whole programme exists to remove, and it survived every gate until a drill ran the tests from somewhere else.

**Do not add the "barrel must not reach `install.ts`" assertion.** It cannot pass while `spellGroups` is in the barrel, and an assertion that cannot pass is either deleted or lies. If the coupling is worth closing, it is worth its own task.

- [ ] **Step 5: Wire it and commit**

`"verify:pack-standalone": "node scripts/verify-pack-standalone.mjs"` in root `package.json`. Do **not** add it to `verify` or `verify:all` — it packs, installs and runs a full suite, which is minutes, and it belongs beside `verify:without-packs` as a drill someone runs deliberately. Say so in its own header.

```bash
git add scripts/verify-pack-standalone.mjs package.json
git commit -m "test(packs): prove the pack green with core as a real dependency, no symlink home"
```

---

### Task 8: the scaffold — `moba2d-pack-new` and `moba2d-pack-add`

**Files:**
- Create: `scripts/pack-new.mjs`, `scripts/pack-add.mjs`, `scripts/templates/pack/**`, `scripts/lib/packRoot.mjs`
- Modify: `package.json` (two bins, one script), `tests/content/publicSurface.test.ts`
- Test: `tests/scripts/packScaffold.test.ts` (create), plus a real scaffold-and-run drill inside `scripts/verify-pack-standalone.mjs`

**Interfaces:**
- Produces:
  - `moba2d-pack-new <directory> [--id <packId>] [--name "<display name>"]` — writes a complete, runnable pack.
  - `moba2d-pack-add <spell|champion|map|monster> <Name> [--champion X] [--slot Q]` — adds one piece of content **and its test** to the pack the current directory is in.
  - `packRootFrom(cwd)` in `scripts/lib/packRoot.mjs` — walks up to the nearest `package.json` whose `devDependencies` name `@moba2d/core`, throwing a message that says what to do if there is none.

**The acceptance criterion, from spec §4:** a freshly scaffolded pack runs `npm test` and `npm run check-seams` green, and loads into core. "Runnable immediately" is a thing the drill proves, not a thing the README promises.

**Templates are files, not template literals.** `scripts/new-spell.mjs` holds its spell body and its test body as inline template literals (lines 319-451 and 464-563) and references `_EmptyExample.ts` in comments as documentation for a shape nothing reads at runtime. That is why its `TESTS_DIR` has pointed at an abandoned directory since 2026-08-22 without anyone noticing. A template that is a real file under `scripts/templates/pack/` is typechecked, seam-checked and greppable like any other source.

- [ ] **Step 1: Write the template tree**

Under `scripts/templates/pack/`, with `__PACK_ID__`, `__PACK_NAME__`, `__CHAMPION__`, `__SLOT__` as the only substitution tokens:

```
package.json.tmpl        name @moba2d/content-__PACK_ID__, scripts, devDeps on @moba2d/core
tsconfig.json.tmpl       extends @moba2d/core/tsconfig.base.json — copy packs/riot/tsconfig.json's
                         header comment, it explains why extends-by-name is the portable form
vitest.config.ts.tmpl    spreads moba2dPackTestConfig
vitest.setup.ts.tmpl     installEngineGlobalsForTests + installPackForTests
pack.ts.tmpl             ContentPackData + ContentPackFactory, one champion, one map
map.ts.tmpl              cheap summary + dynamic import of geometry
geometry.ts.tmpl         a minimal walled arena with one lane
spells/__CHAMPION___Q.ts.tmpl
tests/__CHAMPION___Q.test.ts.tmpl
README.md.tmpl           what to run next
gitignore.tmpl           node_modules, generated
```

Model `pack.ts.tmpl` on `packs/reference/pack.ts`, which is the leanest working pack in the repository — but **do not copy its warden monster**: `packs/reference/pack.ts` once declared a camp with an asset key nothing held, and `AssetManager.get` throws, so core-alone's default match died on `Unknown asset key`. A scaffold that ships the same shape ships the same crash to every new pack author.

- [ ] **Step 2: Write `scripts/pack-new.mjs`**

Reads the template tree, substitutes, writes. Refuses to write into a non-empty directory. Prints the three commands to run next.

- [ ] **Step 3: Write `scripts/pack-add.mjs` and `scripts/lib/packRoot.mjs`**

`packRootFrom(cwd)` is the "no hardcoded pack name" rule made mechanical, and it is the thing `new-spell.mjs` got wrong. It walks up from `cwd` looking for a `package.json` with `@moba2d/core` in `devDependencies` or `dependencies`; it does not look for a directory called `packs`, and it does not accept core's own root (which has no such dependency on itself).

`pack-add spell` writes the spell file, its test, and registers it in the pack's barrel and champion kit if those exist — the two `registerIn*` functions in `new-spell.mjs` (lines 568-597 and 608-633) are the working prior art for the barrel and kit rewrites; port them, dropping the `docs/spell-names-vi.json` dependency, which is Riot's localisation pipeline and leaves with the pack.

- [ ] **Step 4: Write the unit test**

`tests/scripts/packScaffold.test.ts`:

- `packRootFrom` finds the pack root from a nested directory, and throws a named error at core's own root.
- `moba2d-pack-new` into a temp directory writes every file the template tree declares, with no `__TOKEN__` left anywhere (walk the output and grep for `__`).
- `moba2d-pack-add spell` into that scaffold adds exactly two files and edits the barrel.

The "no `__TOKEN__` survives" assertion is the one that catches a template growing a token the substitution table does not know about — which is the failure mode of every scaffold.

- [ ] **Step 5: Prove it fails**

Add a `__UNKNOWN_TOKEN__` to one template, run the test, confirm it names the file. Revert. Quote the message.

- [ ] **Step 6: Add the scaffold drill to the standalone script**

Extend `scripts/verify-pack-standalone.mjs` with a second phase: scaffold a fresh pack into the temp directory, install core's tarball into it, run `npm test` and `npm run check-seams`. Both green. This is spec §7's second criterion and the only real evidence that writing a new pack is easy.

- [ ] **Step 7: Register the bins**

`package.json` `bin` gains `"moba2d-pack-new": "./scripts/pack-new.mjs"` and `"moba2d-pack-add": "./scripts/pack-add.mjs"` — four bins. Both files need a `#!/usr/bin/env node` shebang and the executable bit (`chmod +x`, and `git update-index --chmod=+x` if git does not pick it up).

Add **three** things to `files`: the two scripts and `scripts/templates`. Without the template directory the bins resolve to nothing the moment core is a real dependency rather than this checkout — the scaffold would work here and fail for every actual pack author, which is the exact shape of failure this whole programme exists to stop. `scripts/lib/packRoot.mjs` too, since `pack-add.mjs` imports it. Prove it by running Task 7's drill, which installs from a tarball: a missing `files` entry shows up there and nowhere else.

Update `tests/content/publicSurface.test.ts`'s bin assertion to all four, and extend its comment.

- [ ] **Step 8: Green, then commit**

```bash
npx vitest run tests/scripts tests/content 2>&1 | grep -E "^ Test Files|^      Tests"
node scripts/verify-pack-standalone.mjs 2>&1 | tail -20
```

```bash
git add scripts/pack-new.mjs scripts/pack-add.mjs scripts/lib/packRoot.mjs \
        scripts/templates scripts/verify-pack-standalone.mjs \
        tests/scripts/packScaffold.test.ts tests/content/publicSurface.test.ts package.json
git commit -m "feat(sdk): scaffold a runnable pack, and add content to the pack you are in"
```

---

### Task 9: the nine scripts that know a pack's name

**Files:**
- Modify: `scripts/check-chunks.mjs`, `scripts/generate-spell-catalog.mjs`, `scripts/verify-without-packs.mjs`
- Create: `packs/riot/catalog.config.mjs`
- Test: `tests/scripts/packAgnostic.test.ts` (create)

**Interfaces:**
- Produces: no script under `scripts/` contains the string `riot` outside a comment or a migration.

**What was measured.** Fourteen files under `scripts/` mention the pack. Most are comments. Three carry it in behaviour, one carries it in a data table, and the rest leave with the pack or are historical:

| File | What to do |
|---|---|
| `scripts/check-chunks.mjs:253-254` | `contentPackInstalled(root, 'riot')` — derive the pack from `installedContentPackages(root)` and check whichever packs are installed, or skip when none are. |
| `scripts/generate-spell-catalog.mjs:182` | `PACK_SPELL_TREES` holds a `riot` tree with `packId: 'riot'`. The tree definition is the pack's own knowledge about its own layout; move it out (below). |
| `scripts/verify-without-packs.mjs:91` | `DEPARTING = ['riot']` — derive from `installedContentPackages(root)`, so the drill moves whatever optional packs exist. `CORE_OWN` already keeps `reference` out. |
| `scripts/installed-packs.mjs`, `scripts/generate-installed-packs.mjs` | Already derived. Comments mention the name; leave them, they are documenting real history. |
| `scripts/wiki/*.mjs` | Riot's own research pipeline. These **leave with the pack** in Task 10; do not generalise them here. |
| `scripts/new-spell.mjs` | Already replaced by `moba2d-pack-add spell` in Task 8, which is what spec §5 means by "it becomes an SDK command". Task 10 deletes it rather than moving it — a second, Riot-flavoured spell generator living in the pack repository is exactly the drift this replaced. Its one genuinely Riot-specific step, the `docs/spell-names-vi.json` lookup, becomes a small pack-side script if the author wants it; note that in the handover. |
| `scripts/migrations/2026-08-batch4-task3-spell-factories/*` | Historical one-shot migrations. Leave untouched. |
| `scripts/pack-dependent-tests.mjs` | Handled in Task 6. |

- [ ] **Step 1: Move the catalogue tree definition into the pack**

Create `packs/riot/catalog.config.mjs` exporting the tree that `PACK_SPELL_TREES.riot` holds today, verbatim. `scripts/generate-spell-catalog.mjs` reads `<root>/catalog.config.mjs` when `--root` names a directory that has one, and errors with a message naming the missing file when `--tree` is passed without one.

Read that script's own header first — batch 5 already made it root-relative, and its comment explains why `--root=.` from inside the pack is the shape that survives the split. This step finishes that move; it does not redo it.

Keep `--tree=<name>` as the argument the pack's `package.json` already passes, so `packs/riot/package.json` needs no change.

- [ ] **Step 2: Derive the two behavioural cases**

`check-chunks.mjs` and `verify-without-packs.mjs`, per the table.

`verify-without-packs.mjs` is the script whose restore-failure branch once printed "left at `<from>`" and then deleted both the moved pack and its safety copy. **Read its `restore()`/`cleanup()` pair before editing anything near them**, and do not widen what `cleanup()` may delete.

- [ ] **Step 3: Write the scan**

`tests/scripts/packAgnostic.test.ts` — walk `scripts/**/*.mjs`, `stripComments`, and fail on a bare `'riot'`/`"riot"` string literal or a `packs/riot` path. Exempt, by explicit path list with a reason beside each: `scripts/wiki/`, `scripts/new-spell.mjs`, `scripts/migrations/`. Population guard: at least 12 files walked.

- [ ] **Step 4: Prove it fails, then green**

Plant `const x = 'riot';` in `scripts/check-chunks.mjs`, confirm the scan names it, revert.

```bash
npm run verify:all 2>&1 | grep -E "Tests |Test Files |error|FAIL" | tail -20
npm run verify:without-packs 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add scripts/check-chunks.mjs scripts/generate-spell-catalog.mjs \
        scripts/verify-without-packs.mjs packs/riot/catalog.config.mjs \
        tests/scripts/packAgnostic.test.ts
git commit -m "refactor(scripts): core's tooling stops naming a pack"
```

---

### Task 10: the departure

**Files:**
- Create (outside this repo): `/Users/hoangtran/Desktop/Github/moba2d-content-riot/` — a new git repository
- Remove from core, in the order below: `packs/riot/`, `docs/abilities/`, `assets/source-manifest.json`, `scripts/wiki/`, `docs/spell-names-vi.json`, `docs/all-champions.jpg`, `docs/Health_bar_guide.webp`
- Delete outright, replaced rather than relocated (Task 9's table says why): `scripts/new-spell.mjs`
- Modify: `package.json`, `vite.config.ts`, `.github/workflows/build.yml`, `tests/support/riotVocabulary.ts` (check, do not assume)

**This task is the one with a stop-and-ask in it.** Creating the new repository and copying content is yours to do. **Pushing it anywhere is not** — the remote is private, does not exist yet, and is the author's to create. Commit locally, print the exact `git remote add` and `git push` commands the author will run, and stop there.

**The order is the safety property.** Content is committed in the destination *before* it is removed from the source, and removal is `git rm`, never `rm -rf`. At every point between the two, the content exists in two places. CLAUDE.md's standing rule for this repository is "never delete `packs/riot/`; move it and restore" — this task is the one time it genuinely leaves, and it leaves by being somewhere else first.

- [ ] **Step 1: Build the destination**

```bash
mkdir -p /Users/hoangtran/Desktop/Github/moba2d-content-riot
cd /Users/hoangtran/Desktop/Github/moba2d-content-riot && git init
```

Copy, preserving structure (`cp -R`, never `mv`):

| From core | To the pack repo |
|---|---|
| `packs/riot/*` (including `tests/`) | repository root |
| `docs/abilities/` | `docs/abilities/` |
| `assets/source-manifest.json` | `assets/source-manifest.json` |
| `scripts/wiki/` | `scripts/wiki/` |
| `docs/spell-names-vi.json` | `docs/spell-names-vi.json` |
| `docs/all-champions.jpg`, `docs/Health_bar_guide.webp` | `docs/` |

- [ ] **Step 2: Verify the copy byte-for-byte before anything is removed**

```bash
diff -r --brief packs/riot /Users/hoangtran/Desktop/Github/moba2d-content-riot \
  --exclude node_modules --exclude .git | head -40
find packs/riot -type f | wc -l
find /Users/hoangtran/Desktop/Github/moba2d-content-riot -type f -not -path '*/.git/*' | wc -l
```

Compare the counts, accounting for the root-level files added in Step 1. Record both numbers. **Do not proceed to Step 5 until this step has produced matching counts** and `diff -r` reports nothing but the deliberate additions.

- [ ] **Step 3: Make the pack repo self-sufficient**

- `package.json`: `"@moba2d/core"` moves from `"*"` to the git dependency form — `"github:HoangTran0410/MOBA2D#content-pack-batch-6"` until core's work lands on a stable branch. The author's decision of 2026-08-23 is that the pack repository is **public to begin with**, so this is a plain public git dependency with no token anywhere; add `vitest`, `typescript`, `vite`, `@types/p5`, and the `wiki:*`/`ability:*`/`names:*`/`spell:new` scripts that came with `scripts/wiki/` and `new-spell.mjs`. Add `"verify": "npm run assets:check && npm run catalog:check && npm run ability:check && npm run typecheck && npm run check-seams && npm run check-seams:monsters && npm test"`.
- `README.md`: what this repository is, that it needs `@moba2d/core`, how to install it, and how to run `verify`.
- `.gitignore`: `node_modules`, `generated` if generated files are not committed — check whether `packs/riot/generated/` is committed in core today and keep the same answer.
- `.github/workflows/`: a workflow running `npm run verify`. Per spec §6, each repository gates its own half: core's CI runs `verify` (core alone), the pack's runs its own. Both repositories are public, so neither workflow needs a secret.

- [ ] **Step 4: Commit in the destination, and print the push commands**

```bash
cd /Users/hoangtran/Desktop/Github/moba2d-content-riot
git add -A && git commit -m "feat: the riot content pack, extracted from moba2d core"
```

`git add -A` is correct **here and only here** — this is a fresh repository with no other agent in it, and the rule against it protects core's shared working tree. Do not use it in core.

Then print, without running:

```
git remote add origin git@github.com:<owner>/moba2d-content-riot.git
git push -u origin main
```

- [ ] **Step 5: Remove from core**

```bash
cd /Users/hoangtran/Desktop/Github/MOBA2D-batch6
git rm -r --quiet packs/riot docs/abilities scripts/wiki
# `new-spell.mjs` is deleted rather than copied — `moba2d-pack-add spell` replaced it in Task 8.
git rm --quiet assets/source-manifest.json scripts/new-spell.mjs \
       docs/spell-names-vi.json docs/all-champions.jpg docs/Health_bar_guide.webp
```

- [ ] **Step 6: Repair what pointed at them**

- Root `package.json`: delete `wiki:sync-index`, `ability:import`, `ability:update`, `ability:check`, `spell:new`, `names:sync`, `names:apply`. Remove `ability:check` from `verify` — the tree it validates has left. Reduce `verify:all` to core plus the reference pack; the riot workspace lines have no workspace to name.
- `vite.config.ts`: the `pregame` chunk carve and any riot-named chunking. Read it before editing; batch 5 shaped this deliberately.
- `.github/workflows/build.yml`: confirm what it actually runs. The batch-5 review found that the line that looks like it runs plain `verify` is a comment and CI already runs `verify:all` — read the file, do not trust either belief.
- `tests/support/riotVocabulary.ts` and the scans that use it **stay**. Their job is to prove core carries no Riot vocabulary, and with the pack gone they have more to say, not less. Confirm they still find their population, and that the population is now zero by measurement rather than by an empty glob.
- `src/generated/installedPacks.ts` regenerates to empty — run `npm run packs:generate` and commit the result.

- [ ] **Step 7: Commit**

```bash
git add -u
git add package.json vite.config.ts .github/workflows/build.yml src/generated/installedPacks.ts
git commit -m "feat(core): the riot pack leaves"
```

`git add -u` stages only tracked files already modified or deleted, which is what Step 5 produced — it is not `git add -A` and does not pick up untracked files.

---

### Task 11: core alone, measured

**Files:**
- Modify: whatever the measurements below say is broken
- Test: the existing gates

**No new code is planned here.** This task is the measurement, and its deliverable is a report with numbers. Anything it has to fix is a defect in Tasks 1-10 that only became visible with the pack absent — name it as such.

- [ ] **Step 1: The gates, in order, each recorded**

```bash
npm install
npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL" | tail -20
npm run build 2>&1 | tail -5
npm run chunks:check 2>&1 | tail -5
npm run e2e:core-alone 2>&1 | tail -20
npm run e2e:chunk-cascade 2>&1 | tail -5
```

Record, against batch 5's measured baseline (`verify:without-packs`: 159 files / 1656 tests, boot 13 checks on `reference:proving-grounds` playing Vera, chunk cascade 0/59):

| Gate | Batch 5 baseline | Now |
|---|---|---|
| `verify` file/test count | 159 / 1656 | |
| `e2e:core-alone` checks | 13 | |
| chunk cascade | 0/59 | |
| `npm pack` file count, and Riot vocabulary in the tarball | 291, none | |

A count that went **up** is as interesting as one that went down: the pack's tests left, so core's own suite should have lost files and kept every test that was ever core's.

- [ ] **Step 2: `verify:without-packs` has no packs to remove**

The drill moves optional packs out of the tree. With none installed it should either become a no-op that says so, or be retired. Decide, say which, and if you retire it move its `restore()`/`cleanup()` safety reasoning into whatever replaces it — that script exists because a careless version of it could destroy 240 spells and 378 images.

- [ ] **Step 3: The standalone drill, against the real sibling**

```bash
node scripts/verify-pack-standalone.mjs /Users/hoangtran/Desktop/Github/moba2d-content-riot
```

This is now the real thing rather than a simulation: a pack repository outside this tree, core installed from a tarball, no symlink home. Record the full numeric summary. **This is spec §7's acceptance criterion** — if it does not pass, the split is not done, whatever else is green.

- [ ] **Step 4: A real browser, once**

```bash
npm run e2e:pwa 2>&1 | tail -20
```

Core alone is a different application: one champion, four abilities, one map, no summoner spells. The PWA precache count changes and the offline launch is the check that no asset the manifest promises has gone missing. Two e2e failures are known and pre-existing (`drive-touch-controls.mjs`, `drive-lux-beam-visibility.mjs`) — the second one names a Riot spell and may simply have left; say which happened.

- [ ] **Step 5: Report, and commit any fixes**

Commit with explicit paths and a message naming what broke and why.

---

### Task 12: documentation, and the handover the author has to act on

**Files:**
- Create: `docs/PACK_AUTHORING.md`
- Modify: `CLAUDE.md`, `docs/ADDING_SPELLS.md`, `docs/VFX_STANDARD.md`, `README.md`
- Create: `docs/superpowers/reports/2026-08-23-pack-sdk-and-repo-split.md`

- [ ] **Step 1: `docs/PACK_AUTHORING.md`**

The transferable ~90% of `ADDING_SPELLS.md`, rewritten for a pack author who has never seen this repository: scaffold, the two doors (`api` for spells, `@moba2d/core/testing` for tests), adding a spell/champion/map/monster, running the gates, and what `pack-core-boundary` refuses and why.

Every worked example uses the scaffold's own champion, not a Riot one. Link `docs/VFX_STANDARD.md` for the art bar rather than restating it.

- [ ] **Step 2: Split the two mixed docs**

`docs/ADDING_SPELLS.md` keeps the engine mechanism and loses section 1 (the Riot Wiki import pipeline) and the ~25 Riot champion names in its examples; those move to the pack repository's own `docs/`. `docs/VFX_STANDARD.md` loses 4 lines of 136. Copy the removed material into the pack repo before deleting it from core, same rule as Task 10.

- [ ] **Step 3: `CLAUDE.md`**

It describes a repository that no longer exists in several places — `packs/riot/` as a directory, `ability:check` in `verify`, `npm run names:sync`, the spell-name rule, `docs/abilities/`. Rewrite those sections for core alone and add a short section naming the pack repository and pointing at `docs/PACK_AUTHORING.md`.

Do not delete the trap list. Every entry in "Traps that have cost real time" was found by measurement and most are engine facts that outlive the pack.

- [ ] **Step 4: Write the handover, and put the open decision in it**

`docs/superpowers/reports/2026-08-23-pack-sdk-and-repo-split.md`, in the shape of batch 5's own handover section. It must carry, plainly:

1. **The deploy question, answered — and the condition under which it reopens.** Spec §6 left this open because it assumed a private pack repository, which core's CI could not fetch without a token. The author decided on 2026-08-23 that the pack repository is **public to begin with** ("để pack trong public repo test trước"), and `HoangTran0410/MOBA2D` is itself already public and already carries every one of these assets — so the split is a rearrangement of what is already published, not new exposure, and the production build keeps its Riot content through an ordinary public git dependency with no secret anywhere.

   **It reopens the day the pack repository goes private.** At that point core's CI stops being able to resolve `github:…/moba2d-content-riot`, and a production build from `main` silently ships core alone — one champion, four abilities, one map — with a green pipeline, because nothing in `verify` knows the pack was supposed to be there. Whoever flips that switch must, in the same change, either give the build a token or add a check that fails when the expected pack is missing from a production build. Write that down here; it is the kind of thing that is obvious for a week.
2. **The push commands from Task 10 Step 4**, ready to run once the private repository exists.
3. **The git history.** Every commit this repository has ever had still carries the Riot assets. Rewriting it (`git filter-repo`) is deferred by the author's decision, and it gets more expensive the longer both repositories move apart. Recorded so nobody rediscovers it as news.
4. **The reference pack is thin.** Core alone is one champion, four abilities, one map, no summoner spells — `D`/`F` fall back to basic attacks. Spec §6 calls the old claim that core is a complete standalone game "hơi quá lời"; expanding the reference pack is its own piece of work.
5. **Every number** Task 11 measured, beside batch 5's baseline.

- [ ] **Step 5: Commit**

```bash
git add docs/PACK_AUTHORING.md docs/ADDING_SPELLS.md docs/VFX_STANDARD.md \
        CLAUDE.md README.md docs/superpowers/reports/2026-08-23-pack-sdk-and-repo-split.md
git commit -m "docs: how to write a pack, and what the split still owes"
```

---

## What this plan does not do

- **It does not merge anything.** The branch stays `content-pack-batch-6`. Merging is gated on the deploy decision in Task 12.
- **It does not push the pack repository anywhere.** The remote is private and the author's to create.
- **It does not rewrite git history.** Deferred by decision; recorded in the handover.
- **It does not expand the reference pack.** Named as a consequence, not fixed here.
- **It does not rename the game.** `moba2d:` prefixes, `window.__moba2d`, the manifest name and the title are untouched, in every task.
