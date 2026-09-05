---
name: moba2d-fog-hard-path
description: "The Thấp-quality fog (drawDirect) shipped two geometry bugs — overlapping vision re-fogged, and square holes; fixed 2026-09-04 with clip groups + a circle cut"
metadata:
  type: project
---

Landed 2026-09-04 in `moba2d-core/`, uncommitted. Only ever visible on the
**hard-edged tier** — `FogOfWar.hardEdged()`, i.e. render quality *Thấp*, or
*Tự động* after `renderStress` has been under 75% of target for 1.5s straight.
The user plays on *Thấp*, which is why this read as "fog sai trên mobile".

**Bug 1 — a winding number is not a union.** `drawDirect` built one path (the
viewport rect + every sight polygon wound the other way) and filled it
`nonzero`, with a comment claiming that "leaves the union of the holes clear
however many of them overlap". False: a point in the rect and **two** holes
scores `+1 −1 −1 = −1` ≠ 0, so the overlap was painted fogged. Even-odd fails
the same way one crossing later — **no fill rule turns N overlapping subpaths
into their union.** Visible as hard dark wedges exactly where two allies could
both see (champion next to its own turret; anything near the fountain).

**Bug 2 — the holes were square.** `computeSightPoly` sweeps against a *square*
clip box (`boxRadius`), so the polygon runs to `1.41 × radius` in its corners.
The soft path never shows it (the gradient is already transparent past
`radius`); the hard path cut the corners out at full strength.

**The fix, all inside `drawDirect`:** cut each polygon to its revealer's circle
(`clipPolygonToCircle`, new exported helper — walks edges, inserts rim points
in the polygon's own winding direction, `SIGHT_CIRCLE_SEGMENTS = 32`), then
subtract in the **clip stack** instead of the fill rule. Holes are greedily
grouped so nothing in a group overlaps anything else in it (bbox test), and
each group clips to "viewport minus these holes" — the winding rule *is* sound
for disjoint holes. A spread-out frame is back to one rect + one clip + one
`fillRect`; only a cluster pays a clip each. The circle cut is done here, not
in `computeSightPoly`, so the soft path's geometry is untouched and pays no
extra vertices.

**The soft path was never wrong** — `erase()` is `destination-out`, which is
idempotent, so overlapping erases just erase.

Testing note worth keeping: `tests/game/map/FogOfWar.direct.test.ts` no longer
pins the call sequence. It records the canvas ops, rebuilds each clip path, and
replays them through a **winding-number evaluator** to ask which points end up
fogged — and one case asserts the *old* single-path construction still paints
the overlap, so the bug cannot come back quietly. There is no real canvas in
the test env (`createGraphics`/`drawingContext` are stubs), so region maths in
the test is the only way to assert a raster outcome.

**`director.revealMap` now reaches the main view too** (same session). It used
to reveal only the **minimap**, so the cheat lifted the veil off the map and
left the screen it is a map of fogged. Two edits: `FogOfWar.revealsEverything()`
and an early return in `draw()` that **still calls `calculateSight()`** — that
pass is the only writer of `visibleToPlayerTeam`, so a bare `return` freezes
every unit at the last painted frame and the cheat shows the map with no units
on it. And `o.visibleToPlayerTeam = reveal || gaveItselfAway` folded into the
walk that was already happening — deliberately NOT into `revealedEnemies`,
which is what lends a circle to the *enemy* team.

Skipping the paint is **cheaper**, not more expensive: a full-viewport fill on
the hard tier, three viewport passes + the blit on the soft one.

Still one-sided on purpose: `visibleToPlayerTeam` is a *rendering* flag, so
bots still play with fog (`combat/Vision.canSee` is the per-observer answer and
is untouched). Making it symmetric — "tắt sương mù, ai cũng thấy nhau" — would
be an early `return true` in `canSee`, which is *faster* than the eye scan it
skips, but it changes the fight rather than just observing it.

Repro/verify recipe worth keeping: the hard tier is a **stored preference**,
not a device fact — `localStorage['moba2d.renderQuality'] = 'low'` — so a
MacBook runs the phone's path. `tests/e2e/harness.mjs` + `window.__moba2d.
scene.oScene.game` drives it. The measurement that actually settles a fog
question is terrain-independent: read a canvas pixel, then set
`fog.draw = () => {}`, wait a frame, read it again. A point inside vision does
not move; a fogged point brightens. Picking the probe points needs the
**wall-aware `sightPoly`**, not just the reveal circle — the first attempt
sampled a point behind a wall and reported a false failure.
