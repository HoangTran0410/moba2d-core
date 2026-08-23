# Core becomes a pack SDK, and the riot pack leaves — handover

Content-pack-and-repo-split batch 6, tasks 11 and 12. Task 10 (the previous
session) did the actual departure: `packs/riot/` and everything Riot at the
repository root left `HoangTran0410/LOL2D` (branch `content-pack-batch-6`)
for a sibling repository, `/Users/hoangtran/Desktop/Github/moba2d-content-riot`.
This document is what that session's own instructions asked this one to
write: core measured alone, and the brief for whoever picks this branch back
up. It follows the shape of content-pack-extraction batch 5's own handover
section (`docs/superpowers/plans/2026-08-22-content-pack-extraction-batch-5.md`,
"Handover: what the physical split still owes").

## 1. The deploy question — answered, and the condition under which it reopens

Spec §6 left this open because it assumed a private pack repository, which
core's CI could not fetch without a token. **The author decided on
2026-08-23 that the pack repository is public to begin with** ("để pack
trong public repo test trước"), and `HoangTran0410/LOL2D` is itself already
public and already carries every one of these assets — so the split is a
rearrangement of what is already published, not new exposure, and a
production build keeps its Riot content through an ordinary public git
dependency with no secret anywhere.

**It reopens the day the pack repository goes private.** At that point
core's CI stops being able to resolve `github:…/moba2d-content-riot`, and a
production build from `main` silently ships core alone — one champion, four
abilities, one map — with a green pipeline, because nothing in `verify`
knows the pack was supposed to be there. Whoever flips that switch must, in
the same change, either give the build a token or add a check that fails
when the expected pack is missing from a production build. This is written
down here so it is not rediscovered as news.

**Core alone plays, with the D/F slots falling back to the basic attack —
not a fifth ability slot each, but a fourth and fifth copy of the champion's
own attack.** `packs/reference/pack.ts` declares no `summonerShelf`, so
`summonerSpellIds()` is empty; `preset.ts:377-382`'s `summonerIdOr` and
`preset.ts:404-406`'s `defaultD`/`defaultF` both resolve to an id nothing in
the installed catalogue answers to, and `preset.ts:113`'s `classForId(id) =
spellClassOfId(id) ?? BasicAttack` is what turns that into a real, playable
(if pointless) key rather than a crash or a blank slot — a core-alone
champion carries three copies of `BasicAttack`, in slots A, D and F. Known
and pre-existing, not a regression this batch introduced, and `e2e:core-alone`'s
own `spellsInSlots` check would not catch it either way: it counts non-null
slots, and a fallback `BasicAttack` is exactly as non-null as a real
summoner. Recorded here because "core alone plays" is this handover's
central claim and it should not overstate what "plays" means.

`.github/workflows/build.yml` (already updated by Task 10) confirms the
present-day shape: it runs `verify:without-packs -- --skip-restore-verify`
then `verify:all`, and deploys `dist/` to Cloudflare Pages only on a push to
`main` — that job has never touched `content-pack-batch-6`, so **nothing in
production has changed as a result of this branch**, and the currently
deployed game is still whatever `main` last built (the full Riot roster, as
of this writing).

## 2. The push commands from Task 10 Step 4, ready to run

The pack repository is local-only: `git log` shows five commits on `main`,
no remote configured. Once the author creates the (public, per decision
above) GitHub repository:

```sh
cd /Users/hoangtran/Desktop/Github/moba2d-content-riot
git remote add origin git@github.com:<owner>/moba2d-content-riot.git
git push -u origin main
```

Not run by this session, per the plan's own stop-and-ask — creating and
pushing to a remote is the author's action, not an agent's.

## 3. The git history

Every commit `HoangTran0410/LOL2D` has ever had still carries the Riot
assets that lived here before the split, in full. Moving `packs/riot/` out
of the working tree does not remove it from history — `git log -p` against
any commit that ever touched it still shows it, and a clone of this
repository today is a clone of that whole history. Rewriting it
(`git filter-repo`) is deferred by the author's decision (spec §1), and it
only gets more expensive the longer the two repositories' histories diverge
from a shared point. Recorded here so nobody rediscovers it as news, exactly
as batch 5's own handover recorded it before the split happened at all.

## 4. The reference pack is thin, and how thin

Core alone is one champion (Vera), four abilities, one map (Proving
Grounds), **zero summoner spells** — `D`/`F` fall back to `BasicAttack`,
because summoner spells were always Riot content and none ship with
`packs/reference/`. Spec §6 calls the old claim that core is a complete
standalone game "hơi quá lời" (a bit of an overstatement); this batch does
not change that, it only makes it the literal, permanent state of a bare
checkout rather than a drill's temporary one. Expanding the reference pack —
more champions, more abilities, summoner spells of its own — is real,
undone work, named here rather than started: it is its own piece of work,
not a defect this batch introduced.

### The largest outstanding debt this batch found: 62 files, 458 test cases, sized and with its route named

A second, quantified shape of the same thinness, found while measuring (§6
below): **62 of core's own test files, 458 individual `it`/`test` cases,
do not run in an ordinary `npm run verify` any more, silently.** This is
sized here, not opened — it is a task of its own, not a fix round at the
end of a batch. What follows is the breakdown, the reason, and the route
back, so whoever picks it up does not have to re-derive any of the three.

**This number has moved twice since it was first measured, both times
without changing the case total.** 56 files at first measurement; the same
round's own e2e-script follow-up (§7) repointed two scripts —
`drive-lux-beam-visibility.mjs` and `drive-rammus-cancel.mjs` — that used to
import `packs/riot/...` directly, dropping the count to 54 without touching
a single `it`/`test` case (neither removed script was a `.test.ts` file).
The whole-branch fix pass that produced this correction (see this
repository's own
`.superpowers/sdd/2026-08-23-pack-sdk-and-repo-split/final-fix-report.md`)
moved it again, 54 to 62: it found eight more `tests/e2e/` drivers that
reach riot content no import scan can see — a `championName` in a seeded
match config, a literal `'riot:summoners-rift'` map id, an asserted
`mapSize`/polygon/turret count, a `.kit-shelf[data-champion="..."]`
selector — and added them to `scripts/pack-dependent-tests.mjs`'s
`PACK_CONTENT_FIXTURE_TESTS` residue list rather than leaving them silently
green against whatever champion `preset.ts`'s unknown-name fallback
happened to pick. Again unchanged at 458 cases: none of the eight is a
`.test.ts` file either. **This number moves whenever a file starts or stops
reaching a pack this checkout does not have; re-derive it with the exact
call `vitest.config.ts` makes,
`packDependentTests(root, installedContentPackages(root).map(p => p.name))`,
rather than copying any figure forward.**

**The breakdown, by area** (file counts and their own `it`/`test` totals,
counted directly against the excluded-file list `scripts/pack-dependent-tests.mjs`
computes, against the tree as it stands after the whole-branch fix pass):

| Area | Files | Test cases |
|---|---|---|
| Bot posture (`tests/game/ai/`) | 5 | 101 |
| Minions (`tests/game/minions/`) | 5 | 82 |
| Monsters & structures (`Baron`, `CampAggro`, `Turret`, `DynamicTerrain`, `real-map-sight`) | 5 | 51 |
| Nav / pathfinding (`tests/game/nav/`) | 4 | 43 |
| Everything else (spells, content, config, integration, attackableUnits, buffs, scenes, scripts, e2e drivers) | 43 | 181 |
| **Total** | **62** | **458** |

Of the 62, 44 are `.test.ts` files carrying the 458 cases directly; the
other 18 are two shared helpers (`tests/game/nav/geometry.ts`,
`tests/game/minions/helpers.ts`), eight Playwright `.mjs` drivers that
reach a pack through a build script or a dynamic import, and eight more
Playwright `.mjs` drivers (the whole-branch fix pass's addition above) that
reach one as a plain string literal instead — none of the eighteen carries
`it`/`test` cases of its own.

**The reason: these are engine tests that used the departed map and content
as a fixture, not as their subject.** A representative case, traced by hand:
`tests/game/nav/NavGrid.test.ts` imports nothing of Riot's directly — it
imports `tests/game/nav/geometry.ts`, a shared helper, which imports
`packs/riot/maps/summoner_map.json` for Summoner's Rift's actual wall
polygons. The test is not *about* Summoner's Rift; it is about `NavGrid`'s
own clearance maths, and it reached for the real map because the real map
is what found the bug in the first place — CLAUDE.md's own trap entry
("A conservative approximation whose error matches the feature size is not
conservative, it is wrong") was found on exactly this map's 60-90px jungle
gaps, which a synthetic test fixture would have had no reason to reproduce.
The same shape repeats across the bot-posture, minion and turret files:
`TeamBlackboard.lanes.test.ts` and `Lanes.test.ts` read Summoner's Rift's
real lane waypoints; `Baron.test.ts` and `Turret.test.ts` read its real
monster pit and structure geometry. None of this is a test of Riot's
content — it is a test of core's own engine, written against the only
sufficiently hostile, sufficiently real fixture this repository had at the
time.

**The part that makes this actionable rather than sad: the route back
already exists, built on purpose, and nobody has taken it yet.**
`packs/reference/provingGroundsGeometry.ts` — the reference pack's own map —
was built with the same hostile properties Summoner's Rift's map has, by
design, specifically so nav and lane tests would have a second, independent
fixture. Quoted directly from that file's own header: a single wall band
"splitting it into a north half... and a south half... except for an 80px-
wide gap... 80px sits inside the 60-90px band the design spec calls out:
narrow enough that a champion's ~55px body... barely fits, wide enough that
the corridor is not merely a doorway nothing could ever fail to path
through" — and an explicitly asymmetric structure row (one turret on one
side, two on the other), the same asymmetry CLAUDE.md's own architecture
section documents Summoner's Rift itself has, for the same reason ("the two
nearest the fountain" rather than a label). `tests/content/referenceMap.test.ts`'s
`wallGapWidths` already measures this gap the way `NavGrid.fromPolygons`
actually rasterises it (5 free 16px cells at the shipped `NAV_CELL_SIZE`,
confirmed against the real grid rather than assumed from the polygon), so
the fixture is not just present, it is already proven to have the property
the excluded tests need.

**So the debt has two legitimate routes, not one, and they are not the same
work:**

1. **Repoint the genuinely engine-general tests at `provingGroundsGeometry.ts`**
   — confirmed by hand for the nav/pathfinding bucket (43 cases; `NavGrid.test.ts`'s
   own subject is clearance maths, not Summoner's Rift) and for the two
   lane-waypoint files sampled in the bot-posture and minions buckets. Not
   independently confirmed file-by-file for the remaining ~370 cases across
   those two buckets and the "everything else" bucket — some real fraction
   of them need *a* hostile map rather than *this* one and fit here; the
   rest fit route 2 below. Sorting the remainder is the triage this handover
   is naming, not one it has already done.
2. **Move what is genuinely about Riot's own content into
   `@moba2d/content-riot`**, the way the pack's own 69-file suite already
   moved in Task 6 of this plan — `Baron.test.ts` (Baron's own pit is that
   pack's content now), the display-name and catalogue-completeness tests,
   and anything else whose assertions are true of Summoner's Rift
   specifically rather than of the engine generally.

Sorting the 62 into those two routes is itself a real piece of triage —
which is exactly why it is sized and handed off here rather than attempted
inside this task. Nothing about the current state is a new failure: every
excluded file is silently skipped, not red, which is exactly why it needed
writing down in numbers rather than trusting a green `npm run verify` to
say so on its own.

## 5. Zero champions ship in production, and `chunks:check` is the evidence

`npm run build` on this branch, today, prints `chunks ok: menu and pregame
stay off the match chunk, 0 per-champion spell chunks` — not an error, a
statement of fact: no optional content pack is installed in this checkout,
so there is nothing to chunk. The deployed game (`main`, not this branch)
still has the full Riot roster; this branch does not change that, because it
is not merged. But the moment `content-pack-batch-6` (or its successor) does
merge without `@moba2d/content-riot` wired in as a real dependency of core's
build, `main` ships **one champion** to production with a fully green CI
pipeline, because `chunks:check`, `verify` and `verify:all` all pass exactly
as designed on a core-alone tree — none of them assert that a pack is
installed, only that the tree they can see is internally consistent. Wiring
the dependency in (and deciding whether `chunks:check`'s "0 per-champion
chunks" should become a hard failure on `main` specifically) is the author's
to sequence before this branch merges.

## 6. Every number Task 11 measured, against batch 5's baseline

All of the following were run on this worktree, `content-pack-batch-6` at
`9644813` at the start of this session (no other commits landed before these
gates ran); the report file this handover summarizes has the full command
output.

| Gate | Batch 5 baseline | Now (measured) | Accounted for |
|---|---|---|---|
| `npm run verify` file/test count | 159 / 1656 (`verify:without-packs`, a drill) | **171 files / 1795 passed + 9 skipped** (plain `verify` — no drill needed, there is nothing left to depart) | Up on both counts. Tasks 1–9 kept rewriting and re-homing pack-dependent tests against the testing SDK between batch 5 and now, so more of core's own suite runs without a pack installed today than could during batch 5's drill. The remaining 62 files / 458 cases that still cannot run are §4/§6 above — real, and larger than the two numbers alone suggest, since a *file* count hides how many individual cases are inside each excluded file. |
| `e2e:core-alone` checks | 13/13 | **13/13**, unchanged | No movement — the boot-to-playable-match contract held exactly as batch 5 left it. |
| `chunk cascade` (`e2e:chunk-cascade`) | 0/59 (0 of 59 spell chunks changed filename on an unrelated edit) | **0/0** (0 `spell-*.js` chunks exist at all; 0 of 0 changed) | The denominator, not the numerator, moved: batch 5 measured against a build that still had 59 real per-champion chunks from the installed Riot pack. With no optional pack installed there is nothing to chunk per-champion at all — `chunks:check`'s own "0 per-champion spell chunks" line (§5) is the same fact stated by a different script. The cascade guard's own claim ("every `spell-*.js` filename survived a `src/game` edit") is vacuously and correctly true of an empty set; it will mean something again the day a pack is wired back in. |
| `npm pack` file count / Riot vocabulary | 291 (dbb8b56, before Tasks 1–9) / none | **314 / none** | Up by exactly 23 — the SDK surface Tasks 1–9 built and shipped: 14 files under `scripts/templates/` (the pack scaffold) and 9 under `src/testing/` (the published test harness). Confirmed by direct count of the tarball's contents, not inferred. `tests/content/corePackTarball.test.ts` (part of `verify`) still passes: no Riot vocabulary anywhere in the shipped package. |
| `verify:pack-standalone` against the real sibling | not run (sibling did not exist yet) | **PASS, both phases.** Real pack: 75 files / 613 tests (its own `verify` green). Scaffold (`moba2d-pack-new` + `moba2d-pack-add spell`): 1 file / 3 tests before adding a spell, 2/6 after; typecheck, test and check-seams all green in a sandboxed npm install of core-from-tarball, no symlink home. | This is spec §7's acceptance criterion, and it is met. The pack's own test count (613) is well above the plan's `dbb8b56`-era floor of 566 — later fix rounds (the catalogue-completeness audit, the pack-specific coverage move) added tests, and the floor rule ("may not fall") is satisfied with room. |
| `verify:without-packs` | the departure drill, exercised routinely during batches 5–6 | **Fixed a real defect: it had become a permanently wasteful no-op** — see §7 below | Not a number so much as a status change. Recorded here because the plan's own Task 11 asked for a decision on this gate by name. |
| `npm run e2e:pwa` | not run this batch before now | **PASS.** 65 precache entries at build time (`vite-plugin-pwa`'s own count, includes dev-time entries the runtime check narrows past); the harness's own runtime check: 57 of 57 declared entries actually cached, service worker active, offline menu render, offline match start, no page errors. | Core alone is a materially smaller, differently-shaped app (no Riot art, no 240-spell catalogue) — the precache count is not comparable to a pre-departure baseline and none was recorded to compare against. What matters is the check itself: nothing the manifest promises is missing offline, which is what this gate exists to prove. |

**Two scripts named in the plan as known, pre-existing failures, and what happened to each:**

- **`tests/e2e/drive-touch-controls.mjs`** — still fails, but not for the reason batch 5 recorded (a genuine `TouchControls.ts` bug, untouched by this batch). It now **cannot even reach that bug**: the script drives real Riot spells by path (`/packs/riot/spells/index.ts`), so with no such pack installed it fails immediately on the missing import, before the behaviour batch 5 found is ever exercised. Confirmed by direct run. **Left as-is** — it was not one of the four the coordinator asked this session to repoint or delete, and its own bug is real, pre-existing, and unrelated to the departure.
- **`tests/e2e/drive-lux-beam-visibility.mjs`** — had left with the pack, functionally, without actually leaving the repository: it named a Riot spell (Lux R) and imported `/packs/riot/vfx/LuxBeamEffect.ts` directly, and with the pack gone it failed on `the Lux bot has no Lux_R in its kit` rather than exercising the `FogOfWar`/`Champion.draw()` seam it was written to guard. **Repointed, not left broken** — see §7.

### Checks that went quiet in the same move

**The nine skips, by file — the table above states the total correctly and
no prior draft stated the breakdown correctly.** `scripts/pack-dependent-tests.mjs`'s
own header used to say the four gated files (`PregameConfig`, `Stats`,
`TeamBlackboard`, `Vision`) each "skipped over a single `it()` apiece,"
which implied 1+1+1+1 = 4, not 9. Counted directly against each file's own
`it.skipIf` calls: `PregameConfig.test.ts` 2, `Stats.test.ts` 1,
`TeamBlackboard.test.ts` 1, `Vision.test.ts` 5 — the same total the §6 table
already had right, corrected in prose in both that script's own comment and
here.

The table above reports 159/1656 → 171/1795, up on both counts — true, and
not the whole picture. Riot's departure did not only remove files from the
run; it also narrowed a number of *surviving* files' own assertions, each by
gating a `packIsInstalled('riot')`-conditional half of itself down to
nothing. Every one of these was a correct, deliberate response to the pack
leaving at the time it was written — the alternative was an `ENOENT` crash
taking the whole file down, which is worse — and every one is individually
defensible for the same reason `tests/support/riotVocabulary.ts`'s own
header gives: "not installed" is a legitimate "nothing to check," not a
failure. What was missing was not any one of these decisions; it was an
inventory of how many places made one, since a `.filter()`/`if (!packIsInstalled(...))
return` reads exactly the same whether it is narrowing correctly or
narrowing to a silent no-op forever. This table is that inventory, built by
the whole-branch fix pass that produced this correction — beyond the nine
skips already reconciled by area/count above (§4/§6).

| File : line | What narrowed | Status after this fix pass |
|---|---|---|
| `tests/support/riotVocabulary.ts` (`riotChampionNames`/`riotMonsterNames`) | Returned `[]` unconditionally once riot's absence became permanent, which made both consumers below vacuous. | **Fixed (this review's finding C3).** Snapshotted into a checked-in roster constant; the `packIsInstalled` gate is gone and both rules run for real — proven by planting and reverting a champion name in `src/`. |
| `tests/content/vocabularyBoundary.test.ts:118` (population guard) | `if (!packIsInstalled('riot')) return;` skipped the "has real names to check against" guard itself, forever. | **Fixed**, same change as above — the guard now runs unconditionally. |
| `tests/content/corePackTarball.test.ts:123` | Ran the same (now-empty) needle list from `riotVocabulary.ts` over the published tarball — vacuous for the same reason. | **Fixed** by the same snapshot; no longer empty. |
| `tests/content/contentApiChunk.test.ts:124` | `if (packIsInstalled('riot')) expect(paths).toContain('packs/riot/maps/summonersRift.ts');` — the riot-map-reachability assertion never runs; the reference-pack assertion beside it (unconditional) still does. | Carried. Individually defensible: the file's real claim is the `offenders` line two below, which holds regardless of which maps are installed. |
| `tests/content/registry.test.ts:22` | `ROSTER_FLOOR` used `0` for the not-installed branch against `toBeGreaterThan`, letting the two assertions below it pass against a roster as thin as the arithmetic would allow, rather than stating the reference pack's real floor. | **Fixed.** Floor is `1` (the reference pack's real champion count, Vera); both call sites moved to `toBeGreaterThanOrEqual` to match without breaking the passing case. |
| `tests/game/config/matchConfigSource.contract.test.ts:364-365` | `if (packIsInstalled('riot')) expect(ids).toContain('riot:summoners-rift'); expect(ids.length).toBe(packIsInstalled('riot') ? 2 : 1);` — the riot-map-id assertion never runs; the length check adapts instead of asserting a stale `>= 2`. | Carried. Individually defensible: the file's real subject (map ids come back qualified) is unconditional a few lines up. |
| `tests/content/coreSpellsApiSurface.test.ts:312` | `PACK_SPELLS_DIR` (`packs/riot/spells`) is only scanned when `RIOT_INSTALLED`; the scan silently narrows to `coreSpells/` alone otherwise. | Carried. Individually defensible: no riot pack installed means no champion-named `/vfx/` import is possible to smuggle in from it either — the scan has nothing left to check there. |
| `tests/game/spells/terrain-field-seam.test.ts:69` | `SPELL_DIR` (`packs/riot/spells`) only scanned `if (RIOT_INSTALLED)`; skips (rather than crashes) with a legitimate "nothing to check" otherwise. | Carried. Same shape and same defence as the row above. |
| `tests/game/buffs/Ground.test.ts:149` | `spellsDir` is `packs/riot/spells` when installed, `null` otherwise — the scanned population narrows to `coreSpells/` alone. | Carried. Individually defensible: "the rule is the same either way... only whether this checkout has that pack's 240 spells to hold to it," per the file's own comment. |
| `tests/game/map/moduleEvalGeometry.test.ts:59` | `FILES` drops `packs/riot/maps/summonersRiftGeometry.ts` from the scanned list when riot is absent; the reference pack's own geometry module stays in unconditionally. | Carried. Individually defensible, and this is the shape `pack-dependent-tests.mjs`'s own header names as the deliberate alternative to full exclusion — a file that is *mostly* core keeps running minus the one entry it cannot have. |
| `tests/game/integration/ChampionSpellLifecycle.test.ts:129` | `files` drops `packs/riot/spells/Shaco_R.ts` when riot is absent; core's own three files (`AIChampion.ts`, `InGameHUD.ts`, `hudInteractions.ts`) stay in unconditionally. | Carried. Same shape as the row above. |
| `tests/content/packBoundary.test.ts:130-158` | `if (!packIsInstalled('riot')) return;` at the population guard (`'finds packs with a tests/ directory...'`) makes it a permanent no-op, and the two tests after it (`'each pack declaring tests also declares a test script'`, `'and the root verify:all runs every one of those too'`) both iterate `packsWithTests`, which is now permanently `[]` — the same vacuous-pass shape C3 was, unfixed here since it was not named a required fix for this pass. | **Recorded, not fixed** — flagged for the same treatment C3 got: either snapshot which packs are known to declare tests, or delete the gate and accept "no pack with tests in this checkout" as a real, assertable state. |

Twelve locations, counted directly off the table above (not the nine skips,
which are a separate, already-reconciled count above this section) — all
following from the same root cause: `packIsInstalled('riot')` is now
`packIsInstalled(false)` for the rest of this checkout's life. Four are
fixed by this pass (the riot-vocabulary snapshot, its two consumers, and
`registry.test.ts`'s floor); the other eight are carried, each with the
specific reason it is still true of an empty population rather than merely
convenient. `packBoundary.test.ts` is the one carried row that is not
really defensible on those terms — it is the same permanent-vacuous-guard
shape C3 was, and was deliberately left unfixed here because C3 was the one
this session's brief named, not because the two cases differ. Naming it in
this table is the artefact the brief asked for; fixing it is the obvious
next item for whoever picks this table up.

## 7. Defects found by this measurement, and how each was classified

Per the plan's own instruction: anything Task 11 had to fix is a defect in
Tasks 1–10 that only became visible with the pack physically absent, and
should be named as such rather than folded silently into "measurement." Two
such defects were already found and fixed before this session began
(confirmed present in the tree, not re-fixed): `spellCatalog.ts`'s
`BUNDLED_PACK_PREFIX` now reads `'reference:'`, not the stale `'riot:'` that
would have made `listSpellCatalog()` return nothing in every build after the
departure; and `AttackProfiles.test.ts`'s stale riot-specific asset-key
filter is gone, replaced with the already-correct `playable` filter (its own
doc comment names this as "batch 6 task 10, fix round 1"). A third
candidate was hunted and cleared: `PregameConfig.ts:298`'s
`DEFAULT_MAP_ID = 'riot:summoners-rift'` is deliberately grandfathered, with
a real `?? maps[0]` fallback exercised by `e2e:core-alone` — no action
needed, and no one should re-investigate it.

This session found and fixed two more, both small and both narrow:

- **`scripts/verify-without-packs.mjs` had become a permanently wasteful
  no-op.** Its whole job — move `packs/riot/` out of the tree, prove core
  still installs/verifies/builds/boots, put it back — depends on
  `optionalContentPackages()` finding something to move. With `packs/riot/`
  permanently gone (not merely departed for the drill's own duration),
  that list is always empty on this checkout, so the unguarded script ran
  the *entire* `npm install`/`verify`/`build`/real-browser-boot sequence —
  twice, once for the drill and once to "restore" — moving and restoring
  nothing, in every ordinary run. Confirmed by running it before the fix
  (full sequence, correctly green, but with `DEPARTING = []` printed at
  every step) and after (prints `drill skipped — nothing to depart` and
  exits in under a second). Fixed with a guard at the top of the script
  that detects the empty case and says so, rather than retiring the
  command outright — a large number of doc comments across `src/testing/`,
  `src/content/install.ts`, `tests/setup.ts` and others cite
  `npm run verify:without-packs` by name as the thing that proved a given
  claim, and retiring it would have stranded every one of those references
  for no gain, since `scripts/lib/packDeparture.mjs`'s safety machinery is
  still exercised for real by `verify-pack-standalone.mjs` regardless of
  what happens to this command.
- **`vitest.config.ts`'s own doc comment for `packDependent` was actively
  wrong.** It said "Empty in every ordinary checkout — both packs are
  here... only non-empty inside `npm run verify:without-packs`" — true when
  written, false since Task 10: the exclusion list is non-empty on every
  ordinary `npm run verify` now, permanently, because `packs/riot/` no
  longer exists to be "temporarily departed." Rewritten to state the
  current, measured fact (54 files, 458 cases, none failing, all silently
  uncollected) and to point at this handover rather than pretend the
  situation is rare.

One finding was investigated, is real, and was **deliberately not fixed**,
because fixing it is out of scope for a measurement task (no new content-
pack code, no test relocation) and is sized and handed off instead, in full,
in §4 above:

- **The 54-file / 458-case permanent test exclusion.** Real, quantified,
  and larger than either number alone suggests. Not a bug — the exclusion
  mechanism (`scripts/pack-dependent-tests.mjs`) is working exactly as its
  own extensive documentation says it should. §4 has the full breakdown by
  area, the reason (engine tests using the departed map as a *fixture*, not
  a *subject*), and the two concrete routes back — including that
  `packs/reference/provingGroundsGeometry.ts` was already built, on purpose,
  to be one of them.

**The departure broke twelve e2e scripts, not four — four were found by
this measurement and repointed or rewritten; the other eight were found by
the whole-branch fix pass that produced this correction and are recorded,
not fixed.** This section originally read "Four e2e scripts the departure
broke, and none caught by any gate, were found, decided on individually,
and fixed — not left broken," which was true of what this task itself
found and false as a claim about the whole population: the same
whole-branch fix pass (see
`.superpowers/sdd/2026-08-23-pack-sdk-and-repo-split/final-fix-report.md`)
found eight more — `tests/e2e/verify-map-picker.mjs`,
`drive-execute-taunt-terrain.mjs`, `drive-practice-panel.mjs`,
`drive-match-config.mjs`, `drive-roster-stats.mjs`,
`drive-hold-move-buff.mjs`, `drive-kit-builder.mjs` and
`measure-chogath-stacks.mjs` — that name riot content as plain string
literals (a `championName` in a seeded match config, a literal
`'riot:summoners-rift'` map id, an asserted `mapSize`/polygon/turret count,
a `.kit-shelf[data-champion="..."]` selector), invisible to the same
import-graph scan that caught the four below by construction. Worse than a
hard failure for the ones seeding a `championName`: `src/game/preset.ts`
resolves an unknown name to a *random* installed champion rather than
throwing, so each of those ran to completion and reported pass/fail about a
kit it never actually loaded. None of the eight was repointed at the
reference pack — each genuinely needs riot's specific roster size, map
geometry or named kit (Cho'Gath's stack mechanic has no reference-pack
analogue at all) — so they are added instead to
`scripts/pack-dependent-tests.mjs`'s `PACK_CONTENT_FIXTURE_TESTS` residue
list, the same mechanism that already excludes the 54-files-turned-62 in §4,
rather than left silently green against a random champion or silently
unaccounted for. See the fix report for the full list with line numbers.

The four this task did find and fix:
`tests/e2e/drive-lux-beam-visibility.mjs`, `drive-rammus-cancel.mjs`,
`smoke-new-champions.mjs` and `shoot-new-champion-vfx.mjs` all either
imported a `packs/riot/...` path directly or hardcoded a roster of Riot
champion names, and all four failed immediately and permanently — confirmed
by running each directly before any fix (`drive-rammus-cancel.mjs` threw an
uncaught `TypeError` on the missing dynamic import; the other three
reported clean, structured failures). None of the four is reachable from
`npm run verify`, `e2e:core-alone` or `e2e:pwa` — they are invoked only by
hand or from documentation — which is why Task 10's file-removal list
(scoped to `packs/riot/`, `docs/abilities/`, and the other paths named in
its own Task 10 Step 5) never caught them: they live in `tests/e2e/`,
general core territory, not under any path that list named.

Each was decided on the same rule Task 10 used for its own six core-
mechanism test files: engine behaviour that merely used Riot content as its
subject is repointed at the reference pack when the specific content does
not matter to the property; when it genuinely does, and no reference-pack
equivalent exists, the property is tested through the engine's own
primitives directly rather than through any one kit.

- **`smoke-new-champions.mjs` → repointed at Vera.** The property ("every
  ability in the installed roster fires via the real `createSpellContext`
  + `press()` path, no page error, something observably happens") does not
  depend on which champion supplies the four abilities. `ROSTER` is now
  `[['Vera', 'Vera']]`; the file is `npm run e2e:champions` and passes:
  `PASS  4 casts, 4 attempted`.
- **`shoot-new-champion-vfx.mjs` → repointed at Vera, and a real bug in
  its own check fixed along the way.** Its `ALL_CASTS` is now the
  reference pack's own four abilities, with frame timings derived from
  each spell's tuning constants rather than observed against a departed
  kit. Repointing it exposed a latent bug: its "produced world effects"
  check was `spawned > 0` alone, never disjunctive with buffs or movement
  the way `smoke-new-champions.mjs`'s own check already was — so Vera W (a
  pure self-shield, no spawned object) false-failed until the check was
  made disjunctive too. Now `npm run e2e:vfx` (new alias, added alongside
  the existing `e2e:champions`) passes all four, screenshots included.
- **`drive-lux-beam-visibility.mjs` → renamed `drive-offscreen-caster-vfx.mjs`,
  rewritten to test the engine seam directly rather than through any
  spell's kit.** The property (`ObjectManager.draw()`'s display-quadtree
  query is independent of the *owner's* `visibleToPlayerTeam`, so a
  `SpellObject` an off-screen caster owns still draws and still deals its
  damage) genuinely needs a caster placed far enough outside camera and
  vision to be unambiguous, and none of the reference pack's four
  abilities has anywhere near Lux R's 3400px range to set that up. Rather
  than force an ill-fitting repoint, the new script probes the seam with
  a synthetic `api.AoePulse` (the same helper `Vera_R` already uses)
  positioned at the player while owned by a champion 2600px away, and
  asserts the same conjunction the original did (caster genuinely
  unrendered; the probe drew anyway; the player actually took the hit —
  measured as the *minimum* health seen across the sampling window, not
  the value at the very end, after a first version false-failed on health
  regen restoring the 20 damage before the run's final read). Verified
  falsifiable by hand: moving the probe to the caster's own off-screen
  position makes the draw check fail exactly as expected, then reverted.
  All checks pass.
- **`drive-rammus-cancel.mjs` → renamed `drive-dash-attack-order.mjs`,
  repointed at `Vera_E` for the half of the property that transfers.**
  Rammus Q's specific shape — a multi-second, contact-terminated roll
  whose `INDEPENDENT` `SpellForm` survives a stun — has no reference-pack
  analogue; `Vera_E` is a short, correctly-`HELD` one-shot dash. The
  property that *is* engine-general and does transfer: `Dash.onUpdate()`
  steps position directly and never reads `destination`, while
  `BasicAttackController.stopMovement()` only clears `destination` — so a
  concurrent attack order structurally cannot shorten an in-flight dash.
  Measured directly rather than trusted: control and attack-order runs
  land within 3px of each other (243 vs 246 out of 260). The other half of
  `Dash`'s real contract — a `HELD` dash *should* end early on genuine
  crowd control — is checked in the same script instead of the Rammus-only
  half that does not apply, and two real bugs surfaced building it: a
  self-sourced test `Stun` was silently excluded by `foreignControlBuff`'s
  own `buff.sourceUnit !== sourceUnit` rule (the same rule that protects a
  root-then-pull spell from cancelling its own pull), so the stun had to
  come from the dummy, not the dasher; and the first version compared
  final position at the end of the whole sampling window, which mixed the
  dash's own travel with several frames of unrelated unit-collision
  separation once the champion landed on the dummy — fixed to compare
  position at the moment the dash itself ended. With both fixed, the
  stunned run ends at 123-144px of the control's 243px (dash genuinely cut
  short), and the attack-order run matches control (dash genuinely
  unaffected).

`docs/ADDING_SPELLS.md` and `docs/VFX_STANDARD.md`, both rewritten earlier
in this session to stop presenting the old, now-broken invocations as
runnable commands, were updated again to point at the repointed, genuinely
runnable ones instead — see §8.

## 8. What Task 12 changed in the documentation, and what moved to the pack repository first

- **`docs/PACK_AUTHORING.md`** (new) — the generic guide: scaffolding with
  `moba2d-pack-new`, adding a spell with `moba2d-pack-add spell` (real
  output quoted from an actual run, including the fact that `champion`,
  `map` and `monster` are recognised and refuse), the two published doors
  (`api` for spell code, `@moba2d/core/testing` for tests), what
  `pack-core-boundary` and `pack-asset-key` refuse and why, and a pointer
  into `docs/ADDING_SPELLS.md` for the full spell-authoring mechanism.
  Every worked example is the scaffold's own `Hero`/`Vera`, never a Riot
  champion.
- **`docs/ADDING_SPELLS.md`** — lost its "Research and register" section
  (the Riot Wiki import pipeline: `ability:import`/`ability:update`/
  `ability:check`, `docs/abilities/<champion>/`) and every Riot champion
  name in its ~25 illustrative examples, replaced with generic
  descriptions of the same mechanisms (activation forms, `SpellForm`s,
  auto-locking spells, the display-bounds and dash-hook traps). Fixed
  three broken pointers found along the way: `packs/riot/spells/
  _EmptyExample.ts` (deleted with the pack, no replacement — the doc now
  cites only `packs/reference/spells/Vera_Q.ts`), `npm run spell:new`
  (deleted in Task 10, replaced with `moba2d-pack-add spell`), and the
  enforcement table's two rows that used to cite standalone `.test.ts`
  files (`unit-target-team-seam.test.ts`, `target-vision-seam.test.ts`)
  that no longer exist as such — both rules folded into `check-seams`
  since. The removed section moved verbatim (registration step reworded
  for this pack's own file layout) to
  `moba2d-content-riot/docs/RESEARCH_AND_REGISTER.md` — written to the pack
  repository's working tree before this file's text was edited out, though
  see "Loose ends" for a correction to when each side was actually
  *committed*.
- **`docs/VFX_STANDARD.md`** — lost its Riot-named illustrations (the
  `Fizz_E.ts` worked-example pointer, the Jarvan/Anivia wall motif, the
  Darius Q zone example, Katarina's daggers, Jhin's trap, and the
  `shoot-new-champion-vfx.mjs Katarina` invocation), replaced with generic
  phrasing carrying the identical rule. The worked-example pointer now
  names `packs/reference/spells/Vera_Q.ts`, which actually exists in this
  checkout. Original text preserved at
  `moba2d-content-riot/docs/VFX_EXAMPLES.md`, same caveat as above.
- **The four e2e scripts §7 fixed** — `docs/ADDING_SPELLS.md` and
  `docs/VFX_STANDARD.md` were each updated a second time, past their first
  Task 12 pass, once the scripts they pointed at became genuinely runnable
  again: `smoke-new-champions.mjs` is `npm run e2e:champions` (already
  existed) and `shoot-new-champion-vfx.mjs` is now also `npm run e2e:vfx`
  (new alias, added to `package.json` alongside it) — both docs now name
  real, passing commands rather than hedging that the file needs editing
  first.
- **`CLAUDE.md`** — fixed the worst single line Task 10's review found
  (line 18's claim about `verify`'s composition, which named
  `ability:check`, a script that no longer exists), rewrote "Assets and
  data" for a repository with no ability-import pipeline and no map data
  of its own, corrected the "Known flakes" note (both scripts are not
  merely flaky now, they fail outright with no pack installed), added a
  new "Content packs" subsection under Architecture naming the pack
  repository and pointing at `docs/PACK_AUTHORING.md`, and — as
  instructed — **left the "Traps that have cost real time" section
  intact**, Riot champion names and all: every entry there is an engine
  fact found by measurement, and the champion that happened to illustrate
  it is not what makes it true.
- **`README.md`** — corrected the "58 champions" claim in the introduction
  to describe what this repository actually ships (one champion) versus
  what installing a pack adds, rewrote the npm-scripts table (nine stale
  entries: `ability:*`, `names:*`; added the real current ones —
  `pack:new`, `chunks:check`, `check-seams`, `e2e:core-alone`,
  `verify:pack-standalone`), split "Assets and ability data" into "Content
  packs" and "Assets", and fixed the same stale flake note and test-path
  example the other two docs had.

## Loose ends

**The copy-before-delete claim in §8, corrected.** An earlier draft of this
handover said the two files moved into `moba2d-content-riot` "were written
and committed... before the corresponding text was removed from core." The
working-tree edits happened in that order — both pack-repo files existed on
disk before the matching core text was edited out — but the *commits* did
not: core's `966cda9` (the commit that removes the text) is timestamped
21:52:25, and the pack repository's `b4a0fbe` (the commit that lands the
copy) is timestamped 21:52:35, ten seconds later. For those ten seconds,
core's committed history no longer had the text and the pack repository's
committed history did not yet have it either — the discipline this task was
held to is about durable, recoverable *history*, not working-tree order, so
this was a real miss, not a wording nit. The practical risk was nil (both
landed within the same working session, nothing was pushed in between, and
the content is verified present in both repositories now), but a report
that asserts the guarantee held and is contradicted by its own git log is
worse than one that states plainly what the timestamps show. This is that
correction; §8 above no longer claims the ordering.

**`CLAUDE.md:181` cites a test file that does not exist.** It names
`target-vision-seam.test.ts` as the enforcer of the vision-filter rule.
That file does not exist even at this batch's base commit — the rule was
folded into `check-seams`'s `target-vision` scan before this batch started,
the same way `docs/ADDING_SPELLS.md`'s own enforcement table was found to
cite it (and was fixed) during Task 12. Out of scope here — the trap list
CLAUDE.md carries this citation in is deliberately not being reopened by
this task — but recorded so the next reader who follows that citation into
`tests/game/spells/` and finds nothing is not left thinking they searched
wrong.

**The sibling repository pins core at a branch name, and that is a
merge-sequencing precondition, not a bug to fix here.**
`moba2d-content-riot/package.json`'s `devDependencies` names
`"@moba2d/core": "github:HoangTran0410/LOL2D#content-pack-batch-6"` — a
branch, not a commit or a tag, and one this repository's own instructions
say may be deleted after `content-pack-batch-6` merges into `main`. If that
branch is deleted (or force-pushed elsewhere) before the sibling repository
repoints its own dependency, every install of `@moba2d/content-riot` against
`main`'s history breaks: `npm install` in that repository resolves nothing
at the far end of a name that no longer exists. This is deliberately not
this task's to fix — the sibling repository is read-only from here — but it
is a real precondition the author has to sequence: **repoint
`moba2d-content-riot`'s `@moba2d/core` dependency at `main` (or a commit
SHA, or a released tag) before deleting `content-pack-batch-6`**, not after.
Recorded here rather than left for whoever notices the sibling repository's
install starts failing.

## 9. Self-review

- Every number in §6 was measured this session, against this exact
  worktree at `9644813` — none is carried forward from memory or from the
  plan's own text without re-running the command it names. Where a
  command's output could not be quoted directly (space), the report file
  this handover summarizes (`.superpowers/sdd/2026-08-23-pack-sdk-and-repo-split/task-11-12-report.md`)
  has the full transcripts.
- A stranger who clones core alone and reads `README.md`, `CLAUDE.md` and
  `docs/PACK_AUTHORING.md` in that order would know: what this repository
  ships on its own (one champion), that a real roster comes from
  installing a pack, how to scaffold and grow one, and where the deep
  spell-authoring mechanism lives. They would not be told to run a script
  that no longer works, or read a code example that imports a file that
  is not there.
- What is unfinished is stated as plainly as what is done: §4's 62-file,
  458-case test gap is sized by area with both routes back named, §5's
  zero-champions-in-production fact and its merge-time condition, and §1's
  public-repo condition are none of them buried in a caveat — each has its
  own numbered section. What was fixed is stated with the same weight: §7's
  four e2e scripts are not a lingering concern any more, and the report
  says exactly what changed in each rather than only that they now pass.
