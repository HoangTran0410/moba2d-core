# Pack authoring surface — measured gap between what a pack needs and what core exposes

Survey, not a plan. Every number below was produced by a command run against this worktree
(`/Users/hoangtran/Desktop/Github/LOL2D-batch5`, branch `content-pack-batch-5`, `c6fb29e`). No
file in the worktree was left changed — one empirical probe (question 7) wrote and then deleted
a scratch file inside `packs/riot/spells/`; `git status --porcelain` was empty before and after.

## 1. The pack's test files

`find tests/packs/riot -type f | wc -l` → **69 files**, all `.ts` (`find tests/packs/riot -type f -name "*.ts" | wc -l` → 69). 66 sit under `tests/packs/riot/spells/` and `tests/packs/riot/maps/`; 3 sit directly in `tests/packs/riot/` (`generate-assets.test.ts`, `attackProfiles.test.ts`, `pack.test.ts`).

Every `import`/`from` specifier was extracted with a small Node script (path-resolved against each file's own directory, deduplicated per file+specifier) and cross-checked against `grep`. One false positive was found and removed: `generate-assets.test.ts:71` contains the string `"from '../assets/images/champions/janna.png?url'"` inside an `expect(source).toContain(...)` assertion — it is testing generated codegen text, not importing anything. No dynamic `import()`, no bare `require()` anywhere in the tree (`grep -rn "import(\|require("` → 0 hits).

**Grouped totals** (occurrences = distinct specifier per file, so a file importing the same module twice counts once):

| Group | Distinct specifiers | File-uses |
|---|---:|---:|
| (a) pack's own source (`packs/riot/...`) | 152 | 163 |
| (b) core's `src/` | 49 | 286 |
| (c) core's test helpers (`tests/...`) | 3 | 59 |
| (d) third-party | 6 | 75 |

**(b) is reached entirely by relative path, never by the `@/` alias.** `grep -rn "['\"]@/" tests/packs/riot --include="*.ts"` → **0 hits**. Every one of the 49 core-`src/` specifiers below is written as `../../../../src/...` (4 levels up from `spells/`/`maps/` files) or `../../../src/...` (3 levels up from the 3 root-level files) — plain filesystem paths that only resolve because these test files physically live inside core's own checkout, under `tests/`.

**(b) full deduplicated list** (count = number of the 69 test files that import it):

```
64  src/content/ContentApi
37  src/game/gameObject/attackableUnits/AttackableUnit
28  src/game/spell/runtime/types
18  src/game/gameObject/buffs/Dash
17  src/game/gameObject/attackableUnits/Champion
12  src/game/gameObject/buffs/Slow
 8  src/game/gameObject/buffs/Stun
 8  src/game/enums/EventType
 6  src/game/gameObject/buffs/Shield
 6  src/game/enums/StatusFlags
 5  src/game/gameObject/spellObjects/HomingMissileSpellObject
 4  src/game/gameObject/Stats
 4  src/game/spell/targeting/TargetResolver
 4  src/game/gameObject/Spell
 4  src/game/gameObject/buffs/StatAmp
 4  src/game/gameObject/buffs/Speedup
 4  src/game/gameObject/buffs/Airborne
 3  src/game/combat/ExecuteTargeting
 3  src/managers/AssetManager
 3  src/game/gameObject/buffs/Root
 3  src/libs/quadtree
 2  src/game/combat/BasicAttack
 2  src/game/enums/TeamId
 2  src/game/lanes
 2  src/content/PackRegistry
 2  src/content/ContentPack
 2  src/game/gameObject/attackableUnits/Minion
 2  src/managers/EventManager
 2  src/game/gameObject/spellObjects/BeamSpellObject
 2  src/game/gameObject/buffs/Silence
 2  src/game/gameObject/buffs/Untargetable
 2  src/game/gameObject/attackableUnits/Monster
 1  src/content/validate
 1  src/game/gameObject/buffs/Chilled
 1  src/game/config/PregameConfig
 1  src/game/gameObject/map/FogOfWar
 1  src/game/gameObject/spellObjects/AreaSpellObject
 1  src/game/preset
 1  src/game/gameObject/spellObjects/AoePulse
 1  src/game/vfx/CastBar
 1  src/game/gameObject/Buff
 1  src/game/gameObject/GameObject
 1  src/game/gameObject/buffs/TrueSight
 1  src/game/gameObject/SpellObject
 1  src/game/gameObject/map/DynamicTerrain
 1  src/game/enums/ActionState
 1  src/game/gameObject/buffs/Taunt
 1  src/game/gameObject/coreSpells/BasicAttack
 1  src/game/gameObject/buffs/DamageOverTime
 1  src/game/spell/input/SpellInputController
 1  src/game/constants
```

**(c) full deduplicated list:**

```
46  tests/game/spell/fixtures    — TestVector, createGame/createUnit, installSpellObjectGlobals,
                                    installSketchMathGlobals, pressSpell (the spell-test harness)
12  tests/game/fixtures          — the same shape, for non-spell object/manager tests
 1  tests/game/spell/registry    — loadEverySpellForTests(); its own source
                                    (tests/game/spell/registry.ts:2) imports
                                    `../../../packs/riot/spells/index` directly — a core-owned
                                    test helper that itself hard-codes a reach into the pack
```

`tests/game/spell/registry.ts` is used by exactly one pack test (`Janna_R.test.ts`) and one core test elsewhere (`tests/game/preset.catalog.test.ts`) — confirmed by `grep -rln "game/spell/registry'" tests`.

`tests/support/{installedPacks,riotVocabulary,srcTree}.ts` — the directory the question names as a plausible home for shared test helpers — is used by **17 files, all under `tests/content/`, `tests/game/`**, never by anything in `tests/packs/riot/` (`grep -rln "tests/support" tests/packs/riot` → 0). It already anticipates this exact extraction (`installedPacks.ts`'s own header names "content-pack-extraction batch 5 task 7/8" and the departure drill by name), but the pack's own tests do not reach it today.

**(a) full list is 152 entries** — 144 are one-per-spell-file imports of individual `packs/riot/spells/<Champion>_<Slot>` modules (including the four summoner spells `Flash`/`Heal`/`Ghost`/`Ignite`, which live in the same directory); the 8 shared, non-spell ones are:

```
2  packs/riot/maps/summoner_map.json
2  packs/riot/maps/summonersRiftGeometry
2  packs/riot/pack
1  packs/riot/data
1  packs/riot/scripts/generate-assets.mjs
1  packs/riot/maps/summonersRift
1  packs/riot/generated/spellModules
1  packs/riot/vfx/LuxBeamEffect
```

**(d) third-party**, all via `node:` built-ins or `vitest` itself: `vitest` (69 — every file), `node:path` (2), `node:fs/promises` (1), `node:os` (1), `node:url` (1), `node:fs` (1). Two pack-own imports also use Vite's `?raw` query suffix (`Blitzcrank_Q.test.ts:17`, `Teemo_W.test.ts:8`, importing a spell file's source as text) — a build-tool feature, not an npm package, and a pack's own test runner would need the same Vite transform to support it.

## 2. The test runtime they depend on

`vitest.config.ts` (28 lines of comment, 21 of config): plugin `vue()` (line 37, so a transitively-imported `.vue` file doesn't crash the esbuild transform); `resolve.alias['@'] = resolve(__dirname, 'src')` (line 38); `test.environment = 'node'` (line 40); `test.setupFiles = ['tests/setup.ts']` (line 41); `test.clearMocks = true` (line 42); `test.exclude` = Vitest's own defaults + `**/.claude/**` (worktree isolation) + a derived `packDependent` list (line 47) that is empty in an ordinary checkout and only non-empty inside `npm run verify:without-packs`. No `pool` option is set (Vitest default). No `include` override (Vitest default glob).

`tests/setup.ts`, 81 lines, four installations:

- `tests/setup.ts:7` — `Math.hypot = fastHypot` (a perf patch). Needed by any test exercising vector math (`AttackableUnit`, `Dash`, distance checks) — pack tests need it; confirmed 14 pack test files reference `hypot`/magnitude directly.
- `tests/setup.ts:41-43` — registers every entry of `installedPacks` (`src/generated/installedPacks.ts`) into `AssetManager.registerPackAssets`, so a spell built straight from `buildContentApi()` (bypassing `install.ts`) can still resolve `api.asset('spell_x')`. **A pack's own spell tests cannot construct a spell without this** — the doc comment states plainly that without it, every such constructor throws "Unknown asset key" on its field initializer.
- `tests/setup.ts:70-71` (via `tests/game/lanesFixture.ts`) — installs the first installed pack's first map's real lane geometry as the ambient default, because core's own default is an empty, laneless map. Confirmed needed by 2 pack tests specifically: `tests/packs/riot/maps/Lanes.test.ts` and `tests/packs/riot/spells/Darius.test.ts`, both of which import `LANES`/`getLaneWaypoints` from `src/game/lanes` directly. Despite the function name `installSummonersRiftLanesForTests`, `lanesFixture.ts:34-39` derives the map from `installedPacks[0]` generically (not a hard import of `packs/riot`) — already pack-agnostic by design (its own header cites content-pack-extraction batch 5 task 8 as the reason it was rewritten this way).
- `tests/setup.ts:73-81` — stubs the p5 globals a Node test environment never gets: `deltaTime`, `lerp`, `constrain`, `random`, `floor`, `createVector`. Universally needed — 29+ pack test files call `createVector`/`constrain`/`lerp` directly, and virtually every spell object's `draw()`/`update()` touches at least one of these.

All four installations are core-generic (none hard-codes `packs/riot` by path); the pack-coupling that exists (`tests/game/spell/registry.ts`, not part of `setup.ts` itself) is opt-in, used by only one pack test.

**What a pack's own vitest run would have to reproduce:** the `@` alias (only if the pack's tests were rewritten to use it — today's 69 files don't), `environment: 'node'`, the `vue()` plugin (only if anything reachable pulls in a `.vue` file — none of today's 69 do, per §1's import list), and all of `tests/setup.ts`'s four installations except the `registry.ts` special case. `clearMocks: true` matters for any test using `vi.mock`/`vi.fn` (56 pack test files use `vi.mock('.../AssetManager', ...)`). The `exclude`/`packDependent` machinery is core's own departure-drill bookkeeping and has no pack-side equivalent to reproduce.

## 3. What core already publishes

Root `package.json`:

- `exports` (7 entries): `./content/ContentApi`, `./content/ContentPack`, `./content/types`, `./seams`, `./tsconfig.base.json`, `./types/global.d.ts`, `./types/poly-decomp.d.ts`.
- `bin` (2): `moba2d-check-seams` → `scripts/check-seams.mjs`; `moba2d-generate-spell-catalog` → `scripts/generate-spell-catalog.mjs`.
- `files` (12 entries): `assets/cursors`, `assets/images`, `packs/reference`, `public`, `scripts/check-seams.mjs`, `scripts/generate-spell-catalog.mjs`, `scripts/version.mjs`, `src`, `styles`, `index.html`, `tsconfig.base.json`, `tsconfig.json`, `vite.config.ts`.

**What `packs/riot/package.json` consumes:** scripts `assets:generate`/`assets:check` (its own local `scripts/generate-assets.mjs`, no core dependency); `catalog:generate`/`catalog:check` → the `moba2d-generate-spell-catalog` bin; `typecheck` → `tsc -p tsconfig.json`, whose `tsconfig.json:33` does `"extends": "@moba2d/core/tsconfig.base.json"`; `check-seams`/`check-seams:monsters` → the `moba2d-check-seams` bin. `devDependencies`: `@moba2d/core: "*"`. Source imports (`grep -rhoE "from ['\"]@moba2d/core[^'\"]*['\"]" packs/riot --include="*.ts"`): `@moba2d/core/content/ContentApi` (240 files), `@moba2d/core/content/types` (96), `@moba2d/core/content/ContentPack` (4) — all three already in `exports`.

**What `packs/reference/package.json` consumes:** only `check-seams` → the `moba2d-check-seams` bin. No `typecheck`, no `assets:*`, no `catalog:*` scripts at all. `devDependencies`: `@moba2d/core: "*"`. Source imports: `@moba2d/core/content/ContentApi` (5), `@moba2d/core/content/ContentPack` (3) — both already in `exports`. `packs/reference/` has **no `tsconfig.json` of its own**; nothing in the repo's four tsconfig files (`grep -rln "packs/reference" --include="tsconfig*.json" .` → 0 hits) includes it. It is only ever typechecked transitively — `src/content/install.ts:47` does `import referenceCode, { data as referenceData } from '../../packs/reference/pack'`, a plain relative import reached by root `npm run typecheck`'s `include: ["src/**/*"]`, the same import-following mechanism `tests/content/packBoundary.test.ts`'s own doc comment documents for the riot pack.

**Delta.** In committed production source, the delta is **zero**: every `@moba2d/core/...` specifier either pack imports (`content/ContentApi`, `content/ContentPack`, `content/types`) is already declared in `exports`. The real delta is in the pack's *tests* (§1): 47 of the 49 distinct core-`src/` specifiers pack tests import, plus all 3 core test-helper specifiers, have no published entry point at all — only `src/content/ContentApi` (already exported) and `src/content/ContentPack` (exported but not directly imported by any of the 69 test files) overlap with what `exports` declares. The `./seams` export, conversely, is declared but **not consumed by either pack today** — `grep -rn "@moba2d/core/seams" packs/ scripts/` finds only a doc-comment mention in `scripts/check-seams.mjs`, never an actual import — an export published ahead of any consumer.

## 4. Authoring tooling that exists

Exactly one script scaffolds new authorable content: **`scripts/new-spell.mjs`** (`npm run spell:new -- --champion X --slot Y`), 663 lines.

- `scripts/new-spell.mjs:39` — `SPELLS_DIR = 'packs/riot/spells'`, **hardcoded**.
- `scripts/new-spell.mjs:40` — `TESTS_DIR = 'tests/game/spells'`, **hardcoded, and stale**: `git log` shows commit `6bb3a2a` ("move the champion-named tests into the pack's tree", 2026-08-22 04:50) relocated 64 of the then-90 files in `tests/game/spells/` to `tests/packs/riot/spells/`, establishing that champion-content tests belong there; a later commit that same day, `5ac68bd` (06:08), edited this very script's neighbouring lines (`CATALOG_FILE`) but left `TESTS_DIR` pointing at the old location (`git show 5ac68bd -- scripts/new-spell.mjs` shows the `TESTS_DIR` line as unchanged context). Today `tests/game/spells/` holds only 19 generic seam/engine-behaviour tests, none named `<Champion>_<Slot>.test.ts`; every real per-spell test lives under `tests/packs/riot/spells/`. Running `spell:new` today would write a new spell's test into the directory the project stopped using for that purpose.
- `scripts/new-spell.mjs:41` — `INDEX_FILE = 'packs/riot/spells/index.ts'`, hardcoded; edited (not created) by `registerInBarrel()` (lines 568-597), which inserts an `export { default as <Slug> } from './<Slug>'` line in slot order.
- `scripts/new-spell.mjs:47` — `CATALOG_FILE = 'packs/riot/data.ts'`, hardcoded; edited (not created) by `registerInChampionKit()` (lines 608-633), which appends the new spell's id string to that champion's `spells: [...]` array via regex rewrite.
- `scripts/new-spell.mjs:48` — `VI_NAMES_FILE = 'docs/spell-names-vi.json'`, read-only; the script `die()`s (line 100) if no Vietnamese display name is cached for the slug, i.e. it structurally depends on Riot's Wiki-localisation pipeline (`npm run names:sync`) having already run.
- Writes: `spellFile` (line 637, always) and `testFile` (line 639, only if it doesn't already exist).
- **No template file is copied.** The generated spell and test source are inline JavaScript template literals in the script itself (spell body: lines 319-451; test body: lines 464-563). `packs/riot/spells/_EmptyExample.ts` is referenced three times only in comments, as documentation for the shape the inline template produces — it is never read at runtime.

No other script scaffolds new champions, monsters, or maps (`grep -rn "new-champion\|new-monster\|new-map" package.json packs/riot/package.json` → 0 hits; `scripts/` has no such file). `scripts/wiki/import-abilities.mjs` writes Riot ability *research data* into `docs/abilities/<champion>/<slot>.json` (a different concern — reference material, not spell code) and is entirely Wiki-network-dependent.

## 5. What a pack must contain to work

`packs/reference/` (`find packs/reference -type f`, 9 files total):

| File | Role |
|---|---|
| `package.json` | 12 lines — name, `devDependencies: { "@moba2d/core": "*" }`, one script (`check-seams`) |
| `README.md` | 13 lines — explains the `devDependencies`-not-`dependencies` placement, points to riot's README for the shared reasoning |
| `pack.ts` | 132 lines — the `ContentPackData`/`ContentPackFactory` pair: manifest, `spellDisplay` (name/description/cooldown/mana per spell, all interpolated from the spell files' own exported constants), one playable champion (`vera`), one `monsters` entry (`warden`, filling `provingGroundsGeometry.ts`'s one neutral slot), `maps: [referenceMap]` |
| `map.ts` | 41 lines — the map's cheap summary (id, name, size, factions) plus a dynamic `import()` of the heavy geometry, so it never rides in the menu's `pregame` chunk |
| `provingGroundsGeometry.ts` | 136 lines — walls, lane, muster/slot data, deliberately built to the same "hostile" properties (60-90px jungle gaps, asymmetric structure row) as Summoner's Rift, so nav/lane tests have a second independent fixture |
| `spells/Vera_Q.ts`, `Vera_W.ts`, `Vera_E.ts`, `Vera_R.ts` | 118/45/69/76 lines — the four spell factories, each `(api: ContentApi) => SpellClass`, same shape as a riot spell file |

Notably **absent**, compared with `packs/riot/`: a `tsconfig.json` (confirmed absent in §3 — `packs/reference` is never in any tsconfig's own `include`, and is typechecked only by transitive relative-import from `src/content/install.ts:47`); a `spells/index.ts` barrel (`pack.ts` imports all four spell factories directly by relative path — no indirection); a `generated/` directory (`find packs/reference -iname generated` → 0; there is no `spellCatalog.ts`, `spellModules.ts`, or `assetManifest.ts` the way `packs/riot/generated/` has all three); an `assets/` directory of any kind; `scripts/generate-assets.mjs` or any generator of its own; and `assets:*`/`catalog:*` package.json scripts (confirmed absent in §3). `scripts/generate-spell-catalog.mjs`'s own `PACK_SPELL_TREES` table only defines a `riot` tree — there is no equivalent tree definition for `reference` at all, so reference's spells are never dynamically per-champion-chunked the way riot's are.

Its declared icon/image keys (`reference_champ_vera`, `reference_vera_q`, etc.) resolve through nothing real: `src/generated/installedPacks.ts:36-45`'s `installedPacks` array (the thing `tests/setup.ts:41-43` and `src/content/install.ts`'s `registerPackAssets` loop both read) contains only `riot` — the reference pack is deliberately filtered out of it (`CORE_OWN` in `scripts/installed-packs.mjs:65`) because it is core's own, unconditional content rather than an "installed" optional one. So every one of its asset keys falls through to `AssetManager.placeholder()` (`src/managers/AssetManager.ts:464`) at runtime; there is no registered manifest to miss.

Nothing in `packs/reference/` looks copied from riot in the sense of leftover cruft — if anything it is leaner than riot by omission (no generator scripts, no tsconfig, no generated barrel, no assets pipeline). The one structural echo — the `data`/`code` split in `pack.ts` — is the shape `ContentPackData`/`ContentPackFactory` requires of any pack, not something borrowed from riot's own file layout.

## 6. Documentation that describes pack authoring

Root `docs/*.md` (`find docs -maxdepth 1 -name "*.md"` → 6 files):

| Doc | Classification |
|---|---|
| `docs/ADDING_SPELLS.md` (562 lines) | **Mixed.** The spell-runtime mechanism it teaches (factory shape, `castSpec`, activation/targeting, cancel policy, delivery, bounding boxes, typed assets, testing via `press()`, `Reach`) is engine-generic and would apply to any pack — roughly 9 of its 10 numbered sections. But almost every worked example names a `packs/riot/...` path or a specific Riot champion (Jhin, Janna, Diana, Sett, Syndra, Camille, Ekko, Jarvan — ~25 named mentions), and section 1 ("Research and register", ~17 lines) is entirely the Riot-Wiki import pipeline (`npm run ability:import`, `docs/abilities/<champion>/`). Rough split: ~90% transferable mechanism, ~10% Riot-specific pipeline and examples, but a rewrite for a generic pack would still touch nearly every code sample. |
| `docs/COMBAT_TEXT_PERF.md` (648 lines) | Engine. A specific performance investigation into `CombatText` merging and z-index; its many "champion" mentions are the generic `Champion`/`AIChampion` class names, not Riot content (`grep -niE "riot"` → 0 hits). |
| `docs/HARNESS-FIX.md` (275 lines) | Engine. A Playwright harness bug (`tests/e2e/harness.mjs`'s `finish()`); 0 Riot mentions. |
| `docs/PeerJs.md` (45 lines) | Engine/infra, unrelated to game content — PeerJS server setup notes; 0 Riot mentions. |
| `docs/PWA-UPDATE.md` (191 lines) | Engine. PWA update-prompt latency and chunk invalidation; its 2 "champion" mentions are about the generic per-champion chunking mechanism, not specific content. |
| `docs/VFX_STANDARD.md` (136 lines) | **Mixed, lightly.** The five rules and the rest of the standard are pure visual-design guidance, applicable to any pack's spell art. Only 4 of 136 lines name a specific champion (the `Fizz_E.ts` worked example, Jarvan/Anivia as contrast cases) — roughly 95%/5%. |

Beyond the root: `docs/abilities/` (`find docs/abilities -type f` → 752 files across 54 champion directories) is 100% Riot content — Wiki-imported ability data, already flagged in the batch-5 plan as belonging with the pack. `docs/spell-names-vi.json`, `docs/all-champions.jpg`, `docs/Health_bar_guide.webp` at the root are likewise 100% Riot (also already flagged there). `docs/league-server/` (3 files, 1656 lines) is third-party research notes about an unrelated League-of-Legends game server project — Riot-flavored but not pack-authoring documentation for this codebase; out of scope of the engine/pack split either way. `docs/superpowers/{plans,specs,surveys}/` (37 of the repo's 43 total `.md` files under `docs/`) is process documentation about this very extraction effort — meta, not authoring guidance, and not classified engine-vs-pack.

## 7. The `@/` alias problem

**Yes — and it typechecks silently.** Confirmed empirically: a throwaway file was added at `packs/riot/spells/__alias_probe__.ts` containing `import type SlowInternal from '@/game/gameObject/buffs/Slow'`, then `npm run typecheck --workspace=@moba2d/content-riot` (`tsc -p tsconfig.json`) was run — **exit code 0**, no error. The alias resolves because `tsconfig.base.json:54-56`'s `"paths": { "@/*": ["./src/*"] }` is declared in the *base* config, and TypeScript resolves a `paths` mapping relative to the config file that declares it (`tsconfig.base.json`'s own location, i.e. core's checkout) regardless of which config's `extends` chain pulled it in — `tsconfig.base.json`'s own header comment states this is deliberate, so a pack's compiler can see real types *through* `ContentApi.ts`'s own internal `@/` imports.

**What catches it, and where:** `npm run check-seams --workspace=@moba2d/content-riot` (`moba2d-check-seams ./spells`, backed by the `pack-core-boundary` seam, `src/seams/packCoreBoundary.ts`) — confirmed empirically on the same probe file: exit code 1, printing `pack-core-boundary :: ./spells/__alias_probe__.ts :: @/game/gameObject/buffs/Slow — a core internal named through an alias no separated pack can resolve`. This is a source-text import scan, not a type check. The probe file was then deleted and `git status --porcelain` confirmed clean.

**This gate is not in plain `npm run verify`.** Root `package.json:65`'s `verify` script runs only core's own `check-seams` (over `coreSpells`/`spellObjects`/`buffs`/`attackableUnits`); the pack's own `check-seams --workspace=@moba2d/content-riot` only runs under `verify:all` (`package.json:66`).

**A different form of the same mistake is caught immediately by `tsc` itself.** Writing the core internal as a package specifier instead of the alias — `import type { Game } from '@moba2d/core/game/Game'` (not declared in `exports`) — was also probed empirically: `npm run typecheck --workspace=@moba2d/content-riot` failed immediately with `error TS2307: Cannot find module '@moba2d/core/game/Game' or its corresponding type declarations`. `tests/content/packBoundary.test.ts:44-69`'s own doc comment documents the same asymmetry for core's *own* typecheck programs (re-measured by that comment's author during the batch-5 whole-branch review, not reproduced independently here): with `@moba2d/core/game/Game` planted at the top of a pack spell file that is actually reachable from `src/generated/installedPacks.ts`'s generated barrel, **both** `npm run typecheck` and `npm run typecheck:core` fail too, by ordinary import-following through `include: ["src/**/*"]` — but the same comment states the `@/`-alias form does not fail either of those, for the identical reason it didn't fail the pack's own `tsc`.

**Net measurement:** a pack today can write `@/<anything under core's src/>`, have it typecheck cleanly in every `tsc`/`vue-tsc` program in the repository (pack's own and core's), and be caught only by one source-scan step (`pack-core-boundary`, part of `moba2d-check-seams`) that is wired into the pack's own `package.json` `check-seams` script but only exercised repo-wide via `verify:all`, not `verify`. `tests/content/packBoundary.test.ts` no longer runs the scan itself (confirmed: it stayed green with the alias-form probe present) — it only asserts, by reading `packs/*/package.json`, that every pack in *this* repository still declares a `check-seams` script naming the CLI (3 assertions, all reading, no scanning) — a check with no population left to run once a pack becomes a separate repository.
