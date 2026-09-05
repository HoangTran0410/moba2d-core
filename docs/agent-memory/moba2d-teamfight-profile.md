---
name: moba2d-teamfight-profile
description: "Teamfight perf profile (2026-09-05) — MOBA2D_BOTS mode in measure-frame-cost, where the frame goes, and which measurements are trustworthy"
metadata: 
  node_type: memory
  type: project
  originSessionId: 39240f27-05a9-4656-82f9-d50bb98cf249
  modified: 2026-09-05T08:53:49.425Z
---

`tests/e2e/measure-frame-cost.mjs` gained a **teamfight mode** on 2026-09-05
(uncommitted, core): `MOBA2D_BOTS=9` seeds the pregame config with that many
bots set to move/attack/cast for free, drags every champion into one ring around
the player, pins their health, waits 2.5s so kits are *running*, then wraps and
measures. Default (`MOBA2D_BOTS=0`) is the old minion-crowd load and stays
comparable to history. Also added: per-method buckets inside a unit's draw
(`unit/drawAvatar|drawBody|drawDir|drawBuffs|drawHealthBar`), each split by the
receiver's class, and `buff.draw/<Class>`.

**Where a teamfight actually goes** (10 champions + ~120 minions):
- throttle 1x: fps 60, tick 60, draw 2.5ms — healthy.
- throttle 4x: draw 8–24ms, tick 40–60 — the cliff.
- throttle 10x: draw ~30ms, **tick 25–29** — the *simulation* falls behind, not
  just the frame. That is what a fight feels like, and it is a different problem
  from rendering.

No single row dominates; it is spread. Consistent rows: `om/queryObjects` 5–8%
(the top **tick** cost, ~35 queries/tick), fog 8–15%, `obj.draw/Minion` 5–9%,
champion health frames ~8%, `obj.draw/CombatText` ~3.5%. Two load-dependent
spike is the real lever, and it is **one buff, not minions**: `DamageOverTime`
is a full flame particle system per victim (two `blendMode` switches plus ~30
additive circles) costing **~0.32–0.37ms per instance per frame**. Measured
deterministically, same board of 46 minions, only the buff differing:
**4.66 → 14.29 ms/frame when 30 of them carry one** — the frame triples.
**Fixed 2026-09-05 (uncommitted):** the flames are a real `ParticleSystem`
object now, not a private array painted from inside `Buff.draw()` — `Speedup`
had the right shape all along. That is what puts them inside
`ObjectManager.draw`'s particle ration, which structurally could not reach them
before. Proven by spying on the limit each system is handed: **47 flames alive,
47 drawn at `quality:'high'`, 13 drawn once the budget engages**, frame 15.06 →
7.40 ms (that number also carries compact units, so read the drawn column, not
the ms). Two things the move needed: `zIndex = SPELL_EFFECT_Z_INDEX` (a bare
`ParticleSystem` sits at 1, *under* every unit — a burning champion would hide
its own fire) and an overridden `visionAnchor` (drawing inside a unit was fogged
with it for free). The two draw passes became one; under additive blending the
order does not change the pixel.

An earlier run showed `unit/drawBuffs/Minion` at 26.5% of CPU and I labelled it
"buff art on minions"; the user pushed back (they see no buff on a minion) and
was right. A buff census proved **minions normally carry none at all**, and
`Buff.prototype.draw` is empty, so a buff with no art costs one call. That 26.5%
was a champion with an AoE damage-over-time painting one flame system per minion
in the wave. `unit/drawAvatar/Tibbers` is separately anomalous at 0.4–1.0ms per
call for one pet. The profiler now prints a `buffs:` census per run — use it
before attributing anything to buffs.

