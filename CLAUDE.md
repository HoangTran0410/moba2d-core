# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

Every rule below is stated once, with the seam or test that enforces it.
**`docs/TRAPS.md` is the long form** — the measurement, the bug and the reasoning
behind each one. Read the matching section there before you change, argue with,
or undo a rule; each was found the expensive way, and none is visible from the
file you are editing.

## Which doc to read

| You are… | Read |
|---|---|
| about to undo or argue with a rule here | `docs/TRAPS.md` — the why, per area |
| writing a spell in `packs/reference/` | `docs/ADDING_SPELLS.md` — the three registration points, the `MissileSpellObject` base every skillshot extends, the buff catalogue's mandatory `stackId`, and the engine traps `tsc` cannot catch |
| writing a spell in a **content pack** | `docs/PACK_AUTHORING.md` first, then `ADDING_SPELLS.md` |
| designing VFX or tuning damage | `docs/VFX_STANDARD.md` |
| adding a stat, pricing an item, or asking "what does League do here" | `docs/STATS_VS_LEAGUE.md` — the researched comparison, the four deliberate divergences, and why Riot's item data must not be imported |
| touching the map editor | `docs/MAP_EDITOR.md` |
| onboarding a human | `README.md` |

`docs/COMBAT_TEXT_PERF.md`, `docs/HARNESS-FIX.md` and `docs/PWA-UPDATE.md` are
**finished investigations, not guides** — open one only when working in that
exact area. `docs/superpowers/` is dated plan/spec/report history: it records
what was true on its date, so cite it, do not treat it as current.

## Project

MOBA2D — a fan-made browser 2D game inspired by League of Legends. TypeScript +
Vite; p5.js draws the canvas, Vue 3 drives the HUD. Vitest for tests, Playwright
scripts (`tests/e2e/`) drive the real game in Chrome.

**p5 runs in global mode.** `createVector`, `push`, `fill` and the rest are
globals from a `<script>` in `index.html`, not bundled. All code touching a p5
global must run inside `setup()`, never at module eval time. `src/main.ts` is the
only entry point; in dev it exposes `window.__moba2d`, which is how e2e scripts
reach the running game.

## Running

```bash
npm run dev      # http://localhost:5173
npm run verify   # everything CI runs — do this before declaring work done
```

`verify` = `packs:check` + `assets:check` + `catalog:check` + `typecheck` +
`typecheck:core` + `typecheck:sw` + Vitest + `build` + `chunks:check` +
`check-seams`. `verify:all` adds the reference pack's own `check-seams`. **A
pack's own `npm run verify` is separate and this repository never runs it.**

**Content packs install at runtime, never at build time.**
`installRuntimePacks()` (`src/content/runtimePacks.ts`) runs during the loading
screen, reading `moba2d:packs:v1` (`installedPackStore.ts`) and seeding from
`DEFAULT_PACK_URL` once if that list has never been seeded. Nothing is compiled
in: CI's `verify:all` dist is the dist that ships.

`e2e:runtime-pack`, `e2e:packs` and `e2e:pwa` need a real pack `dist/` — a
sibling `moba2d-content-riot` checkout, or `MOBA2D_PACK_DIST`. **None of the three
run in CI.**

**PWA build facts that are load-bearing:**

- `predev`/`prebuild` copy p5 into `public/vendor/` (gitignored,
  `scripts/copy-vendor.mjs`); `index.html` loads it from there, not a CDN.
- Stats.js is **gone on purpose**. The frame rate is one `text()` call in
  `src/game/debug/FpsOverlay.ts`, behind the `fps` debug layer.
- `public/` is the only directory Vite copies verbatim — hence `favicon/`.
- **`src/sw.ts` is hand-written, not `VitePWA`-generated** (`injectManifest`).
  Workbox's router is first-match-wins, so **route order is the file's API**:
  precache is registered first, and a new route is appended at the bottom, never
  inserted above an existing one.
- `npm run e2e:pwa` checks the whole thing in a real browser with the network cut.

**Controls.** Right-click ground moves, right-clicking a visible enemy attacks;
`A Q W E R` abilities, `D F` summoners (`SpellHotKeys` in
`src/game/constants.ts`), `B` channels Hồi Thành, `Space` toggles camera follow,
`N` the nav overlay, wheel zooms, `Esc` opens the match-config panel. Recall is a
`Spell` but deliberately **not** in `spells[]` — it lives on `Champion.recall`;
that array is the kit's slot layout. **`Esc` does not leave the match** — the way
out is the exit button in the panel's Trận đấu tab, behind a two-step confirm.

