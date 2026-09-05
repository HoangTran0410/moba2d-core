---
name: moba2d-naruto-pack
description: "Naruto pack project — core mechanics, art findings, and the drawing traps four more champions cost to learn"
metadata: 
  node_type: memory
  type: project
  originSessionId: b3ce1cc5-de47-4039-9404-1d052ea7f0f4
  modified: 2026-09-01T11:55:33.407Z
---

Started 2026-09-01. Third content pack after `lol` and `dota`: 12 champions, one map, on branch `feat/terrain-zones-and-stances` in `moba2d-core`. Spec at `docs/superpowers/specs/2026-09-01-naruto-pack-design.md`. Split into **Plan A** (core mechanics, in core) and **Plan B** (the pack itself, a new `moba2d-packs/naruto` repo) — B is blocked on A publishing.

**Core was already 1.19.0 on main when this started** (commit `dde02bc`, same day) — an early read in the session said 1.18.0 and was wrong, so `contract:bump` for this work lands on **1.20.0**. Main appears to move under long sessions; re-read the version rather than trusting a note.

**Two mechanics landed, both green (3905 tests, 341 files):**

`TerrainZone` — a tagged region that is deliberately *not* a fourth terrain layer. Lives **beside** `MapGeometry.terrain`, not inside it, and carries its own polygons in the same object. Beside, because the three-key contract then never changes: `wallPolygonsOf`, validate's unknown-layer check, `MonsterRoam.layer` and the editor's `LEGACY_KEYS` all needed zero edits. Own polygons, because the first draft keyed a `Record<string, Point[][]>` by id and that is two lists to drift. Zones go in a **separate quadtree**, never `TerrainMap.obstacles` — `FogOfWar`, `NavigationSystem` and `DynamicTerrain` all read that one, and a sand patch reaching them blocks sight or bends pathing. `affectsSpeed` must be OR-ed from zones *after* they are built, since `resolveTerrainTuning` only ever sees `map.tuning`. In `drawZones`, naming a loop variable `vertex` shadows p5's global `vertex()` — the exact function the line calls.

`Champion.enterStance/exitStance` + `Spell.suspend()` — form-swap (Nidalee/Jayce shape). **The trap worth not rediscovering:** `Champion.replaceSpell` existed and had no callers, and it is the wrong seam — it routes through `removeSpell`, which calls `onRemoved()` (sweeps every buff naming the spell as `sourceSpell`) *and* `deactivate()` (which calls `resetCoolDown()`, so toggling a form is a free cooldown reset). `suspend()` is `deactivate()` minus the reset. Both spell sets stay alive; the dormant one freezes for free because `update()`/`drawVfx()` walk `spells[]`. `exitStance` hands back the same **instances**, which is what makes a hand-built kit (R from one champion, QWE from another) restore correctly. Per-form cooldowns are free for the same reason. The HUD and net layer needed **no** changes: `hudState.ts` builds the bar from live `player.spells` each frame, and `HostSession`/`ClientSession` address casts and cooldowns by slot **index**, not by class.

**Art findings (measured, not guessed).** Champion portraits from `naruto.fandom.com` MediaWiki API crop well — they are infobox shots already framed on the face. Jutsu screenshots do **not**: they are 1920x1080 cinematic frames, and a centre crop to 128px gave a black smudge for Amaterasu and an orange smudge for Susanoo, 3 of 4 unusable. So portraits are fetched (via the `import-art.mjs` pattern from the dota pack: hash + `source-manifest.json` + `art:check`) and the 54 ability icons are **AI-generated** by the user from `moba2d/naruto-icon-prompts.md`, which carries one shared STYLE block — that block is the only thing making 54 icons look like one set. `prop=pageimages` is not enough: it returns Part I (child) versions for Naruto/Sasuke/Sakura and white-background game renders for Zabuza/Haku/Itachi/Deidara, so file titles are hand-picked in a `ROSTER` table like dota's. Itachi and Deidara are still white-background; swapping them is one line.