**p5 is the overhead, not the canvas.** Measured, same work, no throttle:
`circle()` 0.885us vs `ctx.arc`+`fill` 0.13 (**6.8x**); `rect()`+`fill` 0.80 vs
`fillStyle`+`fillRect` 0.08 (**10x**); `text()` 2.275 vs `fillText` 0.30
(**7.6x**); `push`/`pop` 0.87 vs `save`/`restore` 0.255 (**3.4x**);
`blendMode` is the one that is not (0.10 vs 0.08). So ~85–90% of a primitive
draw is p5 normalising arguments and re-applying style state — the browser is
barely working. **Do not replace p5**: the rasterisation is the browser's either
way, and every spell in three packs plus `ContentApi`, `RenderGuard`, `Camera`,
`TrailSystem` and `ParticleSystem` speak p5. Drop to `drawingContext` in the few
hottest paths instead, which `drawBody`'s clip already did.

Proven by doing it: `Minion.drawHealthBar` (the most-called draw in the game,
~55 a frame) went to `save`/`fillStyle`/`fillRect`/`restore` with the two colour
strings cached — **10.8/11.0/12.7 → 3.9/4.8 us per call, ~2.6x**, pixel-identical,
whole suite green. `stubGameGlobals` now ships a `drawingContext` stub so any
draw path can do this without every test stubbing its own.

**Measurement traps, all paid for:**
- Aggregate metrics (fps, ms/frame, selfMs) swing ±50% between identical runs.
  **`selfMs / calls` is the only stable metric** (±4%). Use it for every A/B.
- The fight composition is **random** — which bots get picked decides whether a
  DoT is even on the board, so a buff-driven cost can vanish between runs. Pin
  the roster before trying to prove a buff fix.
- Canvas microbenchmarks in-page are worthless here: the work is deferred, and
  the parts summed to half the whole.
- `Game.renderStressed` is **overwritten every frame** from `stressState`, and
  the `renderStress` helpers return *new* state objects — so neither
  `game.renderStressed = true` nor mutating `game.stressState` sticks. To
  exercise the budget from a driver, set `game.renderQuality` instead, and
  remember `'low'` also compacts units.
- Champion health-bar tick marks (20 `line()` calls) were batched into one path
  and **measured within noise** (0.276 → 0.270 ms/call over 5 runs). Reverted —
  it also broke 6 tests that pin the frame through p5 spies
  (`ChampionTypes`, `ChampionTrail`). Do not redo this.

**Why:** the profile is not reconstructible without a ~90s run each, and the
list of things that are *not* worth optimising is the expensive half.

**How to apply:** measure before changing anything here; the render path is
already tuned (see the comments in `ObjectManager.draw`). The remaining levers
are LOD/frequency decisions — which buffs a minion renders under stress — and
those are the user's call, not a silent optimisation. See
[[moba2d-sandbox-not-win-condition]] for the standing rule about their
priorities.

## The stress ladder, and what a weak machine actually costs (2026-09-05)

Committed on `fight-perf-and-hud-stability`. Same fight, three throttles —
**this curve is the map**, and the cliff is between 6x and 10x:

    4x   fps 56.6   tick 59.8   draw  9.62ms   healthy
    6x   fps 34.5   tick 52.2   draw 16.34ms   late
    10x  fps 15.5   tick 24.5   draw 33.97ms   drowning

**The finding that mattered: only TWO places in the renderer read
`renderStressed`** — `ObjectManager.draw` and `FogOfWar.hardEdged`. Everything
stress gave up was **1.2ms of a 34ms frame**. The minimap, combat text and
champion health frame had no idea the machine was struggling. Fixed with a
second rung (`STRESS_DEEP_ENTER_SHARE = 0.45`) and `stressTier()` as the single
place the "Thấp, or auto and the flag" rule lives.

**Measured, per-call (the only usable metric here):** combat text row **-57%**
(lifetime 1000→650ms; 1669→672 calls), minimap **-29%** (67→34 repaints),
minion body 55.1→43.8 us/call, champion frame 221.6→185.8 us/call. Summed ~2ms
off a 23ms frame.

**I overestimated three of five.** Champion tick marks are **16%** of that
frame, not the ~50% predicted; the minimap 0.2ms not 0.9ms; the minion 0.46 not
1.5. Only the combat-text estimate held. Estimate from a profile row's *own*
`selfMs/calls`, never from counting p5 calls by eye.

