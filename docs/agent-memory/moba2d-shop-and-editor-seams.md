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
