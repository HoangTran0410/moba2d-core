# Survey: mapping `tests/packs/riot/`'s core imports onto `ContentApi`

Measured 2026-08-23, on worktree `MOBA2D-batch5` (`content-pack-batch-5`). Every
number below is reproducible with the commands cited beside it; nothing here
is estimated. No file was changed to produce this survey.

**Scope.** `tests/packs/riot/` = 69 files (67 `.test.ts` + `pack.test.ts` +
`attackProfiles.test.ts` + `generate-assets.test.ts`, with 64 of the 67 spell
tests plus `pack.test.ts` also touching `ContentApi`). Verified:
`find tests/packs/riot -type f | wc -l` -> 69.

A specifier is "core" here if it resolves (relative to the importing file)
outside `tests/packs/riot/` **and** outside `packs/`. Imports that resolve
into `packs/riot/*` (152 distinct specifiers, 163 file-uses — the pack's own
spell/map/data modules, imported by its own tests under test) are excluded:
that is the subject under test, not core vocabulary, and moving with the pack
is not in question.

## Method

A small parser (`node` script, no dependency) walked every `.ts` file under
`tests/packs/riot/`, extracted every `import` statement (741 raw matches),
resolved each relative specifier against the importing file's directory, and
bucketed the result by whether it lands under `src/`, `tests/`, or `packs/`.
Separately, `grep -rn "vi\.mock(" tests/packs/riot --include="*.ts"` found 49
calls that name a core module string but are not ES imports at all — Vitest
module mocks, invisible to any import-statement scan, and not part of the
"55 distinct / 286 file-uses" baseline this task's background quotes (that
figure lines up with this survey's own **static-import-only, `src/`-only**
count: 51 distinct specifiers, 286 file-uses — see the table below; adding
the 3 `tests/`-only core-infra specifiers gets to 54 distinct, still short of
55 by one, which this survey could not pin down further and is not
consequential to the verdicts).

## Step 1 + Step 2 — every core specifier, and its `ContentApi` verdict