**Net + seam landed too; core is now 1.20.0, contract 20** (`contract:bump` run 2026-09-01), full `npm run verify` green. The stance wire copies `BagEvent` exactly — diff in `discover` **and** carried in the hello, because a diff only speaks on change and a champion already transformed before a client joined would never announce it. Signature includes the spell ids, not just the stance id, and `null` gets its own marker rather than folding to `''`. The client side must be async (a form's abilities are their own lazy chunks) and therefore needs a generation guard on **both** the enter and the exit branch. `api.terrain.zoneIdsAt/inZone` take `game` like `wallOutlinesInArea` and answer "no zones" for a world with no map — `SpellWorld` from `testing/spell` has no `terrainMap`, so a pack reaching `game.terrainMap` directly breaks in its own tests. **Watch out:** adding a ContentApi import from a module pulls that module into `tsconfig.strict-core.json` (`typecheck:core`, which `vue-tsc` does not cover) — importing `TerrainMap.ts` there exposed a pre-existing implicit `any`.

**Read `moba2d-core/docs/VFX_STANDARD.md` BEFORE writing any spell's `draw()`** — the first cut of Naruto's seven ignored it and the user reported exactly what the doc predicts: "vừa nhanh, vừa khó nhìn, ko có trailing", "hiệu ứng onhit ko thấy gì". What it costs to skip: missile speeds were ~2x too fast (skillshots want ~9-11, not 19-24); `MissileSpellObject` already has a `trailSystem` field it adds itself in `onAdded` and nobody had set it; impacts must spawn particles **on the victim** (`target.position`), not at the missile's last position; `draw()` needs layers + a hard rim on the real hit radius + easing off a normalized `t`, and randomness seeded once in `onAdded` (`random()` in `draw` flickers). `api.helpers.PredefinedParticleSystems` has exactly four presets: randomMovingParticlesDecreaseSize, ripple, smoke, heal. Pack-shared helpers live in `spellVfx.ts` at the pack root.

**A transform must be legible to the enemy.** Two places, both needed: `Champion.avatar` is a plain settable field (swap it, and put the *saved* one back — a hand-built kit has no roster entry to re-read), and an in-world aura that is its own `SpellObject` using `attachTo(unit, buff)` — never drawn from the buff, because `Champion.draw()` is skipped for a culled or fogged caster and the viewer who most needs to see the form is the one across the wall.

**The phases rule now lives in `docs/VFX_STANDARD.md`** (added 2026-09-01, core commit `242dc2d`): anticipation → climax → **dissipation**, and dissipation is the one everyone skips. Never `toRemove = true` on the frame an effect deals damage; a lingering area's fill dies first and its **rim last** (the rim is what was stating the radius); a charged ability must charge visibly on the caster. The worked example is the Naruto pack's Rasengan — three objects (`Naruto_Q_Charge` / `Naruto_Q_Object` / `Naruto_Q_Vortex`) because the phases outlive each other. Charge spells: override `castSpec` with `activation: 'HOLD_RELEASE'`, `charge: { maxDurationMs, releaseAtMax }`, `interrupts: SpellForm.AIMED` (walking survives, CC does not), `resource.commitAt: 'release'`; hooks are `onCastStart`/`onChargeUpdate(ctx, ms, ratio)`/`onRelease`/`onCancel`/`onComplete`, and cleanup **must be idempotent** because the runtime can route one hold through `onRelease` *and* `onComplete`. Test helpers: `pressSpell`/`releaseSpell` from `@moba2d/core/testing/spell`.

**`Champion.spells` is `[attack, Q, W, E, R, D, F]` — slot 0 is the BASIC ATTACK, not Q.** `preset.ts` says "every kit has it in slot 0" and `SpellHotKeys` is the same list as keys. The first `enterStance` took an array and filled from index 0, so a transform meaning Q/W/E replaced attack/Q/W and shifted the kit one slot left — invisible to types (both are just `Spell`) and invisible to its own tests, which built a four-spell kit with no basic attack in it, i.e. exactly the shape that hides the bug. Core now publishes `SpellSlot` (in `src/game/constants.ts`, exposed on `api.enums`) and `enterStance(id, Record<slot, Spell>)` is slot-keyed; `StanceEvent` carries `slots: Record<string,string>` and the signature sorts them (`Object.entries` is insertion-ordered, so an unsorted join re-sends every rebuild). **Any test that builds a `spells` array by hand must include a slot-0 stand-in** — `tests/_units.ts` has `basicAttackStub`. Core is **1.21.0** after this.

**A bot will not press an ability core's `inferRoles` misreads — and it fails silently.** Bots never transformed with either ultimate: not blocked, just out-scored. The ultimate was castable, in reach and scored **5.8** while an ordinary Q scored **14**, so the bot picked Q every time it was up. `inferRoles` reads *every* `SELF` cast as `Buff | Shield` and deliberately refuses to guess `Dash` or `Summon` (a wrong `Dash` guess makes a fleeing bot run at its pursuer). `Spell.aiRoles` is the field for saying so and core's docs note nothing had ever set it. Tagging both transforms `Buff|Burst` took the score 5.79 → 14.06. Tag `Dash`/`Cc`/`Summon` by hand; leave ranged DIRECTION skillshots untagged since inference already gives them `Damage|Poke|Burst`. Score constants: DAMAGE 10, POKE 6, BURST 14, CC 12, SUPPORT 20, BUFF 5, ZONE 8, ULTIMATE 6.

**Minion health is 70 / 45 / 150** (melee / ranged / cannon, `tuningDefaults.ts`) — size waveclear against those, not against other abilities. Core's 15–35 band means no single band-compliant hit one-shots a caster, so clear comes from area plus repetition; a *charged* ability is the stated exception and is priced like an ultimate. `tests/waveclear.test.ts` pins the thresholds.

**Read `docs/ADDING_SPELLS.md` before writing a spell, not after a bug report.** Three rounds of rework on this pack were all things it already states. Its most load-bearing lines: *write the script first* (what the player sees, one line per interaction — those become the test names); `castSpec` is **read once on the first cast and frozen**, so it must be built from constants only; `RECAST` gives exactly one recast unless `active.recasts` says otherwise; and **`onRecast` is handed the context of the OPENING press — aim repeats with `this.aimPoint`, never the context argument** (that one was live in Naruto's clone-command W). It also has a table of which rules are test-enforced versus prose — the prose ones are the ones that have all been broken.

**Two particle traps.** `impactBurst`/`ParticleSystem` from inside a `Spell` (not a `SpellObject`) never renders unless you `objectManager.addObject` it yourself — `useParticles` only exists on `SpellObject`. And `ParticleSystem.autoRemoveIfEmpty` defaults true and applies on the first update, so fill it **before** handing it to the world.

**Buff field names that are easy to guess wrong**: `DamageOverTime.tickInterval` (not `tickIntervalMs`), `HealCut.healCut` (not `percent`), `Shield.amount`/`_initialAmount`/`shieldAmount`, `Pet.underOrders` (not `commanded`), `Pet.onExpire` (the parting-gift hook; `die` is only the killed path).

**Draw shapes in `naruto/tools/preview-shape.mjs` before porting them into a spell.** Kurama Arms shipped twice looking nothing like an arm while typechecking and passing tests — a shape cannot be reviewed by reading it. What three rendered rounds established, and what generalises: a limb reads at ~6× its shoulder width (10× is a whip); an elbow needs **two arcs meeting at a joint**, because one smooth bezier always reads as a tentacle; a top-down limb bends *sideways*, never sagging (there is no down); fingers must root along a **knuckle line**, not radiate from a point (that is a mace), and must be near-parallel boxes with round tips, not tapering triangles (that is a claw); a palm is **flat** — wider across than along — since a circle is a ball on a stick. Harness gotchas: ImageMagick ignores three-argument `rotate(angle cx cy)` and flings the element away, and `<text>` without a font makes it refuse the whole SVG.

**A champion's mana pool is 500 and no pack can change it** — `Stats.ts` defaults it and `ChampionDefenceTuning` carries health/healthRegen/armor/magicResist but **no mana field**. Any upkeep or drain mechanic has to be sized against 500 or it can never fire: Kurama Mode's first cut charged 6/s (90 over 15s + 100 to cast) so "run dry and it ends" was arithmetically impossible, the form always ended on the timer, and the player read the ending as arbitrary. 22/s makes both endings reachable. Also: there is no chakra/energy bar on screen, so name a cost after the blue bar ("năng lượng"), never after a resource the UI never shows.

**Description colour vocabulary** (`styles/hud.css` + tokens in `styles/main.css`): `.damage.physical` #ff923e, `.damage.magic` #b07aff, `.damage.true` #5fd8f5, bare `.damage` = plain emphasis (not a mitigated figure), `.heal` #6ee787, `.buff`, `.time` #c1ffb6. The three damage hues are `DAMAGE_TEXT_COLOR` as hex, so the tooltip number matches the number that floats off the health bar — tagging by vibe makes the tooltip disagree with the game. `takeDamage(amount, owner)` with two args is `DEFAULT_DAMAGE_TYPE` = **MAGIC**. A tagged `.damage` is a *claim*: the HUD rescales it by ability power, so never tag a cost or a duration. `tests/spellDescriptions.test.ts` guards all of it.

**Two HUD/test traps.** A spell with no `image` is **not in the spell bar at all** — core's `hudState.ts` `buildSpells` filters on `i?.image?.path`, so it casts fine and is invisible; `tests/spellIcons.test.ts` now guards it off `generated/spellCatalog.ts` (verified red by removing an icon). And the scaffold's `vitest.setup.ts` passes `assetManifest: {}`, which takes down every test in the pack the moment any spell declares `image = api.asset(...)`; pass the real generated manifest (the dota pack carries the same note).

Remaining in Plan A: **only** the map editor zone palette — the grindy 60% of the zone work, since `KIND` in `state.ts` is a fixed one-colour-per-type table while zones are pack-declared, so it needs a single `zone` kind carrying `props.zoneId` plus a palette panel across `state/commands/ui/render/storage.ts`. Deliberately deferred: it is needed only when actually drawing the map, not to build the 12 champions, so Plan B can start first. See [[moba2d-workspace-layout]] and [[moba2d-core-subpath-and-map-rules]].

## Fog and attached effects (core `6e7fefa`, 2026-09-02)

`ObjectManager.draw` applied fog to `AttackableUnit` **only** — every
`SpellObject` drew straight through it. Reported: an aura visible where the
champion was not, which is worse than no fog (the enemy learns the position
but not that it is a champion). Fixed engine-wide with
`GameObject.visionAnchor` (null by default; `SpellObject` returns its
`attachTo` anchor), so all 8 body-riding naruto effects were fixed without
touching a pack file. Cost: one property read for non-unit drawables only.

An unattached effect still draws through fog on purpose — a skillshot in
flight is meant to be seen.

## Granting sight from a spell (2026-09-02, naruto `7b53be5`)

`FogOfWar.fogRevealOf` reads `visionRadius` off **any** object, not only
units, and casts the same wall-aware polygon it casts for a champion. So a
`SpellObject` grants team sight by carrying one number — no ward, no buff, no
timer — and **the object's own lifetime is the window**. (The lol pack's
`Ashe_E.vision.test.ts` is the reference; that bug was the hawk being dropped
because `fogRevealRadius` is an `AttackableUnit`-only getter.)

`SIGHT` in `spellVfx.ts` holds the band beside `RANGE_BAND`: IMPACT 250,
BLAST 320, ZONE 300, MARK 200, all under `RANGE_BAND.ABILITY` so nothing
lights further than it can reach. Deliberately dark: clone smoke, Kurama
cloak, sage eyes.

Two traps: every `GameObject` starts at `visionRadius = 0`, so "grants
nothing" asserts against **0, never undefined**; and a `SpellObject`'s team
comes from its constructor `owner`, so `new AmaterasuFlame(this.owner)` is
Sasuke's team even though it `attachTo`s the victim — which is what makes the
flame reveal the person carrying it.

## Published (2026-09-02)

Pack repo is `github.com/moba2d-packs/naruto` — public, branch **main**
(the local checkout was on `master`; renamed to match `lol`/`dota`), Pages
enabled with **Source: GitHub Actions**. Live at
`https://moba2d-packs.github.io/naruto/manifest.json` (2 champions, 1 map,
`coreRange >=1.21.0`).

**The trap that made the first CI run red, and it is structural.** A pack's
`npm run verify` passes locally *because the dev-link symlink points at the
local core*; CI installs `github:moba2d-game/core#main` fresh. So a pack that
uses an unpublished core symbol typechecks at home and dies in CI — here
`api.enums.SpellSlot` and `Champion.enterStance` in `spells/Sasuke_R.ts`,
against a published core still on **1.17.0**. **Push core before pushing a
pack that depends on new core.** Core 1.21.0 (23 commits, branch
`feat/terrain-zones-and-stances` fast-forwarded into main) is now on main;
its Cloudflare deploy is green.

Push recipe for core while packs are linked: `npm run pack:unlink -- --all`
(core's `verify`, which the pre-push hook runs, refuses while linked), push,
then `npm run pack:link -- ../lol ../dota ../naruto` to restore — `pack:link`
takes several paths in one call and regenerates
`src/generated/installedPacks.ts`, which is tracked and must never be
committed while linked.

**README, `pack.ts`'s header and the shelf entry are done** (naruto
`2d7aa74`, core `8eb2ee2`, both 2026-09-02). All three had been stale
scaffold prose claiming one champion, "the same bolt four times", and a
`coreRange` justified by elemental groves built from `TerrainZone` — the map
has no zones at all. The floor is really about `Champion.enterStance` +
`SpellSlot`. Core's `SUGGESTED_PACKS` now lists naruto with no `icon`, since
this pack's build publishes no `icon.png` the way lol and dota do.

**Still open:** `map.ts` / `geometry.ts` are the scaffold arena — one wall
band, one 200px gap, no turrets, no camps, no zones. That is the largest
remaining piece, and it is the same work as the deferred map-editor zone
palette. No items, no monsters, ten roster slots empty.

**CI timing, so a wait is not read as a hang:** core's Build spends most of
its wall clock *queued*; `run_started_at` is when it actually begins, and
execution is only a few minutes. Poll with
`gh api repos/.../actions/runs --jq '.workflow_runs[0]'` and compare
`run_started_at`, not elapsed time since the push.

## Art pipeline, extended for URL sources (naruto `80cee8c`, core `7149a9e`, 2026-09-02)

The pack shipped with **lettered placeholder icons** — `scripts/placeholder-icons.mjs`
draws a tinted disc with two letters (RS/KB/SM/KU…) for every ability with no
art, and it **never overwrites**, so dropping a real icon in and re-running is
the whole workflow. Naruto's Q/W/R are now real art; the other eleven are still
placeholders, so a real icon visibly does not match its neighbours yet.

Art from a URL goes through `scripts/import-art.mjs`, never saved by hand:
`ICON_SOURCES` (ability icons) and `LOGO` (the shelf tile) each record a real
`sourceUrl` + `sourceHash`, and `localSpellIcons` skips whatever `ICON_SOURCES`
claims so no icon gets two ledger rows. `art:check` (in `verify`) re-hashes
everything offline.

**`centreSquare` is deliberately not `square()`.** `square()` crops from the
**top** for anything taller than wide — right for a standing figure's head,
wrong for everything else. Kept as separate code paths on purpose.

**Sizes and where files land:** ability icons 128px PNG in
`assets/images/spells/`; the shelf tile 256px PNG at **`public/icon.png`** —
`public/` is the one directory Vite copies verbatim, and core's packs screen
hot-links `https://<owner>.github.io/<repo>/icon.png`. An `assets/` file cannot
serve that: `vite.config.ts` runs `webpAssets()`, so everything under `assets/`
is content-hashed **and re-encoded to WebP** (measured here: 14.8KB PNG →
3.9KB WebP). So sources stay PNG and the build does the conversion — putting
WebP in `assets/` would also break `localSpellIcons`, which filters `.png`.

Core's `SUGGESTED_PACKS` entry now carries `icon:` that published URL.
Re-running `art:import` refetches all 13 portraits; sharp is deterministic so
their `contentHash` is stable and only `fetchedAt` moves.

## Gaara, and two bugs the build could not see (2026-09-02)

**Third champion, no form.** Naruto asks "can you dodge", Sasuke asks "can you
outrun", Gaara asks "where do you stand". Q `Suna Shigure` (0.4s telegraph →
column → 2.2s biting patch), W `Suna no Tate` (shield that bursts on break
**or** expiry), E `Suna Nami` (a ridge that **advances** and ploughs), R
`Sabaku Sōsō` (a slow ground wave that grips the first body).

