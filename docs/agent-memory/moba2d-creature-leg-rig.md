---
name: moba2d-creature-leg-rig
description: "Procedural creature rig for moba2d-core (legs, spines, chains) — landed 2026-08-31/09-01 on main, UNPUSHED; the tuning and clamping facts a future change would rediscover the hard way"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3a96958b-801f-49c8-9f74-b984a36b83b8
  modified: 2026-08-31T18:33:30.873Z
---

Landed 2026-08-31 and 2026-09-01 in `moba2d-core`, on `main` (fast-forward) but
**UNPUSHED** — `8b4fa41` (hotkey guard), `10f63e5` (stale map-editor docs),
`d94922a` (the rig + editor panel), `197f788` (segmented bodies + spine editor +
clear-to-default everywhere), `1b0146b` (chain solver, `lash`, soft beam, death
limp, `slots.decor`, champion trails). Branch `feat/creature-leg-rig` still
points at `197f788`. Design doc:
`docs/superpowers/specs/2026-08-31-procedural-leg-rig-design.md` (a record of
that day; `1b0146b` has no spec). Related:
[[moba2d-shop-and-editor-seams]], [[moba2d-workspace-layout]].

`src/game/render/creature/` — `legIk.ts`, `legRig.ts`, `spine.ts`, `chain.ts`,
`creature.ts`, `creatureSpec.ts` are all **pure** (no p5, no game state) because
they run in three places: the game, the map editor's inspector preview
(Canvas2D), and vitest. `creatureSeam.test.ts` enforces it, and that purity is
the whole reason the editor shows the real walk instead of a mock. `drawCreature.ts`
is the only file there that draws. A pack declares `rig` as data on a camp;
phase 2 (`api.rig` for a pack's own code, needing `contract:bump`) is still
deliberately deferred.

**`spine.ts` and `chain.ts` solve different problems and neither substitutes.**
A spine is a head that leads and a body that trails, with an angle limit — it
needs one or a hard turn drags the tail through the head. A chain is pinned at
**both** ends (whip, tether, hook), solved by FABRIK, and deliberately has **no**
angle limit: two pins already hold it open, and a bend limit fights them until
the solver drops one. Every `Chain.span` pass ends on the tail so the anchored
end never lets go, and an out-of-reach head is clamped short rather than honoured
at the anchor's expense.

Things a future change will otherwise rediscover by breaking:

1. **The gait must pass a turn, not just block the other group.** "Step unless
   the other group is mid-step" starves: the behind group re-triggers the
   instant it lands, so the other never moves — measured as a foot 1600 units
   from its hip on a body that travelled 2000. The floor passes only when
   *nothing* is stepping.
2. **The lead is a distance (trigger-widths), never a duration.** A lead in ms
   is multiplied by speed and overshoots at a run as badly as no lead
   undershoots. As a distance it bounds `|foot - rest|` by the trigger at every
   speed — which is what lets bone length be a fixed `1.1 x reach`.
3. **A chain body is additive; only an `orb` replaces the sprite.** And legs
   exist only when `count` is declared — a legs block that lost its count used
   to come out as a pair from `Number(undefined) || MIN_LEGS`.
4. **Tune against speed relative to `reach`, not px/frame.** A big camp has long
   legs, so the same absolute pace is a stroll for it and a sprint for a small
   one. Real bodies sit at 0.027-0.081 reach/frame. (`speed: 6` in
   `lol/monsters/Baron.ts` is the SPIT projectile, not the body — do not use it
   as a body speed.)
5. **The map is dark; anything drawn on it must be lighter.** Floor is
   `background(30)` (`MAP_BACKGROUND_GREY` in `src/game/render/palette.ts`),
   water 34 luma, bush 77, walls 119. The first leg colour was picked as "dark
   enough to read as a silhouette" without looking, landed 0.1 luma from the
   floor, and shipped invisible while every test passed. Any new VFX default
   faces the same question — `palette.ts` exists so a test can hold it.
6. **Clamp numbers, refuse only words.** A cosmetic field must never cost a map:
   an odd leg count failed validation -> `localMaps.keepValid` dropped the whole
   map on a `console.warn` -> it left the picker -> `takePlaytestMapId` found
   nothing -> back to the menu. From the player's seat, "the game stopped
   working because I typed 7". `resolveRig` already clamped it. The validator
   checks *types* on numbers and *vocabulary* on the rest.
7. **The map editor chunk has no safety net until you add one.** Wiring the
   editor to core made `editor-*.js` statically import BOTH `game-*.js` and
   `pregame-*.js` and `check-chunks.mjs` said nothing — it had rules for
   MenuScene, SetupScene, PacksScene, LanScene, game and spell, and **none for
   `editor`**. It has one now. Anything the editor imports from core must be
   pinned to `shared`. Baseline editor payload: `shared-*.js` alone, 153KB.
8. **There is no "down" in this camera, so nothing sags.** A rope between two
   points in a top-down view *lags*; slack given to a two-pinned chain has
   nowhere to go but along the line, and comes out as the far end poking past
   the point it is aimed at while nothing moves. `BeamRenderer`'s rope is taut
   for exactly that reason, and its settling is scaled by the frame delta —
   solver passes per frame would make the curve a function of frame rate, the
   trap `Camera.smoothingFor` exists for one layer down.
9. **A wander bounded per axis is a square, not a circle.** `Wildlife`'s two
   sines per axis summed to 1 and put the animal 311 units out of a 240 slot
   (`roam * sqrt(2)`). The `INSIDE_CIRCLE = SQRT1_2` factor is what makes the
   editor's circle mean what it draws.
10. **`slots.decor` is the one slot group allowed to be absent**, and the one
    that declares its own contents. Optional so every map drawn before it
    exports byte-for-byte unchanged — `storage.ts` deletes the key when empty,
    exactly as it does for `lanes`. It carries the creature itself because
    scenery is a fact about *this map*, unlike a camp's `role`, which waits for
    a pack. `Wildlife` is on `ObjectManager.isDecoration`'s list, so it never
    enters the gameplay quadtree, and its path is a function of its own age so
    nothing crosses the wire.
11. **A camp's rig lives under `stats`; scenery's lives on the slot.** A camp
    *overrides* what a pack declared; decor *is* the declaration with nothing
    underneath. `rigKey` in `mapEditor/ui.ts` is what tells the spine editor and
    the preview which of the two it is looking at — a hardcoded path there reads
    the wrong one silently, because `readDeep` of a path that does not exist
    returns `undefined` rather than complaining.

`vite.config.ts` pins `legIk`, `legRig`, `creatureSpec`, `render/Interpolation`
and `render/palette` into `shared` (not `pregame` — that pin was an earlier,
wrong answer). `chain.ts` is deliberately **not** pinned: only `game` imports it.
While the `lol` pack is linked `chunks:check` also reports the pregame ceiling
and 64 missing spell chunks — both pre-existing, A/B-verified on 2026-08-31 and
again on 2026-09-01.
