---
name: moba2d-map-tuning
description: MapTuning subsystem + four new lol camps landed 2026-08-29 on unpushed branches; two follow-ups deliberately left to the user
metadata: 
  node_type: memory
  type: project
  originSessionId: 67523105-a721-4c0a-b5ca-b1a2f7f4ae83
  modified: 2026-08-29T11:41:22.815Z
---

Built 2026-08-29 across two repos, **committed but not pushed**: core branch
`feat/map-tuning` (6 commits, off `main` at `bb6678e`) and lol branch
`feat/new-jungle-camps` (1 commit). Spec:
`moba2d-core/docs/superpowers/specs/2026-08-29-map-tuning-design.md`.

**What exists now.** `MapSummary.tuning?: MapTuning` — champions (respawn,
flat or a `reviveCurve`), turrets, fountain, minions, monsters, terrain.
Three merge layers, innermost wins: core default → `map.tuning.<group>` →
`slot.stats` (on `StructureSlot`/`SpawnSlot`/`NeutralSlot`). Monsters are
*multipliers* at map level (a map cannot know which pack fills its slots),
absolutes per slot. All merging lives in `src/game/config/mapTuning.ts` —
nothing else composes tuning by hand. New core seams on `MonsterBody`:
`temperament` (aggressive/passive/skittish + a `FLEE` phase), `roam`
(`camp` | `terrain{water|bush}`), `ephemeral`, `chaseMargin`,
`giveUpDelayMs`. `MinionKind` is now a free string with `style` split out
for behaviour/art. Terrain speed is a **new mechanic** — a second
`TerrainMap` pass gated on the map declaring a multiplier ≠ 1, deliberately
separate from the champion pass that owns `isInsideBush`.

**Two things left for the user, on purpose.** (1) `lol`'s `coreRange` is
still `>=1.6.0`; it needs `>=1.10.0` for `temperament`/`roam` but
`bump-api-contract` warns a pack published with a floor its live core cannot
meet is refused on every machine — raise it (data.ts + write-manifest.mjs +
the pin in tests/items.test.ts, together) only after core 1.10.0 deploys to
pages.dev. (2) `assets/images/monsters/Elemental_Dragon.png` and
`Vilemaw.png` are **generated placeholder silhouettes**; swap them and
re-run `assets:generate`.

**Facts worth not re-deriving.** Editor tuning lives inside `E.meta.tuning`,
so it rides the existing map-record save/open paths for free; the paths that
did need work are the four exits plus `moba2d-pack-maps-v1` coming back in
(missing that one silently strips a pack map's numbers on re-export).
`generate-maps.mjs` puts tuning in `mapMeta.ts`, never the geometry file,
which is exactly terrain/slots/lanes by construction. `checkMap` validates
tuning **before** its early return for a lazy geometry loader — every big map
is a loader. `tests/game/types/BaseObjectTypes.test.ts` now strips comments
before its `\bany\b` scan (it used to fail on prose, against CLAUDE.md's own
rule for source scans). `ObjectManager.addObject` pushes to `_objectToBeAdd`,
so a test asserting on a death-spawned object must read both lists.
`Buff.stackId` defaults to `new.target`, so sibling classes meant to share
one slot must state it (Dragon's four elements do). Adding a *value* export
to `content/ContentPack.ts` breaks `tests/content/publicSurface.test.ts`, not
`apiContract.test.ts` — the latter snapshots the ContentApi runtime object
only. New SR neutral slots (verified against wall polygons, mirrored about
3200,3200): dragon (4253,4524), krugs (2704,1495)/(3696,4905), scuttle
(1954,2106)/(4446,4294).