**Two design corrections the user made, both worth keeping:**

1. *"E giống Trundle với Anivia quá"* — the first cut was a static slab, i.e.
   Crystallize. `VFX_STANDARD.md`'s rule 1 bans wearing another champion's
   shape. Fix was a **moving** wall, and the ploughing needed no special
   case: SAT resolves a trapped body to its nearest face, which for something
   bearing down on it is the forward face. A `DynamicWall` that moves must
   update `polygon.pos` every frame — the static-slab pattern builds it once.
2. *"R instant quá… địch ko né đc, quá OP"* — a `UNIT` lock-on applying a
   1.8s root plus the kit's largest damage, with no travel, is a delete
   button. Rebuilt as a slow `MissileSpellObject` (~1.4s to cross 650) that
   grips the **first** body. **A lock-on ultimate needs a reason it cannot be
   dodged, or it needs to be dodgeable.**

**The off-by-one that hit twice.** A tick loop guarded by `while (ageMs <
DURATION)` never fires a tick landing exactly on `DURATION`. So
`floor(DURATION / TICK)` overcounts by one; the honest count is
`ceil(DURATION / TICK) - 1`. Both the sand patch and the grip shipped the
wrong total into their own tooltips before a test caught it. Derive totals
the way the loop counts, not the way the arithmetic looks.