**Two things that do not work, both proven by doing them:**
- **Fog: holding sight polygons 4 ticks instead of 2** made `calculateSight` go
  **4.6 → 8.6ms/frame**. The count is dominated by ungated `getSightPoly` calls
  from granted sight (turret/minion attack reveals), which the tick interval
  does not gate. Reverted; the finding is a comment in `FogOfWar.ts`.
- **Merging combat text harder.** A merge updates a number *already on the
  board*, so it never reduces how many are drawn. Lifetime is the lever.

**The aggregate frame time is unusable for A/B here.** Board composition varies
**220-380 objects** between identical runs; two before-runs at 10x differed by
45%, and one A/B round showed "after" slower purely because it drew 377 objects
against 234. Always compare `selfMs/calls` and call *counts* per tick.

**Also ruled out by measurement:** `ObjectManager.draw`'s cull/sort/zIndexOf is
**cull 357us + sort 40us + zIndexOf 125us** a frame. The per-frame `drawables`
allocation and the sort are NOT the problem — I was sure they were.

## The scheduling loss is FIXED (2026-09-05, later session): pump ticks from draw

Two claims below were half-wrong and are now settled by measurement:
- "**no tick optimisation fixes it**" — no tick *cost* optimisation does, but a
  *scheduling* fix does. `GameScene.pumpSimulation()` (uncommitted) extracts the
  `stepsToRun` body and calls it from BOTH `updateLoop` (the timer — still the
  hidden-tab/LAN-host path) and the top of `GameScene.draw` before `alpha` is
  computed. Idempotent by the shared clock; whichever runs first repays the due
  steps. Measured at 6x: **tick 43.9 → 60.1 / 59.9** (two runs); the profiler's
  "simulation held its own clock" check flips FAIL → PASS. fps also read higher
  (36.8–48.1 vs 28.9) but that aggregate is board-noisy — trust the tick.
- "**at 10x, 60Hz is genuinely unaffordable (1190ms/s)**" — refuted on today's
  board: with the pump, 10x reads **tick 57.2** at fps 18.1 (update 6.59ms/tick
  × 60 + draw 24.05 × 18.1 ≈ 830ms/s). The 1190 figure came from a heavier
  board or the same starvation it was trying to explain.

Also done in that session: `Minion.findTarget` now makes **one** `queryObjects`
call instead of two (the ally circle was identical) and applies
`PredefinedFilters.visibleTo` *after* the bbox+distance checks instead of inside
the query filters, so the raycast is never paid for corner hits. Queries/tick
29.9 → 27.9 on a 160-minion board; `alliesInRange()` deleted. The target-vision
seam is file-level, so `visibleTo` staying in the file keeps it green.

## plainFrames is GONE, and the bars/bodies went native (2026-09-05, same session)

The user reported the thing `plainFrames` (commit fa63a7a) actually did in play:
**the champion health bar flipped between two looks mid-combat** whenever the
fight hovered near the stress threshold, and reading health got harder — the
exact failure the flag's own comment promised to avoid. Rule going forward:
**stress must never change what an information surface looks like**; make the
full surface cheap instead.

Done, all verified green:
- `Champion.drawHealthBar` full frame → `drawingContext` (backing, border,
  score, bars, shield, ticks-as-one-path, mana). `plainFrames` removed from
  `AttackableUnitRenderOptions`, `ObjectManager.draw`, and the render tests.
  Ticks batching IS worth it on ctx (one path, one stroke) even though it was
  measured useless on p5 — the p5 note in the old comment explains why both
  are true.
- `Turret.drawHealthBar` → ctx (was 202us/call). `drawPassiveMarks` stays p5
  (rounded rects, rare).
- All four minion bodies (`drawSoldier/drawCaster/drawCart/drawThinBody`) →
  ctx via `ctxCircle/ctxEllipse/ctxTriangle` helpers in `Minion.ts`. The p5
  rotate/translate transform carries over — one canvas, one transform.