56 rows: 51 `src/`-resolving specifiers found by the import scan, 3
`tests/`-resolving specifiers (core's own test infrastructure), and 2
`vi.mock()`-only specifiers the import scan cannot see at all (found by the
separate grep above). `files` counts distinct files in `tests/packs/riot/`
using that specifier; `bindings` lists every named/default/type binding
actually pulled from it, deduplicated across files.

Verdict legend: **REACHABLE** (same binding already obtainable off a built
`ContentApi`, with the exact path given), **TYPE-ONLY** (erased at runtime;
path given is a published type-only subpath, or "none" if none exists),
**TEST-ONLY** (core test infrastructure, not engine vocabulary), **GAP**
(genuine engine vocabulary `ContentApi` does not expose), **MIXED** (some
files need the reachable part, others need the gap part — split noted).

| specifier | files | bindings | verdict | access path / note |
|---|---|---|---|---|
| `src/content/ContentApi` | 64 | `buildContentApi` | REACHABLE | It *is* the thing — `buildContentApi()` is how a test gets `api` at all; every pack-test-relevant file already calls it. |
| `src/game/gameObject/attackableUnits/AttackableUnit` | 37 | `default` (value, 26 files), `type default` (11 files, e.g. `spells/Malzahar.test.ts:1`) | REACHABLE | `api.units.AttackableUnit`. Type-only uses need `InstanceType<typeof api.units.AttackableUnit>` in place of a bare `AttackableUnit` type — no published type name exists otherwise. |
| `src/game/spell/runtime/types` | 28 | `type CastContext` | TYPE-ONLY | `import type { CastContext } from '@moba2d/core/content/types'` — published, re-exported verbatim at `src/content/types.ts:15-32` (`CastContext` itself on line 20). |
| `src/game/gameObject/buffs/Dash` | 18 | `default` | REACHABLE | `api.buffs.Dash`. |
| `src/game/gameObject/attackableUnits/Champion` | 17 | `default`, `DEFAULT_CHAMPION_ATTACK` | REACHABLE | `api.units.Champion`, `api.units.DEFAULT_CHAMPION_ATTACK`. |
| `src/game/gameObject/buffs/Slow` | 12 | `default` | REACHABLE | `api.buffs.Slow`. |
| `src/game/gameObject/buffs/Stun` | 8 | `default` | REACHABLE | `api.buffs.Stun`. |
| `src/game/enums/EventType` | 8 | `default` | REACHABLE | `api.enums.EventType`. |
| `src/game/gameObject/buffs/Shield` | 6 | `default` | REACHABLE | `api.buffs.Shield`. |
| `src/game/enums/StatusFlags` | 6 | `default` | REACHABLE | `api.enums.StatusFlags`. |
| `src/game/gameObject/spellObjects/HomingMissileSpellObject` | 5 | `default` | REACHABLE | `api.HomingMissileSpellObject` (top level). |
| `src/game/gameObject/Stats` | 4 | `MAX_ATTACK_SPEED` (1 file: `attackProfiles.test.ts:6`), `default` = `Stats` class (2 files: `spells/Pantheon_Q.test.ts:6`, `spells/Varus_Q.test.ts:2`), `MAX_UNIT_SIZE` (1 file: `spells/Rammus_Q.test.ts:8`) | MIXED | `MAX_UNIT_SIZE` only: `api.units.MAX_UNIT_SIZE` — REACHABLE. `Stats` (the class, constructed with `new Stats()` to build a synthetic stat block) and `MAX_ATTACK_SPEED` (a core tuning ceiling) are GAP — neither is on `ContentApi`. |
| `src/game/spell/targeting/TargetResolver` | 4 | `TargetResolver`, `default` | REACHABLE | `api.combat.TargetResolver`. |
| `src/game/gameObject/Spell` | 4 | `default` (2 files), `type default` (2 files: `spells/Irelia.test.ts`, `spells/Ezreal.test.ts`) | REACHABLE | `api.Spell` for the value; type-only use needs `InstanceType<typeof api.Spell>`. |
| `src/game/gameObject/buffs/StatAmp` | 4 | `default` | REACHABLE | `api.buffs.StatAmp`. |
| `src/game/gameObject/buffs/Speedup` | 4 | `default` | REACHABLE | `api.buffs.Speedup`. |
| `src/game/gameObject/buffs/Airborne` | 4 | `default` | REACHABLE | `api.buffs.Airborne`. |
| `src/game/combat/ExecuteTargeting` | 3 | `lethalTargets`, `pickExecuteTarget` | REACHABLE | `api.combat.ExecuteTargeting.lethalTargets` / `.pickExecuteTarget` (namespace import). |
| `src/managers/AssetManager` (static `import`) | 3 | `default`, called as `AssetManager.get('key')` (`spells/Veigar_E.test.ts:2,64-65`; `spells/Ashe_R.test.ts:2,201`; `spells/Leblanc_R.test.ts:2`) | REACHABLE | `api.asset(key)` is exactly `AssetManager.get(key)` — `src/game/config/packAsset.ts:40`. Drop-in rename. See separate `vi.mock()` row below: this is a different, much smaller population than the mocking pattern. |
| `src/game/gameObject/buffs/Root` | 3 | `default` | REACHABLE | `api.buffs.Root`. |
| `src/libs/quadtree` | 3 | `Rectangle` (value, 2 files: `spells/Nautilus.test.ts:7`, `spells/Lux_R.test.ts:13`), `type Rectangle` (1 file: `spells/Jinx_R.test.ts:7`) | REACHABLE | `api.utils.Quadtree.Rectangle` (value/constructor). Type-only use needs `InstanceType<typeof api.utils.Quadtree.Rectangle>`. |
| `src/game/combat/BasicAttack` | 2 | `MELEE_RANGE_THRESHOLD` (`attackProfiles.test.ts:5`), `BasicAttackSwing`, `MELEE_WINDUP_MS` (`spells/Teemo_E.test.ts:14`) | GAP | Not on `ContentApi` at all (different module from `coreSpells/BasicAttack`, also a gap, below). `attackProfiles.test.ts` uses this *on purpose* to check the pack's own attack-profile table against core's mechanism constant — see its own header, `attackProfiles.test.ts:9-19`, which argues this crossing is intentional because packs may not do it, tests may. |
| `src/game/enums/TeamId` | 2 | `default` | GAP | Not in `ContentApi`'s `enums` namespace (`ActionState, BuffAddType, EventType, StatusFlags, SpellForm, SpellRole` only — `src/content/ContentApi.ts:292-299`). Used to build a blue/red `Champion` (`spells/Ashe_E.vision.test.ts:18,39,46,68`) and to call `getLaneWaypoints(lane, TeamId.BLUE\|RED)` (`maps/Lanes.test.ts:2,457-472`). |
| `src/game/lanes` | 2 | `LANES`, `Lane`, `getLaneWaypoints`, `type LaneWaypoint` | GAP | Not on `ContentApi` (core's own lane-waypoint geometry/type helpers). `maps/Lanes.test.ts:3`, `spells/Darius.test.ts:9`. |
| `src/content/PackRegistry` | 2 | `PackRegistry` | GAP | Not on `ContentApi` — it is the mechanism that *installs* a pack, not vocabulary a pack's spells use. `pack.test.ts:4,112` (`new PackRegistry().install(pack)`), `maps/summonersRift.test.ts:9,105-128`. |
| `src/content/ContentPack` | 2 | `type MapGeometry`, `type StructureSlot`, `type ContentPack` | TYPE-ONLY | All three re-exported from `@moba2d/core/content/types` (`src/content/types.ts:71-97`); `ContentPack` and `StructureSlot` also directly off `@moba2d/core/content/ContentPack`, one of the three specifiers `packCoreBoundary.ts` allows type-only (`src/seams/packCoreBoundary.ts:73-77`). |
| `src/game/gameObject/attackableUnits/Minion` | 2 | `default` | GAP | Not in `ContentApi.units` (`AttackableUnit, Champion, Pet, Monster` only). Both files construct real minions with `new Minion({...})` (`spells/Darius.test.ts:8,32-33`; `spells/Pantheon.test.ts:7,127`). |
| `src/managers/EventManager` | 2 | `default` | GAP | Not on `ContentApi`. Constructed directly to seed a hand-built `TestGame.eventManager` (`spells/Teemo_E.test.ts:8,55`; `spells/Janna_R.test.ts:30,147`) — same class both fixture modules construct internally (Step 3). |
| `src/game/gameObject/spellObjects/BeamSpellObject` | 2 | `default` | REACHABLE | `api.BeamSpellObject`. |
| `src/game/gameObject/buffs/Silence` | 2 | `default` | REACHABLE | `api.buffs.Silence`. |
| `src/game/gameObject/buffs/Untargetable` | 2 | `default` | REACHABLE | `api.buffs.Untargetable`. |
| `src/game/gameObject/attackableUnits/Monster` | 2 | `default` | REACHABLE | `api.units.Monster`. |
| `src/content/validate` | 1 | `validatePack` | GAP | Not on `ContentApi` — pack-shape validation, a build/CI concern, not spell vocabulary. `maps/summonersRift.test.ts:7,92`. |
| `src/game/gameObject/buffs/Chilled` | 1 | `default` | REACHABLE | `api.buffs.Chilled`. |
| `src/game/config/PregameConfig` | 1 | `type MatchRules` | TYPE-ONLY (no subpath) | Not re-exported by `@moba2d/core/content/types`. Used to build a synthetic URF match-rules object (`spells/Anivia_R.test.ts:7,15,62`). Type-only, so it costs nothing at runtime, but there is currently no published name for it. |
| `src/game/gameObject/map/FogOfWar` | 1 | `default` | GAP | Not on `ContentApi`. `Object.create(FogOfWar.prototype)` to test vision-selection logic directly (`spells/Ashe_E.vision.test.ts:16,49`). |
| `src/game/gameObject/spellObjects/AreaSpellObject` | 1 | `default` | REACHABLE | `api.AreaSpellObject`. |
| `src/game/preset` | 1 | `spellGroups` | GAP | Not on `ContentApi` — core's champion-kit grouping/preset helper. `spells/Janna_R.test.ts:36,171`. |
| `src/game/gameObject/spellObjects/AoePulse` | 1 | `default` | REACHABLE | `api.AoePulse`. |
| `src/game/vfx/CastBar` | 1 | `default` | REACHABLE | `api.vfx.CastBar`. |
| `src/game/gameObject/Buff` | 1 | `default` | REACHABLE | `api.buffs.Buff`. |
| `src/game/gameObject/GameObject` | 1 | `type default` | TYPE-ONLY (no subpath) | `@moba2d/core/content/types` re-exports only `GameObjectRuntimeContext` off this module (`src/content/types.ts:61`), not the base class type itself. `spells/Malzahar.test.ts:17,89` types an array as `GameObject[]`. |
| `src/game/gameObject/buffs/TrueSight` | 1 | `default` | REACHABLE | `api.buffs.TrueSight`. |
| `src/game/gameObject/SpellObject` | 1 | `default` | REACHABLE | `api.SpellObject`. |
| `src/game/gameObject/map/DynamicTerrain` | 1 | `slabVertices` | REACHABLE | `api.terrain.slabVertices`. |
| `src/game/enums/ActionState` | 1 | `default` | REACHABLE | `api.enums.ActionState`. |
| `src/game/gameObject/buffs/Taunt` | 1 | `default` | REACHABLE | `api.buffs.Taunt`. |
| `src/game/gameObject/coreSpells/BasicAttack` | 1 | `default` | GAP | Not on `ContentApi` (core's own auto-attack spell class, not pack vocabulary). `spells/Teemo_E.test.ts:6,167` — puts a real `BasicAttack` in the caster's spell slots to drive a real key-press-to-swing sequence. |
| `src/game/gameObject/buffs/DamageOverTime` | 1 | `default` | REACHABLE | `api.buffs.DamageOverTime`. |
| `src/game/spell/input/SpellInputController` | 1 | `default` | GAP | Not on `ContentApi`. `spells/Teemo_E.test.ts:12,174-192` — drives the same key-press pipeline the player uses, to prove press-through-controller lands a real swing. |
| `src/game/constants` | 1 | `HotKeys`, `SpellHotKeys` | GAP | Not on `ContentApi`. Same file, same test (`spells/Teemo_E.test.ts:13,175,192-193`). |
| `tests/game/spell/fixtures` | 46 | `createGame`, `createUnit`, `installSpellObjectGlobals`, `installSketchMathGlobals`, `pressSpell`, `releaseSpell`, `type TestGame`, `TestVector`, `withCastTime`, `withWalls` (re-export) | TEST-ONLY | Core test infrastructure, not engine vocabulary — see Step 3. |
| `tests/game/fixtures` | 12 | `createGame`, `stubGameGlobals`, `withWalls`, `type TestGame`, `indexObjects` | TEST-ONLY | Core test infrastructure — see Step 3. |
| `tests/game/spell/registry` | 1 | `loadEverySpellForTests`, `AllSpells` | TEST-ONLY | Core test infrastructure, and the one file that hard-imports the departing pack — see Step 3. |
| `vi.mock('.../src/managers/AssetManager')` | 48 | n/a — module replaced wholesale with `{ get: () => undefined, getAsset: () => undefined }` (shape varies slightly per file) | GAP | Found by `grep -rn "vi\.mock(" tests/packs/riot`, not the import scan — 48 of the 49 `vi.mock()` calls target this path (e.g. `spells/Malphite_E.test.ts:3-5`, `spells/Ekko.test.ts:3-5`, `spells/Nautilus.test.ts:3-5`). `AssetManager` is neither on `ContentApi` nor in core's `package.json` `exports` map (only `./content/ContentApi`, `./content/ContentPack`, `./content/types` are published — `package.json:` `"exports"` block). `vi.mock()` needs a resolvable module specifier to intercept; once the pack is a separate package, `@moba2d/core/managers/AssetManager` is not a legal import at all, mockable or not. Distinct problem from the `AssetManager` REACHABLE row above — that row is 3 files calling `AssetManager.get()` directly as a value; this row is 48 files replacing the whole module before anything imports it. |
| `vi.mock('.../src/game/vfx/CastTelegraph')` | 1 | n/a — module replaced with a spy class that records `CastContext` and a center-getter | GAP | `spells/Janna_R.test.ts:11` (the one file among the 49 `vi.mock()` calls targeting this path — it also mocks `AssetManager` at `:7`). `CastTelegraph` itself *is* reachable as a value (`api.vfx.CastTelegraph`), but that does not help: the test needs to intercept the module before `packs/riot/spells/Janna_R.ts` constructs one internally, and `vi.mock()` operates on the specifier, not on any value `api` could hand over. Same structural problem as the `AssetManager` mock row, smaller population. |

### Tallies

- **REACHABLE:** 34 specifiers (32 clean + the `AssetManager` static-import row + the `quadtree`/`AttackableUnit`/`Spell` rows whose type-only sub-uses need `InstanceType<...>` rather than a bare import, noted inline).
- **TYPE-ONLY:** 4 specifiers — 2 with an existing published subpath (`runtime/types`'s `CastContext`, `ContentPack`'s three types), 2 with none (`PregameConfig`'s `MatchRules`, `GameObject`'s class type).
- **TEST-ONLY:** 3 specifiers (`tests/game/spell/fixtures`, `tests/game/fixtures`, `tests/game/spell/registry`).
- **GAP:** 15 specifiers — 12 clean value-vocabulary gaps, 1 mixed (`Stats`, majority-gap), 2 `vi.mock()`-only mocking-mechanism gaps that the static-import scan cannot even see.

## Step 3 — the two fixture modules, and `registry.ts`

### `tests/game/spell/fixtures.ts` (252 lines; used by 46 of 69 riot test files)

Own imports (`tests/game/spell/fixtures.ts:1-8`): `vi` (vitest), `Rectangle`
(`src/libs/quadtree`), `EventManager` (`src/managers/EventManager`), `type
GameObjectRuntimeContext` (`src/game/gameObject/GameObject`),
`AttackableUnit`, `ObjectManager` (`src/game/managers/ObjectManager`), `type
Spell`, `type CastContext`.

Exports and what each builds:

- `TestVector` (`:10-81`) — a hand-rolled `p5.Vector` stand-in (add/sub/mult/
  mag/lerp/etc.), no core dependency.
- `TestGame` (`:83-85`) — a type: `GameObjectRuntimeContext` plus
  `setPlayer()`.
- `installSpellObjectGlobals()` / `installSketchMathGlobals()` (`:87-123`) —
  `vi.stubGlobal` the p5 sketch functions/constants a spell touches
  (`createVector`, `random`, `lerp`, `constrain`, `map`, `sin`, `cos`, `PI`,
  etc.).
- `createGame()` (`:125-144`) — builds a real `ObjectManager` and a real
  `EventManager`, wraps them in the `TestGame` shape.
- `createUnit()` (`:146-148`) — `new AttackableUnit({...})`.
- `castContextFor()` / `pressSpell()` / `releaseSpell()` (`:158-219`) —
  build a real `CastContext` and drive a real `Spell` through `.press()` /
  `.release()`, matching what a keypress does (documented, `:182-191`, as
  "the only honest way to drive a spell in a test").
- `withCastTime()` (`:236-246`) — subclasses a spell to override `castSpec`.
- `withWalls` (`:252`) — re-exported from `../fixtures` (the other module,
  below), not duplicated.

### `tests/game/fixtures.ts` (243 lines; used by 12 of 69 riot test files)

Own imports (`tests/game/fixtures.ts:1-10`): `vi`, `Rectangle`,
`ObjectManager`, `EventManager`, `NavGrid` (`src/game/nav/NavGrid`),
`TerrainField` (`src/game/gameObject/map/TerrainField`), `TerrainType`
(`src/game/enums/TerrainType`), `type AttackableUnit`, `type GameObject` /
`type GameObjectRuntimeContext`.

Exports: the same shape of `TestVector`/`TestGame`/`createGame()` as the
sibling module (independently defined, not shared — see below), plus
`TEST_AVATAR_KEY` (`:104`, a core-owned asset key chosen specifically so a
test does not accidentally require the riot pack to resolve an avatar — see
its own comment, `:84-103`), `withWalls()` (`:154-173`, builds a real
`NavGrid`/`TerrainField` and a `terrainMap` stub with real wall polygons),
`indexObjects()` (`:176-182`, rebuilds the quadtree), and
`stubGameGlobals()` (`:189-243`, the drawing-side p5 stub surface: `push`,
`pop`, `fill`, `rect`, `image`, etc., each a `vi.fn()` spy).

**Neither fixture module *imports* a specific pack.** Both build a bare
`ObjectManager`/`EventManager`/`AttackableUnit` world with no `import` of
`packs/riot/` anywhere in either file — `grep -n "^import" tests/game/spell/fixtures.ts
tests/game/fixtures.ts` names only `vitest` and `src/` specifiers. The one
textual hit for `"riot"` (`grep -n "packs/riot\|riot"` on both files) is a
comment, `tests/game/fixtures.ts:92-93`, inside `TEST_AVATAR_KEY`'s own
explanation (`:84-103`) of a past bug of exactly the opposite shape — eight
core files leaned on a riot-pack asset key by accident — and the fix was
choosing a core-owned key on purpose, which is direct evidence the module's
authors already treat pack-independence as a requirement here.

**But both fixture modules are themselves built from core internals that
`ContentApi` does not expose at all**: `ObjectManager` (the class),
`EventManager`, `NavGrid`, `TerrainType` are not part of `ContentApi`'s
exported surface. `ObjectManager` is textually present in
`src/content/ContentApi.ts` only as the *source* of a named import — its ten
`*_Z_INDEX` constants and `PredefinedFilters` (`src/content/ContentApi.ts:55-67`,
re-exported as `layers`/`combat.PredefinedFilters`) — never the class or
constructor itself; `EventManager`, `NavGrid` and `TerrainType` do not
appear in that file at all (`grep -n "EventManager\|NavGrid\|TerrainType" src/content/ContentApi.ts`
— no matches). This is the load-bearing finding for the whole "tests reach
engine vocabulary the way spells do" framing: a spell never builds a world,
it receives one already built (`game` is handed in). A test fixture's job is
specifically to build that world, which needs exactly the constructors
`ContentApi` was deliberately never designed to hand out. The fixtures
cannot become "just another `ContentApi` consumer" — they need a different,
new kind of published surface (a test-harness entry point), not a wider
`ContentApi`.

### `tests/game/spell/registry.ts` (44 lines; used by 1 of 69 riot test files, `spells/Teemo_E.test.ts`)

Confirmed exactly as the task's background states: line 2 is
`import * as AllSpellFactories from '../../../packs/riot/spells/index'`
(`tests/game/spell/registry.ts:2`) — a direct, hard-coded import of the
riot pack's own spell barrel from a file that lives in core's test tree.
Line 1 additionally imports `../../../src/game/gameObject/coreSpells/index`
(core's built-in spells). `loadEverySpellForTests()` (`:37-42`) merges both
into the shared spell registry synchronously, for any test that wants the
whole catalogue resolvable without 238 dynamic imports.

This file cannot be fixed by routing it through `ContentApi` — "every
currently-installed pack's spell factories" is not engine vocabulary
`ContentApi` has (or should have: which pack is installed is precisely the
one thing `ContentApi` is deliberately blind to). Once `packs/riot/` is a
sibling repository, `../../../packs/riot/spells/index` stops resolving and
this helper breaks at import time, for every one of the (currently 1, but
structurally the *only* correct place to put this kind of helper) callers
that need it. The fix is architectural, not a `ContentApi` addition: either
the helper takes the pack's spell barrel as a parameter (pack supplies its
own), or it moves to be pack-owned code entirely.

## Step 4 — `tests/setup.ts`

Four things installed, each cited by line:

1. **`Math.hypot = fastHypot`** (`tests/setup.ts:7`, from
   `src/utils/optimized.utils.ts`) — a faster `Math.hypot` patched onto the
   global before any test runs. Both core's and the pack's tests need this:
   neither depends on it by name, but both exercise vector-distance code
   throughout, and this patch is what they actually run against once
   installed — a numerically-equivalent, faster global, not a stub either
   suite specifically asks for.

2. **Pack asset registration** (`tests/setup.ts:41-43`,
   `for (const pack of installedPacks) { AssetManager.registerPackAssets?.(pack.id, pack.assetManifest); }`,
   reading `src/generated/installedPacks.ts`, imported `tests/setup.ts:4`) —
   needed by **pack tests** specifically. The comment above it
   (`tests/setup.ts:9-40`) is explicit: many spell tests build a real spell
   straight from `buildContentApi()` and a pack factory without ever
   calling `install.ts`, so without this every `api.asset('spell_x')` call
   in a constructor throws `Unknown asset key`. The `?.` guard exists
   because the 48 `vi.mock('...AssetManager...')` files (Step 2) replace
   the whole module with a double that has no `registerPackAssets` at all —
   this line is a correct no-op under those.

3. **Lane installation** (`tests/setup.ts:70-71`,
   `await loadPackLanesForTests(); installSummonersRiftLanesForTests();`,
   from `tests/game/lanesFixture.ts`, imported `tests/setup.ts:5`) — needed
   by **both**. Core ships an empty, laneless default map on purpose
   (`tests/setup.ts:48-49` cites Spec §7 and
   `tests/content/summonersRiftCoordinateBoundary.test.ts`), so this line
   installs the riot pack's real Summoner's Rift lane data as the
   process-wide default. Pack tests (`maps/Lanes.test.ts`,
   `spells/Darius.test.ts`) need the *real* riot waypoints functionally; but
   the comment (`tests/setup.ts:55-56`) also names a **core** test,
   `tests/game/minions/MinionSpawner.test.ts`, whose `WAVE_SIZE` constant is
   computed off `LANES.length` at *module import time* — core's own generic
   minion-wave test currently has no lane data of its own to fall back to,
   so it borrows the pack's. That is itself a coupling this design would
   need to resolve, separately from anything `ContentApi` can fix.

4. **p5-sketch globals** (`tests/setup.ts:73-81`,
   `Object.assign(globalThis, { deltaTime, lerp, constrain, random, floor,
   createVector: vi.fn() })`) — a baseline both suites share; the two
   fixture modules' own `install*Globals()`/`stubGameGlobals()` functions
   (Step 3) layer more specific stubs on top per-test via `vi.stubGlobal`,
   which override this baseline for the globals both touch.

## Step 5 — the honest cost, five real files

1. **`tests/packs/riot/spells/Malphite_E.test.ts`** (typical single-spell
   shape). Already calls `buildContentApi()` and holds `__api` in module
   scope (`:19-20`) to build the spell under test
   (`makeMalphite_E(__api)`). But it *also* separately imports `Slow`
   (`:6`), `StatAmp` (`:7`), and `AttackableUnit` (`:9`) directly by
   relative path even though `__api.buffs.Slow`, `__api.buffs.StatAmp`,
   `__api.units.AttackableUnit` are the same values — the file has the tool
   already in hand and doesn't use it for these three. Rewrite: delete three
   `import` lines, read the three names off `__api` instead (or destructure
   once). `CastContext` (`:8`, type-only) stays an import, just retargeted
   to `@moba2d/core/content/types`. Zero new machinery needed — this is the
   cheap, common case.

2. **`tests/packs/riot/spells/Ekko.test.ts`** (four-spell champion file,
   same shape, smaller import list). One core value import beyond fixtures
   and `ContentApi`: `AttackableUnit` (`:6`). `vi.mock('.../AssetManager',
   ...)` at the top (`:3-5`) is the GAP case from Step 2 — rewriting the one
   reachable import does nothing about the mock, which has no answer under
   this design at all.

3. **`tests/packs/riot/spells/Nautilus.test.ts`** (heaviest REACHABLE
   sample — three spells, five distinct core values). Already has `__api`.
   Imports `Rectangle` (constructed directly, `:47-48`, to build a bounding
   box for a test double's `getDisplayBoundingBox()`), `SpellObject`,
   `AttackableUnit`, `Dash`, `Stun`, and `slabVertices` — all five REACHABLE
   (`api.utils.Quadtree.Rectangle`, `api.SpellObject`,
   `api.units.AttackableUnit`, `api.buffs.Dash`, `api.buffs.Stun`,
   `api.terrain.slabVertices`). Rewrite is mechanical — five more lines
   deleted, five more names read off `__api` — but it is not free of the
   `vi.mock('.../AssetManager', ...)` GAP at the top of the same file
   (`:3-5`): the reachable rewrite and the mock GAP are independent axes,
   and this file needs both addressed to actually leave core.

4. **`tests/packs/riot/attackProfiles.test.ts`** (no `ContentApi` at all —
   one of 5 such files). Imports `ATTACK` from `packs/riot/data` (in scope,
   fine) plus three core value imports: `DEFAULT_CHAMPION_ATTACK`
   (REACHABLE, `api.units.DEFAULT_CHAMPION_ATTACK`), `MELEE_RANGE_THRESHOLD`
   and `MAX_ATTACK_SPEED` (both GAP). There is no existing helper that
   builds an `api` for this file — it would have to add
   `const api = buildContentApi();` itself, purely to reach one field, while
   the other two fields it needs have nowhere to come from regardless. And
   per the file's own header (`:9-19`), this test's *entire purpose* is
   checking the pack's numbers against core-internal mechanism constants
   that `ContentApi` deliberately does not expose to a pack's production
   code — extending `ContentApi` to satisfy this test would blur exactly
   the line the file is asserting exists.

5. **`tests/packs/riot/pack.test.ts`** (install/registry shape, not a spell
   test). Already calls `buildContentApi()` (`:3,32`) and uses `api` to get
   `riotCode(api)` five times. But `PackRegistry` (`:4`, GAP) and the
   `ContentPack` type (`:6`, TYPE-ONLY, reachable via
   `@moba2d/core/content/types`) are both needed alongside it, for a test
   whose whole point is installing a pack object and asserting on
   `PackRegistry`'s own validation errors (`:112`,
   `expect(() => new PackRegistry().install(pack)).toThrow(/BasicAttack/)`).
   The reachable half (`riotCode(api)`) needs no rewrite at all; the
   `PackRegistry` half cannot be served by `ContentApi` under any
   extension of it — `PackRegistry` is the installer, one level above what
   a pack (or a pack's spell tests) is ever handed.

**In three lines:** files that already build a spell from `__api` (64 of 69,
`pack.test.ts` included) cost a mechanical rewrite for their REACHABLE
imports and nothing for their TYPE-ONLY ones, but 48 of those 64 also carry a
`vi.mock()` on `AssetManager` and/or `CastTelegraph` (verified: every file
with a `vi.mock()` call is already a `ContentApi` user) that no `ContentApi`
extension fixes, and `pack.test.ts` itself still needs `PackRegistry` (GAP)
alongside its `api`. The 5 files with no `__api` in scope
(`attackProfiles.test.ts`, `generate-assets.test.ts`, `maps/Lanes.test.ts`,
`maps/summonersRift.test.ts`, `spells/ahri-palette.test.ts`) would gain one
cheaply where they need it at all, but 2 of them
(`attackProfiles.test.ts`, `maps/summonersRift.test.ts`) need GAP vocabulary
(core mechanism constants; `PackRegistry`/`validatePack`) an `api` object
structurally cannot carry regardless. No sampled file was reachable-only
end-to-end.