**`Shield` as an `aiRoles` tag means "press when nearly dead"** (+20 below
half health, −5 above) — so Gaara's W is tagged `Buff | Burst` and
deliberately *not* `Shield`, even though it is one. Same finding the pack
already recorded for Susanoo.

**Cross-cutting pack tests that auto-sweep a new champion:** `describeTempo`
(ultimates ≤10s, basics ≤12s), `describeBotRoles`, `spellIcons`,
`spellDescriptions`, `packInstallable`. Hand-listed and needing a new entry:
`tempo`'s timed-effect table, `spellRanges`, `waveclear`, `spellSight`.
`scripts/placeholder-icons.mjs` needs four rows and never overwrites real art.

**`HALF_PI` and other p5 globals only exist inside a running sketch** — a
spell that reaches for one cannot be driven by a test. Use `Math.PI / 2`.

## Why VFX rules kept getting broken, and what actually fixed it (2026-09-02)

Every visual failure this pack shipped was a rule already written in
`docs/VFX_STANDARD.md` and read that same week. **Reading the standard is not
what prevents these.** Core's own CLAUDE.md states the real rule: *a rule
enforced by a test has never been broken; a rule that was only prose has been
broken at least once.*

`naruto/tests/vfxRules.test.ts` now scans four things, each measured against
the whole pack **before** being written and each proven red by reintroducing
its bug:

1. **`this.direction` on a missile** — the field does not exist.
   `MissileSpellObject` has `position` + `destination` and derives the angle
   from them. Reaching for `direction` gives `undefined`, falls through the
   `??` beside it, and draws every projectile at a fixed angle. Typechecks,
   never throws, and the fallback makes it look deliberate.
2. **A missile that hits, dies, and creates nothing** — the vanish bug.
3. **p5 globals the harness lacks** — `stubGameGlobals` stubs `TWO_PI` but
   **not `HALF_PI`**, so `HALF_PI` in a spell dies only in tests. Use
   `Math.PI / 2`.
4. **`worldMouse`** (already covered by `chargeAim.test.ts`).

**Two rules deliberately NOT scanned, and the reasoning is the reusable part.**
"Does it hand off to an aftermath" looks scannable and is not: the hand-off is
often one method away (`onHit` → `this.burst()` → spawns the vortex), so a
scan inside `onHit` flags 3 of 5 *correct* files. A check with a 60%
false-positive rate is a debt list people learn to ignore — the file-wide
version was measured clean and is the one kept. "Is this shape this
champion's own" is eyes-only.

Those live as a **checklist in `naruto/AGENTS.md`** under "Add an ability",
quoting the four real player reports, because that is the file an author
actually reads before writing.

