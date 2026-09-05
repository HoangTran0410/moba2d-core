---
name: moba2d-shop-and-editor-seams
description: "Item stat lists vs prose, shop undo/redo, AreaSpellObject position, and the map editor's slot-stats drop (2026-08-30, unpushed)"
metadata:
  node_type: memory
  type: project
---

Landed 2026-08-30, **unpushed**. Core `2d1e1ff` `edb53fc` `f62f530` `3362454`
on `feat/map-tuning`; lol `0612c5b` `01b75ca` `ef5c022` on
`feat/new-jungle-camps`; dota `088b51a` on `main`. Related:
[[moba2d-hud-effective-numbers]], [[moba2d-aggro-and-jungle-states]].

**An item description holds the passive/active/notes only.** Stats come from
`hud/itemStatLines.ts`, which builds the list for *both* the shop card and the
inventory tooltip. Packs used to open every description with the stat block in
prose. `ItemDef.description` is optional and pure-stat components now have
none — the contract tests in both packs enforce "does not start with Tăng"
plus "no digit outside a `damage`/`buff`/`time` span".

**`AreaSpellObject.position` had never tracked `center`.** Every geometric
answer in the class reads `center`; `FogOfWar` reads `obj.position`. So a lit
zone painted around its *caster*. Latent since the class existed. Two of lol's
six hand-rolled `TestVector` stubs had no `set()` and broke on the fix.

**Shop undo/redo is `economy/ShopHistory.ts`**, recorded *inside*
`buyItem`/`sellItem` (two callers: the HUD and `net/HostSession`). The
`applying` latch keeps a reversal from recording itself. Undo obeys the
fountain rule, refuses when the world no longer matches the step, and holds
the `QualifiedItem` defs rather than ids (no catalog round-trip).

**The map editor dropped every per-slot `stats` override** in three places —
JSON export, importer, and the `Geometry.ts` emitter — all building slots by
listing fields by hand. The inspector wrote them, nothing carried them, and
core's merge was correct the whole way down with nothing to merge. **"Editor JS
is unbundled globals in `public/map-editor/`, so it cannot import core" stopped
being true** — as of 2026-08-31 the editor is TypeScript in `src/mapEditor/*.ts`,
a second Vite entry at `map-editor/index.html`, typechecked with the rest of
`src/`, and it imports core directly (`ui.ts` takes `TUNING_SCHEMA` from
`@/game/config/tuningSchema`, and the leg rig from `@/game/render/creature/`).
Only `css/`, the tracing images and two classic-script libs stayed under
`public/map-editor/`; `js/` is gone. The editor tests import it too — no `vm`;
`node:vm` survives only in `tests/content/editorVendor.ts` for those two vendor
libs. Ten places in the repo still asserted the old fact (TRAPS, CLAUDE.md,
MAP_EDITOR.md, README, four source comments, two scripts) and were corrected on
2026-08-31. `withStats` now copies the whole `stats` object, so a **nested** new
slot field flows through export/import/emitter with no hand-listing to update.


## The shop UI's second shape (2026-09-05)

The user's complaint after the tank shelves: "dùng chips để filter thì nó
hơi... nhiều chips" and no pack separation. The rebuild:

- **Two-tier filter** (`shopFilter.ts`): `STAT_GROUPS` — five families
  (attack/magic/defense/mobility/other), each stat key in EXACTLY one
  (partition held by `shopFilter.test.ts`; a new ITEM_STAT_KEYS member that
  joins no family fails that test — this is the hook for the planned percent
  stat keys). `ShopFilter` is now `{text, group, stats}`; stats are
  refinements of the open group, group-only filters family-wide (or),
  persistence validates both. Family icons live in `statIcons.ts`'s
  `STAT_GROUP_ICON` because `statIcons.test.ts` bans `fa-` literals in any
  stat-drawing surface (paid for once already).
- **Per-pack shelves** (`shopState.packSections`): pure function over rows —
  pack id = qualified-id prefix; order + heading arrive as arguments
  (registry.packIds / new `PackRegistry.packName`). The panel switches to it
  only when ≥2 packs stock the shop, else the classic basic/combined split
  stays. `PackManifest` grew optional `name` (id stands in); registry is NOT
  on the api surface so none of this was a contract bump.
- The phone rail trick is one wrapper now: `.shop-filters` is the grid child
  (`grid-area: rail`), both tiers inside; `shopLayout.test.ts`'s structural
  pins were updated with it. `ShopSectionKey` widened to string.

Same day, same area: `takeHeal` now floats the LANDED amount (clamped by the
room left in the pool) and shows nothing at full health — a Heart-style
out-of-combat regen passive used to float a green number every second on a
full-health champion. Fixed at the funnel in core, no pack edits.
