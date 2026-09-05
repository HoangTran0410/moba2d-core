---
name: moba2d-core-furniture-and-aram
description: "Health relic + the three turret passives moved from the lol pack into core, and ARAM replaced Proving Grounds as the reference pack's map (2026-09-02, core `045a0db` + lol `8a613b5`, both pushed)"
metadata:
  type: project
---

Asked 2026-09-02: bring `lol/structures/HealthRelic.ts` and
`lol/structures/Turret.ts` into core, and put the hand-drawn ARAM map into the
reference pack in place of `provingGroundsGeometry.ts`.

**The through-line, and the reason both moves were right:** a map drawn in
core's *own* editor could name `role: 'relic'` and get nothing, and its towers
were cardboard, unless one particular pack happened to be installed. A tower's
behaviour and a map's furniture are not flavour — they decide whether a dive is
a play or a coin flip. Flavour stays a pack's.

## Where things live now

- `src/game/gameObject/structures/HealthRelic.ts` — the relic and its beam,
  core-native (no `ContentApi`). Keeps `relicRespawnMs`; see
  [[moba2d-match-rules-in-world]] for the CDR half and why the beam delay is
  never scaled.
- `src/game/gameObject/structures/slotObjects.ts` — `CORE_SLOT_OBJECTS` /
  `coreSlotObjectFor`. `preset.ts`'s `neutralSlotFill` asks the registry
  **first** and falls back here, so **a pack's `slotObjects` still wins the
  role**. Keep this table short: a role belongs on it only when a map author
  drawing the point in core's editor would be surprised to find nothing there.
- `src/game/gameObject/structures/turretPassives.ts` — the three passives plus
  `turretPassivesFor(packDeclared)`. **A pack's list replaces core's wholesale**
  (empty registry list ⇒ core's); it never appends. `Game.spawnStructures`
  calls the one function, which exists as a function *because* nothing in this
  codebase can construct a real `Game`.
- lol keeps both seams and uses neither; its `coreRange` stays `>=1.19.0`
  deliberately (a floor, not a description of today's imports).

## The ARAM map

`packs/reference/maps/aram.json` is the editor export and **the source of
truth** — it carries `authoring`, without which the map can never be re-opened.
`packs/reference/aramGeometry.ts` **reads it with `?raw` and parses it** — one
copy of the map, not a transcript. A plain `import x from './y.json'` does NOT
work here: `vite.config.ts` sets `assetsInclude: ['**/*.json']`, so JSON
resolves to a *URL*; `?raw` + `JSON.parse` at module scope is the convention
every map in every pack follows.

The module exists only for the chunk split: `vite.config.ts` sends everything
under `/packs/reference/` to `pregame` by path, and the `map-<id>` carve-out
matches by basename. It now also matches a pack's `maps/*.json` — **with an
optional `?\w+` tail**, because the id Rollup asks about is `aram.json?raw` and
a pattern anchored on `.json$` misses it in silence. Measured, not reasoned:
without the tail, `map-aram` came out 241 bytes and `pregame` grew by exactly
the export's size, and `chunks:check` did **not** catch it (18KB is under the
ceiling). With it: `map-aram` 17.8KB / 2.2KB gzip, lazily fetched, `pregame`
unchanged. Always read `dist/assets/` after touching that rule.

Map id is now `reference:aram` (was `reference:proving-grounds`); ~12 test files
named the old id or imported the old geometry.

**What the swap cost, and how it was paid.** Proving Grounds was a *designed*
nav fixture: an exactly point-symmetric map with a corridor in the hostile
60-90px `NavGrid` band. ARAM is hand-drawn, so:
- the 60-90px corridor survives by luck — **measured**, 2 of its 701 gaps fall
  in the band. The test measures rather than asserting a chosen number, so the
  fixture value now survives the map changing.
- symmetry is only *near*: max slot error 82px on a 4000px map, so the case
  carries `MIRROR_TOLERANCE = 120`. Still catches the thing it exists for (a
  side missing a structure misses by thousands).
- `mapEditorMerge.test.ts`'s real-map case lost its hand-derived 851,840. ARAM's
  20 wall polygons *tile* (no overlap), so the expectation is now an independent
  **rasterisation** (point-in-polygon on a grid — no shared code with
  `Geom.union`), and the overlap-counted-once property moved to a new synthetic
  case rather than being dropped.
- ARAM's `slots.neutral` is `relic` (core answers it) + `dragon` (**nobody in
  the reference pack** — the pit is empty core-alone and holds lol's drake when
  that pack is installed). The reference pack's `warden` monster is now placed
  by no map; kept on purpose as the cross-pack `fills` demonstration.

## Traps hit

- `tests/game/map/wallSweepCoverage.test.ts` scanned `class X extends Y` with a
  regex that **missed `export class`** — `HealthRelic` walked straight past the
  gate. Widened, plus a `NOT_A_BODY` parent list (`Buff`, `SpellObject`, …)
  because those directories now hold non-bodies.
- `tests/content/commentPaths.test.ts` fails on a path named in prose that does
  not exist — a comment citing a test file you decided not to write is a build
  failure.
- Verified in a real browser (`tests/e2e/harness.mjs`): 8 turrets each carrying
  all four buffs, 1 `HealthRelic`, the drake in the pit, relic pickup heals and
  spawns the beam, 0 page errors.