**The repeated-shape rule, now cost twice:** ridges/fingers/spikes must be
**rooted along a line and pointed the same way**. Rooted at a point and fanned
out, they read as a mace — that made Kurama Arms a club and Gaara's R wave a
hedgehog. Six rounds in `tools/preview-shape.mjs` produced, in order: a
biscuit, a Pac-Man, a hex nut, a hedgehog. None was visible from the code.

**Still missing:** the pack has no e2e/screenshot rig. Core's
`tests/e2e/shoot-new-champion-vfx.mjs` (`npm run e2e:vfx`) is what
`ADDING_SPELLS.md` §6a tells you to use and no pack is wired to it.

## VFX enforcement now lives in core, not in one pack (2026-09-02)

Putting the scans and the rig in the naruto pack was the wrong shape — the
same one `testing/boundary`'s own header describes: *"what was in a pack was a
caller in ONE pack, so every other pack's `npm test` said nothing about the
rule at all."* Every rule involved is a fact about the **engine** (what
`MissileSpellObject` carries, which globals p5 and the harness supply), so a
pack cannot derive it from its own source.

- **`@moba2d/core/testing/vfx`** → `describeVfxRules` + `vfxIssues`, beside
  `testing/tempo` and `testing/bots`. Adding the subpath took the five edits
  from [[moba2d-core-subpath-and-map-rules]] plus the `files` array.