## Code style

- **Prettier** (`.prettierrc`, 2 spaces, single quotes, 100 columns). Several
  files predate it and fail `--check` on `main`; **never run `--write` across
  them** as a side effect of an unrelated change.
- **Tuning values are exported constants** in the spell file, so tests import
  them. Retuning damage must not mean editing a test.
- **`Array.prototype.filter` cannot narrow types** — prototypes are polyfilled in
  `src/main.ts` before p5 loads, and `src/types/global.d.ts` puts the
  non-predicate overload first. Write a plain loop (`MatchDirector.bots()`), not
  a cast.
- **`<script setup>` *is* the setup function.** A `const x = ref(…)` at its top
  level is rebuilt on every mount. State that must outlive an unmount belongs in
  a plain `.ts` module (`src/game/hud/config/panelTab.ts`).
- **Spell design and VFX**: `docs/VFX_STANDARD.md` is the whole bar. Damage
  scales to a ~100 health pool (spells 15-35, ultimates 40-60) and ranges to this
  canvas, not raw wiki numbers; a dash or sweep hits each unit at most once via a
  `hitTargets` set. **Legibility outranks looking good.**

## Testing

`verify` is the gate. Beyond it, pick the cheapest tool that can see the bug:

1. **Vitest by default** — ~1800 tests in a few seconds. `vitest.config.ts`
   excludes tests reaching a content pack this checkout lacks
   (`scripts/pack-dependent-tests.mjs`); today that is 54 files / 458 cases.
   Re-derive the count from that config's own comment before assuming a missing
   file just moved.
2. **A source-scan test** for any "nobody may do X" rule — milliseconds, and it
   closes a class permanently. Models: `tests/game/spells/mana-spend-seam.test.ts`,
   `dash-onupdate-seam.test.ts`. **Strip comments before matching**, or the scan
   flags its own documentation.
3. **Playwright only for what Vitest structurally cannot see** — a real finger, a
   real renderer, the paused/unpaused frame boundary. Do not re-run neighbouring
   scripts for a change outside their area.

- **A Playwright script takes its boot from `tests/e2e/harness.mjs`.**
  `tests/scripts/e2eHarness.test.ts` enforces that an importer does not *also*
  start its own server or browser. The **gesture** stays each script's own.
  `drive-game.mjs` and `verify-pwa-offline.mjs` are out on purpose.
  `MOBA2D_CHROME_CHANNEL=` (empty) swaps in Playwright's bundled Chromium.
- **An `id` a script waits on must be an id `src/` can render.**
  `tests/scripts/e2eSelectors.test.ts` checks it in milliseconds, inside
  `verify`, because nothing else can: no Playwright script runs in the gate, so
  `#config-btn` survived its own deletion in eleven `page.click` calls across
  six files, each a thirty-second timeout nobody was there to see. The scan
  reads only the calls that *hang* — `click`, `waitForSelector`, `fill`,
  `$eval` — and ignores `page.$`, `isVisible` and `document.querySelector`,
  which is how a script asserts an absence on purpose. Reach the setup panel
  through `harness.mjs`'s `openSetup` and a match through `startMatch` rather
  than naming those ids again.
- **A script asserts its own screen and no other.** `drive-lan-lobby.mjs`
  checked the *menu's* button shape: a copy edit inside the LAN lobby then came
  back reporting a menu failure, and the check went on asserting a link that
  had been deleted, because nobody editing the menu thinks to read the LAN
  script. It lives in `drive-menu-flow.mjs` now.
- **Assert a prefix, not a sentence.** `drive-lan-lobby.mjs` checks
  `includes('Không kết nối được')` rather than the whole line, so rewording the
  rest of it costs nothing. Copy is the most-edited thing on any screen;
  structure — an id, a count, a class — is what a test should hold on to. And
  when the claim is *only* about structure or copy, a jsdom test in
  `tests/scenes/` reaches it faster than a browser can boot.
- **Every test must be shown to fail.** Write it, run it, *read* the message.
  Two shapes have shipped here repeatedly: asserting on state the code under test
  already produced, and a check that computes its expected value by calling the
  thing it checks. Prove an e2e script falsifiable **once, when it is new** —
  repeating that on every later change is the most expensive habit available.
