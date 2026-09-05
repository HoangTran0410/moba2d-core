---
name: moba2d-dota-damage-types
description: "dota's 38 damage spans were all untyped (2026-09-04); typing them fixed both the red-magic colour and AD builds not scaling tooltips"
metadata:
  type: project
---

Landed 2026-09-04 in `dota/` (uncommitted). Continues
[[moba2d-hud-effective-numbers]], which built `amplifiedDamageText` and the
`class="damage"` claim; this is the pack half nobody had done.

**The bug.** All 38 of dota's damage spans were bare `class="damage"`. Core
reads a bare one as `DEFAULT_DAMAGE_TYPE` (MAGIC), so:
- **colour**: `styles/main.css` paints bare `.damage` in `--spell-damage`
  (#ff5858 red) and keeps amber/violet/cyan for `damage physical|magic|true`.
  Ten spans literally reading "sát thương phép" printed red. Reported as "sát
  thương phép lại được tô màu đỏ".
- **scaling**: 7 abilities across 4 heroes deal `PHYSICAL`, which
  `abilityMultiplier` amplifies by **bonus attack damage**, not ability power.
  So an AD build moved zero numbers in any tooltip, and an AP build moved
  numbers the cast path would never honour. Reported as "mua rất nhiều đồ
  nhưng ko thấy cộng damage vào spell description".

**The engine was never at fault** — proved end to end before touching content:
item → `stats.abilityPower` 1.5 → tooltip `55 (+82.5)` → hit 138 from 55.
`hudState.buildSpells` does read `spell.effectiveDescription`. Don't re-chase
this; the packs are where a scaling bug will be.

**Three spans were not damage at all** and were being rescaled: Axe_R's
execute *threshold* (`30 máu`), Juggernaut_R's strike *count* (`4 lần` →
"4 (+7.6) lần"), and Pudge_W's upkeep drain, whose own `drain()` comment says
it deliberately bypasses `takeDamage`. All three are `buff` spans now.

**The `+` trap, same family as lol's "Khiên 45".** Earthshaker_R's echo was
`<span class="damage">+${R_ECHO_DAMAGE} …</span>`. Core's `LEADING_NUMBER` is
anchored `^(\s*)(\d+…)`, so a `+` before the digit means the span **silently
never rescales** — identical in source to one that works. The `+` now sits
outside the span.

`dota/tests/spellDescriptionTags.test.ts` (new, 7 cases) pins it, and holds
the rule lol's version cannot: **the type a span names must be a type the
file's own `takeDamage` deals**, read with a paren-balanced scanner (a
character class cannot cross `beheading ? 'TRUE' : 'MAGIC'`). After editing
any description, `npm run catalog:generate` — `catalog:check` fails verify
otherwise, and `grep 'class="damage'` on `generated/spellCatalog.ts` finds
nothing because the quotes are escaped (`class=\"damage magic\"`).

**Measured but deliberately NOT changed** (user said the weakness was the
tooltip bug, not the shop): dota's shop sells AP best-6 **1.53** across 4
items vs lol's **8.60** across 15; AD best-6 **51** vs **102**. Bodies
(135–220 HP) and mean base ability damage (25.0 vs 27.6) are already level, so
the shop is the whole remaining gap if it ever needs closing.
`dota/tests/items.test.ts` caps AP best-six at 1.5–2.5 on purpose and says the
fix would be "more items, not bigger ones" — and `scripts/import-art.mjs`
makes that cheap: add `{ slug, local }` to `ITEMS` and the icon comes off
Steam's CDN (`kaya`, `mjollnir`, `butterfly`, `ethereal_blade`,
`octarine_core`, `sheepstick`, `orchid`, `greater_crit` all return 200;
`aghanims_scepter` 404s).