- **`moba2d-shoot-vfx`** → an 11th bin (`publicSurface.test.ts` asserts the
  exact bin map, so the count and its prose both move). Pack calls it by name;
  nothing is copied.
- **Template**: `tests/vfxRules.test.ts.tmpl` + `tests/e2e/vfx-casts.json.tmpl`
  + the checklist in `AGENTS.md.tmpl`, so a scaffolded pack starts inside the
  rules. Verified by scaffolding a throwaway pack and reading the output.
- Core's rig takes **`MOBA2D_VFX_CASTS=<file>`**; without it it shoots the
  reference pack unchanged. `MOBA2D_CHROME_CHANNEL=` (empty) for bundled
  Chromium.

**A pack's `AGENTS.md` has a diffability contract its own header states**:
generic half stays byte-comparable with `scripts/templates/pack/AGENTS.md.tmpl`,
pack-specific notes go in the section at the bottom. Writing a generic
checklist into the generic half breaks it — the fix is to write it in the
template and copy the template's text down.

**The rig paid for itself on its first run** and then again: Gaara's R grip
rendered as a **gold starburst** — nine jaws spaced evenly around the victim,
each pointing inward. Third instance of *rooted at a point and fanned out is a
mace* (Kurama Arms, the R wave, the grip). Fixed as **two opposing banks**,
ridges rooted along each bank's spine pointing at the other, closing along the
axis the surge arrived on. Verified by re-shooting.

**Cost of running verify while another agent works in core**: with the pack
dev-linked, `tsc` typechecks core's source too, so their half-finished feature
turns the *pack's* verify red in files the pack does not own. Judge by whether
any failing path is yours; `MOBA2D_SKIP_VERIFY=1 git push` / `--no-verify` is
the documented escape hatch for exactly that.


## 2026-09-02 — four more champions, and the drawing traps they cost

Roster went 3 → 7: **Sakura** (stone + green chakra; the pack's first heal and
first `targetTeam: 'ALLY'`), **Shikamaru** (violet shadow; first zero-damage
ability, first trap, first silence, only `SpellForm.CHANNELED`), **Temari**
(pale wind, all edges no fill; first *pull*, first piercing skillshot),
**Kakashi** (crimson Kamui + white lightning; only stun, only invulnerability,
only true damage, first `targetTeam: 'ENEMY'`). Each is committed and pushed
separately with a green Publish run. Kits were chosen by *which mechanic the
pack still lacked*, not by fanservice, and that is why they read as different
champions.

**Draw every rim, THEN every body — never rim-then-body per shape.** Cost
three separate rounds in one day (Shikamaru's web came out solid violet,
Sakura's slabs drew over undug pits, Kakashi's lightning came out pink). The
second shape's rim paints over the first shape's dark half, and where shapes
cross — which for a web is everywhere — the whole effect becomes its own
outline.