- **Seed a probe at the boundary, not past it, and re-seed it.** One placement is
  an anecdote; a live match moves underneath it.
  `tests/e2e/drive-bot-discipline.mjs` (`npm run e2e:bots`) is the model — wrap,
  count, end in a numeric summary, no screenshots.
- **Known flakes, not worth chasing:** `drive-new-spells.mjs` (~1 in 4, `oScene`
  undefined) and `drive-touch-controls.mjs` (rare freeze), both only with a pack
  installed. Neither runs in core alone. A stray dev server on 5173 makes them
  likelier.

**Keeping a pass cheap** — `verify` is not the expensive part:

- **Do not fan out agents that share a briefing.** When N files need one
  standard, one agent reads it once. An audit agent reports `file:line` plus a
  sentence and **never quotes code back**.
- **Do not read screenshots in bulk.** A 1280x900 PNG costs about what 600 lines
  of source costs. Trust the numeric summary; open one or two to judge a *look*.
- **Do not pipe whole command output.**
  `npm run verify 2>&1 | grep -E "Tests |Test Files |error|FAIL"` is the entire
  signal; `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "\.vue'"` drops
  pre-existing SFC errors that are not yours.

## Architecture

`LoadingScene` → `MenuScene` → `GameScene`, routed by `managers/SceneManager.ts`
(not p5's). `MenuScene` also reaches `SetupScene`, `AboutScene`, `PacksScene` and
`LanScene`, each through a dynamic `import()`, each with its own `#…-scene` host
in `index.html`, its own stylesheet, and a `*BootPath` source scan holding it
clear of `src/game/`.

| File | Role |
|---|---|
| `Game.ts` | game loop; owns camera / objectManager / terrainMap / fogOfWar |
| `managers/ObjectManager.ts` | updates and draws every object; **two** quadtrees — `_objectsTree` for anything gameplay can ask about, `_decorTree` for particles and trails, which no query should page in. `draw` reads both, `queryObjects` only the first; `isDecoration()` is the closed list, and a `SpellObject` never belongs on it |
| `MatchDirector.ts` | every mutation of a *running* match, and the only thing that persists them |
| `render/hitFeedback.ts` + `AttackableUnit.presentHit` | how a hit *looks* — number size, body flash, camera shake, haptics — from one fraction-of-max-health table; the one door both the host's `takeDamage` and a LAN client's `dmg` stream go through |
| `config/matchModes.ts` | match modes as a *macro then overlay*: rules/world/bot count are written into the existing knobs (`applyMode`, `MatchDirector.setMode`), the mode's `MapTuning` is `mergeTuning`'d over the map's into `Game.mapTuning` at boot and `allRandom` is read by `planMatchKits`; `modeDrift` is how the chip admits its knobs moved; `rules.recall` is the brawl's one real rule, read at press time like CDR/URF |
| `render/deathCamera.ts` | where the camera goes while the player is dead: linger, then the ally in a fight (`lastCombatMs`) else the nearest, cycled by `SpectateBar.vue`; pure state machine over a 5-function context, wired as `Game.deathCamera`; never overrides the free camera (`camera.target === null`); the grey world is a canvas `filter` on desktop and a translucent `.dead-tint` quad on touch — a filter over a full-screen canvas hitches a phone on first use and costs a pass per frame |
| `combat/Announcer.ts` | the kill feed: runs, multi-kills, first blood, shutdowns, from `EventType.ON_DIE` (emitted once per death, on the transition, last thing in `die()`); forwarded to LAN clients as `ann` |
| `managers/MinionSpawner.ts` | wave clock for both bases; owns the live minion cap |
| `gameObject/map/Minimap.ts` | screen-space map; tap expands it, tapping the expanded map teleports |

Objects: `GameObject` → `AttackableUnit` (`Champion`, `AIChampion`, `Minion`,
`Monster`, `Turret`), plus `Fountain`, `SpellObject` and helpers
(`ParticleSystem`, `CombatText`, `TrailSystem`). Key enums in `game/enums/`:
`ActionState`, `StatusFlags`, `SpellState`, `EventType`.

### The menu and LAN

**Working in `src/game/net/` or the menu scenes? Read `docs/TRAPS.md` §
*Scenes, the menu and LAN* first** — six rules there, each one a shipped bug in
a lobby, and none of them guessable from the file.

The three that reach outside that directory:

- **The menu offers exactly two big buttons** — Chơi and Online — and
  **Chơi opens the match-config panel, not a match**. The panel's Bắt Đầu is what
  reaches `GameScene`, so an e2e driver takes two presses; `startMatch(page)` in
  `tests/e2e/harness.mjs` is the one place that knows it.
- **Joining waits in the lobby** (`game/net/lobbyJoin.ts`) and the live connection
  is *handed over* (`takeHeldRoom`), never dialled again — the host sends one
  hello. **Neither wait may reach `setTimeout` with `Infinity`**: it wraps and
  fires at once.
- **`rtcConfig` is async and takes the broker URL** (`src/game/net/iceConfig.ts`)
  because TURN credentials are minted by the broker; ICE servers cannot be added
  once gathering has begun. `?ice=none` is what the e2e passes.

### Content packs

This repository is `@moba2d/core`: the engine, plus one small bundled pack of its
own (`packs/reference/` — one champion, four abilities, one map, never optional
and never leaves). Every champion, spell, map and monster beyond that ships from
a separate content pack, installed as an ordinary npm dependency and reached only
through two published surfaces: **`api: ContentApi`** for a spell's own code, and
**`@moba2d/core/testing`** for a pack's tests.

**A checkout of this repository alone ships no Riot-derived pack, and never will
by design.** Do not assume any Riot-named champion, spell, map or asset exists in
`src/` or `packs/reference/`; `tests/content/vocabularyBoundary.test.ts` and
`tests/content/corePackTarball.test.ts` enforce it. Two pack traps that have cost
real time — **a runtime install mutates the registry in place** (compare
`PackRegistry.contentRevision`, not the instance) and **`bareCatalogId` narrowing
silently drops every non-`reference:` id** — are in `docs/TRAPS.md` § *Content
packs*, along with the handover doc for what moved out.

### Teams, lanes and minions

The player is Blue; initial bots alternate Red/Blue (player + 3 bots is 2v2) and
a bot added later joins the smaller side. A champion shares its base's fountain,
turret row and minions.

**Which turrets belong to which side is the installed pack's map data, not
something core hardcodes.** `lanes.ts` keeps only the mechanism (`LANES`,
`setActiveLanes`, `getLaneWaypoints`, `nextWaypointIndexFrom`); three waypoint
paths ordered blue → red, walked backwards by red minions.

**A wave musters at the muster slot the map declares** (`slots.minion`, one per
faction per lane, enforced by `content/validate.ts` at install).
`MinionSpawner.musterSlotFor` throws on a miss rather than falling back to the
fountain. Waypoint 0 of every lane is the fountain, so a hard-coded
`startWaypointIndex: 1` points *backwards* — `nextWaypointIndexFrom` projects the
muster onto the path instead.

**`tests/game/minions/Lanes.test.ts` does not run in an ordinary `verify`** — it
reaches the departed pack's map transitively, so it is a permanent
pack-dependent exclusion. Editing and re-running it proves nothing.

### The bot brain

`src/game/ai/` — one shared brain, no per-champion logic yet
(`docs/superpowers/specs/2026-08-19-champion-ai-design.md`).

| File | Role |
|---|---|
| `BotBrain.ts` | posture FSM (`RETREAT RECOVER DISENGAGE FIGHT SEARCH ENGAGE OBJECTIVE PUSH FARM ROAM`), spell scoring, aiming, cast follow-through, kiting; asks the pack's `ChampionAI` (`ChampionAI.ts`) at four points |
| `TurretThreat.ts` | pure ring maths: is this point in the guns, where is the nearest way out, where does this walk cross a ring |
| `TeamBlackboard.ts` | one snapshot per game per 250ms — allies, enemies, focus target, memory, lane buckets and lane assignments, jungle camps (`camps`), the team's `objective` call to an `epic` camp, and the `jungler` a team of 4+ bots spares |
| `LaneObjectives.ts` | pure lane maths: project a point onto a lane, score a lane's need, distribute bots across three |
| `AimPredictor.ts` | leads a moving target by projectile flight time |
| `Difficulty.ts` | three frozen profiles; every knob a tier changes lives here and nowhere else |
| `SpellRole.ts` | ability role bitmask, cached per constructor |

**Working in `src/game/ai/`? Read `docs/TRAPS.md` § *The bot brain* first** —
fifteen rules there, most of them a turret standoff or a feedback loop that a
single-tick test agreed with. The five that constrain code outside the directory:

- **One full-list walk, and `TeamBlackboard` owns it.** `objectManager.objects` is
  read exactly once in the whole directory, once per 250ms;
  `TeamBlackboard.lanes.test.ts` is a source scan that fails on a second read.
  Decisions run 4×/sec per bot, not 60.
- **Never aim at `game.worldMouse`** — on a phone that *is* the touch control.
  `AimPredictor` is the replacement; `bot-aim-seam.test.ts` bans `worldMouse`,
  `visionRadius` and `spendMana` from the directory.
- **Time is `Game.matchTimeMs`, passed in as `nowMs`.** Never a per-bot clock: a
  bot added mid-match starts at 0 while the blackboard is at 300000.
- **All three acquisition paths must gate.** `findAttackTarget`, `decidePosture`
  and `AIChampion.takeDamage` — the retaliation path — go through
  `BotBrain.mayFight(unit)`. Miss one and `BasicAttackController` re-issues
  `navigateTo(attacker)` every frame and undoes the other two.
- **Assert on a trajectory, not a destination.** A posture layer is a feedback
  loop, so a rule can be stable within one tick and unstable across two.
  `tests/game/ai/botTrajectory.ts` — `driveTicks(...)` returns a trace with
  `nearestApproachTo`, `reversalsAround`, `crossingsOf`, `countOf(posture)`.

### The match-config panel

`hud/config/MatchConfigPanel.vue` — **one panel, mounted in two places**: over the
menu (`SetupScene.ts`) and over a paused match (`InGameHUD.vue`, `Esc`). The seam
is `hud/config/MatchConfigSource.ts`, with two implementations —
`PregameConfigSource` (`moba2d:pregameConfig:v1`, `live` is `null`) and
`MatchDirectorSource`.

**Adding or changing a control? Read `docs/TRAPS.md` § *The match-config panel*
first.** Four rules bind it:

- **A control has to be served by both sources**, and
  `tests/game/config/matchConfigSource.contract.test.ts` is what stops them
  drifting back into two screens. **A fourth tab will not fit**: `.pregame-tab` is
  `flex: 1` and 390px holds three plus the close button.
- **`canEditMatchSettings` is a second capability flag** — not "is there a match"
  but "does *this device* own it" (`!isNetClient()`). **The refusal lives in the
  source, not only the tabs**: `v-tap` fires on a disabled `<button>`.
- **The shared panel must not import a `src/game/` runtime value** — it is mounted
  over the menu, and one such import drags the whole match into the menu's chunk.
  `MatchDirectorSource.ts` is the single exempt file;
  `tests/scenes/matchConfigChunk.test.ts` and `pregameBootPath.test.ts` hold it.
- **The panel holds the match paused**, so nothing has settled: read both
  `objects` and `_objectToBeAdd`, skip `toRemove` and deactivated entries, and
  clamp derived stats at the point of change rather than trusting `update()`.

## Traps that have cost real time

One line each; **`docs/TRAPS.md` carries the measurement and the bug for every
one.** None is visible from the file you are editing.

This list is a summary and **never the only copy**. Because it is loaded every
session it is the cheap place to add a lesson and the easy place to forget to
carry one over — which is how the deep file quietly ended up the *smaller* of
the two on healing reduction and on penetration, with nothing saying so.
`tests/docs/trapsSuperset.test.ts` now refuses that: every symbol named here
must be findable there. Add to `docs/TRAPS.md` first, summarise here second.

**Rendering and VFX** → `docs/TRAPS.md` § *Rendering, VFX and z-index*

- **`GameScene` calls `preventDefault()` on every touch on the page**, so
  **every HUD control needs a touch handler beside its click handler**, and a
  scrollable panel body needs hand-rolled scroll. `RulesTab.vue`, `RosterTab.vue`.
- **An effect that reaches beyond its caster's body must be a `SpellObject`, not
  `castSpec.vfx`** — VFX drawn from `Champion.draw()` vanishes when the caster is
  culled while the damage still lands. Aim telegraphs are the exception.
- **p5 global mode means ordinary English words are functions** — `pop`, `text`,
  `fill`, `line`, `point`, `random`, `map`, `scale`, `rotate`, `image`, `color`.
  A local of the same name silently shadows one and **`tsc` cannot see it**. Name
  locals for what they mean in the effect.
- **A `SpellObject` that paints past its own centre needs
  `getDisplayBoundingBox()`** — the default derives a zero-area box.
  `aoe-display-bounds.test.ts`.
- **Ground art must name the ground layer.** `Z_INDEX_MAP` is keyed by *exact
  constructor*; a subclass with no `zIndex` resolves above champions. A pack
  reaches the values through `api.layers.GROUND_Z_INDEX` — never a magic number
  on either side. `ground-decal-zindex.test.ts`.

**The two clocks and the frame budget** → `docs/TRAPS.md` § *The two clocks, and the frame budget*

- **The simulation must never read `deltaTime` for its own step** — that is p5's
  *render* delta, and the sim is a fixed 60Hz loop of its own. Reading it made
  the 30 FPS setting run the whole game at **double speed**.
  `Game.update` substitutes the global around the tick; `simulationClock.ts`.
- **`auto` quality means "is this machine keeping up", not "is this a phone"** —
  `render/renderStress.ts`, fed from `Game.draw`, measured against the cap the
  player chose, with two thresholds so it cannot oscillate.
- **Never key a render cache on the camera** — a walking player invalidates it
  every frame, which is exactly when the work costs most. The fog measured a
  19% hit rate that way. `FogOfWar.performance.test.ts`.
- **Baking static art into a buffer does not make a translucent disc cheaper** —
  the blit fills the same pixels, and a supersampled buffer is *slower*. When
  fill is the cost the fix is the art, not the code: the fountain's widest disc
  became a rim, which is cheaper *and* says where the healing stops.
- **Quote no render number that was not measured interleaved** —
  `tests/e2e/measure-frame-cost.mjs`, `measure-sim-clock.mjs`.

**Combat seams** → `docs/TRAPS.md` § *Combat seams*

- **Match rules are read live, and only through their seam**: `Spell.effectiveMana()`,
  `spendMana()`, `cooldownMultiplier`. Touching `stats.mana` silently opts out;
  `mana-spend-seam.test.ts` bans the name. **Granting is not billing** — a refill
  is `AttackableUnit.restoreMana()`, beside `takeHeal()`.
- **Use `Dash.onDashUpdate`, never `dashBuff.onUpdate = …`** — an instance
  assignment replaces the movement frame instead of hooking it.
  `dash-onupdate-seam.test.ts`.
- **A query that picks a unit must ask whether the caster can see it** —
  `PredefinedFilters.visibleTo(observer)` over `combat/Vision.ts`. **Not
  `visibleToPlayerTeam`**, which is the fog's own flag, written from *the
  player's* eyes. `target-vision-seam.test.ts`. Two boundaries: **vision gates
  acquisition, never damage**, and **distance is not vision's business**
  (`Reach.ts` owns range).
- **A permanent stack is paid for by the corpse, not the hit.** Latch `wasAlive`
  before `takeDamage`, read `isDead` after. `combat/ExecuteTargeting.ts` gives
  lethal-first targeting; lethality counts shields; skillshots stay out.
- **`Champion.score` is a getter** over `combat/MatchTally.ts`. What a kill is
  worth is `killCredit` on the victim, not an `instanceof` at the crediting site
  — and **`Pet` needs `'none'` explicitly** because `Pet extends Champion`.
- **A taunt must leave `CAN_ATTACK` and `CAN_MOVE` alone** — the one control
  effect that does. `StatusFlags.Taunted` is in exactly one of the three lists in
  `Stats.updateActionState` (CAN_CAST); the buff writes through
  `AttackableUnit.forceAttackTarget` and re-issues every frame.
- **Reacting to a hit is not modifying it.** `Buff.modifyIncomingDamage` runs in
  insertion order and only sees what reaches it; `Buff.onDamageTaken(swung,
  landed, attacker)` runs after the whole chain. `DamageReflect` lives there, with
  a re-entrancy latch.
- **Ability damage scales with the caster's build, and you write none of it.**
  `stats.abilityPower` (a *fraction*) amplifies in `takeDamage` via
  `combat/Amplification.ts`; `stats.abilityHaste` shortens in
  `Spell.reducedCooldown`. Both default to 0. What counts as an ability is
  `Spell.damageScalesWithAbilityPower` (defaults true, inherited at construction)
  — **not `countsAsAbilityCast`**, which gates cooldown reduction only.
- **Ability haste is *points*, not a fraction** (`Stats.hasteCooldownMultiplier`,
  `100 / (100 + haste)`). It replaced a capped `cooldownReduction` fraction for
  the reason League replaced its own: casts per second is linear in haste, so
  every point is worth the same, no cap is needed to stop a zero cooldown, and
  a shop can price it. `abilityHaste: 25`, never `0.25` — the shared pack rule
  in `src/testing/itemRules.ts` refuses the second.
- **`ON_ATTACK_HIT` is basic attacks only** (`combat/BasicAttack.ts` is the sole
  emitter), so an effect hung there is invisible to every spell. For "someone
  damaged me", use `Buff.onDamageTaken`; for "I damaged someone",
  `Buff.onDamageDealt(swung, landed, victim, type)`, which walks the *attacker's*
  buffs from the same funnel and is the only hook a spell's damage reaches.
- **A resistance is answered by a share, never by points.** `armorPenetration`
  and `magicPenetration` are fractions read in `combat/Mitigation.ts`
  (`effectiveDamage(damage, type, target, attacker)`), and they **never touch a
  resistance that is already negative** — a shred put it there, and a share of
  a negative number undoes it. `tenacity` is the same idea for crowd control,
  applied once in `AttackableUnit.addBuff` against `CROWD_CONTROL_FLAGS` and
  only to what somebody *else* landed.
- **Healing reduction goes through `combat/Healing.ts`, and health enters the
  pool by two doors.** `AttackableUnit.takeHeal` is one; `Stats.update`'s
  `healthRegen` is the other, which is why `update()` takes the multiplier as an
  argument. A cut that reached one and not the other would be no cut at all. The
  strongest live `Buff.healCut` wins — they never sum — and a shield is not a
  heal, so `buffs/Shield.ts` is untouched by any of it. `stats.healingReceived` is
  the same multiplier the other way and composes with the cut multiplicatively,
  so the order the two arrive in cannot change the answer. **A shield is
  counted separately** (`combat/Shielding.ts`, applied in `Shield.onCreate`
  before `_initialAmount`): a cut there reaches only shields granted *while* it
  is on, never one already standing.
- **A `UNIT` targeting spell must declare `targetingRequest: { targetTeam: 'ENEMY' }`
  (or `'ALLY'`), validate `context.target`, and override `press()`.** Omitting
  `targetTeam` defaults `TargetResolver` to `'ANY'`, which includes the caster —
  the spell then dashes to and damages its own caster.

**Geometry, navigation and vision** → `docs/TRAPS.md` § *Geometry, navigation and vision*

- **Ask `wallOutlinesInArea(game, area)`, not `terrainMap`** — spell-made walls
  are `SpellObject`s. A new slab implements `DynamicWall` and is picked up free.
  `DynamicTerrain.test.ts`.
- **`CollideUtils.lineRect` misses a segment lying wholly inside the rectangle**,
  so **a `Line` is a lossy quadtree query area.** Use a bounding box.
- **A conservative approximation whose error matches the feature size is wrong**,
  not conservative — measure the real distance where you decide anything.
  `NavGrid.test.ts`.
- **A direction must never be `(0,0)`.** `Game.facing()` is private and answers
  for *the player's own champion* only; the convention is `Spell.aimPoint` with
  `VectorUtils.getVectorWithRange` / `getVectorWithMaxRange`. `context.direction`
  is itself `(0,0)` on the origin, so falling back to it is the bug.
- **What the team can see is not what is worth painting.** `visibleToPlayerTeam`
  is narrowed to the camera; `revealCircles` is every ally. Narrowing both
  together deletes allies from the minimap.
- **Granted sight obeys walls, and both halves must agree** — the painted polygon
  and `FogOfWar.grantedEyeSees`, which is `Vision.viewIsClear` line for line
  (copied, not imported: a fourth exported name on `Vision` is a `contract:bump`).
- **Hold a wall-shaped `SpellObject`'s centre a half-thickness plus a body radius
  from its caster** — a body inside the wall is ejected to its *nearest* face,
  which past the midplane is the far one.
- **Smoothing must be per unit of time, never per frame.** `position.lerp(target,
  0.1)` makes speed a function of frame rate, and the jitter reads as motion
  sickness. `Camera.smoothingFor` is the conversion.

**Build and packs** → `docs/TRAPS.md` § *Build, chunks and the service worker*, § *Content packs*

- **The remaining chunk-hash cascade is not worth breaking** — a one-line edit
  under `src/game/` re-hashes ~400KB, and both obvious fixes measure worse.
  `npm run e2e:chunk-cascade` is the measurement.
- **A runtime pack install mutates the registry in place**, so the registry's
  identity is not a cache key — compare `PackRegistry.contentRevision`. **A test
  only sees this if it reads the list *before* installing.**
- **"The bundled pack" is no longer where the content is.** A stored id is bare
  (`'Flash'`) and the registry's is qualified (`'riot:Flash'`); a lookup matching
  those two has to say so — see `summonerIdOr`.

**Working alongside other agents**

- **Concurrent agents share one working tree.** `git stash` takes another agent's
  uncommitted work with it. Use `git worktree`, and commit with explicit paths —
  **never `git add -A`, never `.`, never a bare `git commit`.**

## Assets, maps and tools

- **Core ships one map's coordinates** (`packs/reference/provingGroundsGeometry.ts`)
  and no map data in `assets/` at all. Every map's `wall`/`bush`/`water` polygons,
  turret rows and lane waypoints live in whichever pack ships that map, fetched
  lazily so a picker never downloads walls to list a name.
- **Everything else loads through `AssetManager`** (`src/managers/AssetManager.ts`).
- **`npm run assets:generate` writes `src/generated/assetManifest.ts`** and its
  typed `AssetKey` union, so a mistyped name is a compile error. **Never
  hand-edit the generated file** — add the image and re-run; `assets:check` fails
  the build on drift. A pack has the identical pair, held apart by the
  `pack-asset-key` seam.
- **Ability data, the Riot Wiki import pipeline and the `vi_VN` name sync are gone
  from core**, into the content pack's own repository. `packs/reference/`'s tuning
  is hand-authored.
- `tools/shape-maker/` is a standalone p5 app for polygon point arrays (`a` add,
  `d` delete, `e` export, `i` import).
- **The map editor is not in `tools/`** — it is `src/mapEditor/*.ts`, a second
  Vite entry (`map-editor/index.html`) shipped as its own document. It is
  typechecked with the rest of `src/` and **can import core** (`ui.ts` takes
  `TUNING_SCHEMA` from `@/game/config/tuningSchema`) — import rather than copy
  a constant into it. Only `css/`, the tracing images and two classic-script
  libs stayed under `public/map-editor/`. Being a separate *document* is what
  still limits it at runtime: **two `localStorage` keys are the whole
  contract**, `moba2d-local-maps-v1` out to the game, `moba2d-pack-maps-v1` in.
  `tests/content/localMaps.test.ts` and `editorCatalog.test.ts` hold them by
  importing the real editor. **The
  editor owns the map screen**, and **Chơi thử opens a new tab** — its undo
  history is memory-only. `docs/MAP_EDITOR.md` is the guide.
- **A pack's build tooling is core's, invoked by name — never copied.** Ten
  bins today; `moba2d-check-core-link`, `moba2d-check-unused` and
  `moba2d-write-manifest` were the last three files `moba2d-pack-new` copied
  into a pack, and every copy that existed had drifted. The manifest writer
  was the expensive one: one pack hardcoded `icon: 'icon.png'` where the
  template tests for the file (a published manifest pointing at a 404 the day
  somebody deletes it), and `coreRange` was a literal there *and* in the
  pack's `data.ts` — it reads `data.manifest` now, so the floor is stated
  once. `--name=` is the one value still passed in: `PackManifest` has no
  display-name field, and `data.manifest.name` wins when a pack grows one.
  **`check-unused` runs the pack's own `typescript` via `node`, not `npx
  tsc`** — npx falls back to macOS's Turbo C++ `tsc`, which prints a joke and
  exits 0, and the check reported clean over a compiler that never ran.
- **A pack ships an editor export through `moba2d-generate-maps`**
  (`scripts/generate-maps.mjs` + the `scripts/pack-maps.mjs` bin), never by
  committing the export as-is. It writes `<name>.geometry.json` (minified,
  exactly `terrain`/`slots`/`lanes`) plus a polygon-free `mapMeta.ts`, and
  **never copies `id`** — an export's `id` is the name it was drawn under, and
  one riding a `{ ...summary, ...geometry }` spread into `Game.activeMapId`
  made a whole map unjoinable over LAN (`src/content/activeMap.ts` is the other
  half of that fix). Deliberately **not** wired into `moba2d-pack-new`, whose
  map is hand-written TypeScript with no export to read.