- New `src/game/render/cssColor.ts`: `cssColor(r,g,b,a255)` with a packed-key
  Map cache; Minion's own `cachedBarCss`/`BLADE_CSS`/`STAFF_CSS` for the
  stable palettes. Never build rgba strings per call in a draw path.
- Tests: `stubGameGlobals`'s ctx stub gained `ellipse`; `ChampionTypes.test`
  asserts via `drawingContext.fillRect/moveTo` (fillRect wrapper snapshots
  `fillStyle` since a property records no history); `PetHealthBar` reads ctx
  for the champion half, p5 for the compact pet half.
- No `textFont` anywhere in src — p5 default is sans-serif, so `ctx.font =
  '<size>px sans-serif'` is the same face.

Still p5, deliberately: `drawBuffIcons` (image/tint), champion compact
bar, base `AttackableUnit.drawHealthBar` (one Monster on the board).
`CombatText.draw` went ctx too (f490fe7, 2026-09-05): outline-then-fill
strokeText/fillText, fade via `ctx.globalAlpha` (per-frame alpha must NOT
bake into colour strings — kills cssColor's cache, and Shield/DamageReflect
colours can be css strings), align stated explicitly ('left'/'alphabetic' =
p5 ambient default; every other textAlign setter in draw is push/pop
wrapped). Nobody has eyeballed the outline in game yet.

**Thấp no longer compacts champions either (d14585a).** The user hit it in
game: quality Thấp forced `compactUnits` on desktop, one bare strip for a
champion bar. `compactUnits` is now `(low || auto) && automaticCompact` —
compact is purely the phone-zoom crowd *layout*; no quality or stress state
may take an information surface away. Thấp still gets thin bodies/particle
ration/trail collapse via the deep rung `stressTier` turns on. Two tests
were re-pinned to the new rule (`renderStress.test.ts` "does not compact
under an explicit Thấp", `ObjectManager.render.test.ts`).

**Everything through d14585a is MERGED TO MAIN AND PUSHED** (core, lol,
dota; naruto was already synced). Pack pre-push hooks run their own verify
(~2-4 min) — a push command needs a long timeout or background.

**Not done / next:** eyeball CombatText outline + flat UI in game; convert `Cassiopeia_W` (176us/inst, over budget) and, doing so, lift
`cssColor` + ctx helpers into `api.native` (one contract bump) so packs
stop hand-rolling them — agreed direction: p5 stays the default for pack
art, ctx only for what `perf:spell` flags.

## The tick is starved, not slow — and the bot AI is innocent

`GameScene.updateLoop` is a `setTimeout(interval/2)` sharing one thread with
draw, so a 34ms draw starves it. `MAX_CATCHUP_STEPS = 3` but only 1.58 ticks run
per frame, so **the ceiling is not the constraint**. At 6x the machine has the
throughput for 60Hz *and* 34fps (878ms/s of 1000) — **it is purely a scheduling
loss there, and no tick optimisation fixes it.** At 10x, 60Hz is genuinely
unaffordable (1190ms/s).

Where the ~36 queries/tick go: **lane minion aggro ~55%**, the turret
reinforced-armour passive **22%**, terrain 6%, spell objects ~8%, **bot AI
≤2%**. The bot brain is already at 4Hz with per-bot jitter and a shared
blackboard — throttling it further is a non-idea, and its 1.7ms/tick row is
`Champion.update`, not the brain.

**Done:** the turret passive (the only ungated per-tick `queryObjects` in the
codebase) now sweeps at 250ms — query traffic **36.4 → 29.5 calls/tick, -19%**.
**Not done:** fusing `Minion.findTarget` + `alliesInRange` (identical circles,
different filters — worth ~5% of the tick), and the scheduler question, which
needs a `{due, run}` histogram out of `stepsToRun` before anyone touches it.

**How to apply:** `MOBA2D_BOTS=9 MOBA2D_CPU_THROTTLE={4,6,10} node
tests/e2e/measure-frame-cost.mjs`. Read rows, not totals. See
[[moba2d-perf-scan]] for the per-spell half of the same discipline.