**`tools/preview-shape.mjs` now rasterises itself with `sharp`.** ImageMagick
**silently drops the second `<polyline>` of every overlapping pair**, so a
dark body inside a bright rim came back as bare rims and two rounds went into
fixing a colour problem that did not exist. A preview harness that loses
layers is worse than none — it invents work.

**Randomly-seeded geometry makes a hitbox a lottery.** Shikamaru's R fanned
seven wandering tendrils at even angles; the angular gap at mid radius is
wider than a body, so whether a 100-chakra ultimate caught somebody came down
to the seed — its own tests failed ~1 run in 5. Fix was to make the strands
*hunt* (aim at `visibleTo` enemies, cosmetic wobble only). **Run a new
champion's suite 5-8 times** before believing it.

**More traps, each found the expensive way:**
- `stubGameGlobals` does **not** stub `PIE` (it stubs `CLOSE`, `CENTER`, …).
  Build pie slices from `beginShape`/`vertex`, or every test dies with "PIE is
  not defined" while the game works.
- **`onAdded` is not called** when a test drives an object's `update()`
  directly — `ObjectManager.update` is what calls it. Anything whose
  `onAdded` does real work needs a `born()` helper in the test.
- **`tests/e2e/vfx-casts.json` needs `slotName`** whenever the champion's
  display name is multi-word: the rig builds the spell class name as
  `<champion>_<slot>`, so "Naruto Uzumaki" looked for `Naruto Uzumaki_Q`. Four
  entries had been failing silently since they were written.
- **`npm run pack:link` does not refresh `node_modules/.bin` shims**, so a
  newly-added core bin (`moba2d-shoot-vfx`) is "command not found" on a
  correctly linked checkout. Run it by path:
  `node node_modules/@moba2d/core/scripts/shoot-vfx.mjs <out> <champion>`.
- `getVectorWithRange` returns a point at **exactly** the range — right for
  `DIRECTION`, wrong for `POINT`, where the player chose a distance. Use
  `getVectorWithMaxRange`.
- `Stasis` is documented as self-inflicted (immune + untargetable + *frozen*).
  For a dodge that keeps walking, use `Untargetable` + `Invulnerable`
  separately — and both, because `Untargetable` only stops being *chosen* and
  an area effect chooses nobody.
- `protected get castSpec` is TS2415 — `Spell` declares it public.

**Two new rules in core's `docs/VFX_STANDARD.md`, both from player reports:**
*(1)* the drawn shape must be the same **area** as the hitbox, not just the
same reach — an arc swept through a sector that paints only its outer
crescent teaches the wrong ability ("tưởng chỉ gây damage ở đường tròn").
Name the shape the damage query tests, then find it *filled* in `draw()`.
*(2)* **weight**: an effect can obey every other rule and still read as
"phèn". Force is three things — something must be *fast* (a shockwave, gone
in 200ms), shapes must **overshoot then settle** (30-50%), and debris must
follow the verb (a blow throws grit the way the blow went; only a *burst*
sprays in a ring). Plus the smear: three fading after-images are what make a
swept edge read as fast instead of teleporting.

**A `description` is a tooltip, not a design note.** Reported on Kakashi's Q:
*"1 spell thì ko nên nhắc tới pack, chắc gì sau này nó là chiêu duy nhất có
choáng, spell chỉ mô tả chiêu thức, đừng đưa thêm thứ khác vô description"* —
and it was in **eight** descriptions, not one. Three kinds of rubbish: claims
about the roster ("the only stun in the pack" — true for four hours), another
champion's name (text that depends on a champion that may not be installed),
and the designer's reasoning ("this is the escape button, not an attack" —
say `Không gây sát thương` and let the player draw it). Counterplay that is a
*fact about the ability* ("it travels slowly") stays. Two scans in
`tests/spellDescriptions.test.ts` now ban the word "pack", "duy nhất", and any
champion name other than the spell's own (read off `data.champions`, so it
grows with the roster). Rule also in `AGENTS.md.tmpl`.
