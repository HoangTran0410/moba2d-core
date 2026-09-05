---
name: moba2d-core-subpath-and-map-rules
description: Publishing a new @moba2d/core/* subpath means editing five places; the map rules live in the editor's plain JS and reach packs via /testing/maps
metadata:
  type: project
---

**Adding a `@moba2d/core/*` export subpath touches five lists, and four of them are gates.** Learned the hard way on 2026-08-30 adding `./testing/maps`:

1. `moba2d-core/package.json` `exports`
2. `moba2d-core/tests/content/publicSurface.test.ts` — the subpath array **and** the "exactly the N content-pack-facing subpaths" title, plus a per-export names list when the new module re-exports from `./seams`
3. `moba2d-core/src/seams/packCoreBoundary.ts` `ALLOWED_VALUE` — otherwise every pack's `npm run check-seams` refuses it
4. each pack's `tests/noCoreReach.test.ts` `ALLOWED_CORE_SUBPATHS` — a *separate* list from (3), same job
5. each pack's `tests/noCoreReach.test.ts` file-count assertion, if a test file was added

A pack importing `@moba2d/core/seams` compiles and runs fine, so this only shows up at `check-seams` / `npm test` — the previous session shipped exactly that and left lol's `npm test` red for a day without noticing, because only `tests/maps` had been run.

**Where the map rules live.** One implementation, in `moba2d-core/src/mapEditor/mapRules.ts` — **moved and re-typed since this memory was first written** (verified 2026-09-01). The whole editor is now a Vite entry in `src/mapEditor/{state,commands,ui,render,storage,input,geom,mapRules}.ts`, not the old bundler-less `public/map-editor/js/*.js`; `public/map-editor/` now holds only `asset/`, `css/`, `lib/`. The old reason for the rules sitting on the plain-JS side (the editor could not import TypeScript) is therefore gone, but the answer did not change and should not: the rules belong beside the tool that has to explain them to whoever is drawing a map. `src/seams/mapRules.ts` re-exports them typed (no more `node:vm`) and they reach packs through `src/testing/mapRules.ts` = `@moba2d/core/testing/maps`.

Two halves: `laneIssues` (geometry — wall clearance, waypoint/segment vs turret) and `structureIssues` (relationships — lane joins two different bases, all lanes run the same way, every turret is within `LANE_COVERS_TURRET` of some lane or inside `BASE_RADIUS` of a spawn, a lane passes its own row before the enemy's, muster point stands clear of walls and turret bodies, camps are on open ground, a paired role mirrors its twin). `mapIssues` is both. Every issue carries `at: [x, y]` so the editor's Kiểm tra panel can fly the camera there.

**Two rules that were wrong on first draft and are worth not redoing.** Camp-pair symmetry must accept *any* of the frame's three symmetries (half-turn, vertical flip, horizontal flip) — Summoner's Rift is point-symmetric but Twisted Treeline is mirrored about x=3200, and a half-turn-only rule called its whole jungle broken. And the tolerance is the camp's own radius, not a pixel: a hand-drawn map's twins sit ~13–71px apart and no player can measure that.

**Pack map tests must not restate coordinates.** `lol/tests/maps/Lanes.test.ts` used to carry lane start points, turret-row tables and counts (329 walls, 11 turrets a side); one afternoon in the editor turned twelve assertions red naming nothing actually wrong, and blocked a push for two days. What replaced it: `tests/maps/mapRules.test.ts` runs `mapIssues` over **every** map in `riotData.maps`. Counts that survive are relational only (`red.length === blue.length`). See [[moba2d-shop-and-editor-seams]] and [[moba2d-workspace-layout]].
