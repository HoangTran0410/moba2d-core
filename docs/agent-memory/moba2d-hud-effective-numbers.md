---
name: moba2d-hud-effective-numbers
description: "Spell/item tooltips rescale tagged damage by ability power (2026-08-30); class=\"damage\" is now a claim a pack must earn"
metadata: 
  node_type: memory
  type: project
  originSessionId: 67523105-a721-4c0a-b5ca-b1a2f7f4ae83
  modified: 2026-08-29T17:54:36.144Z
---

Landed 2026-08-30, unpushed: core `eaeed11` + `8b39a86`, lol `2633660` +
`a84acbb`. Related: [[moba2d-monster-attack-vfx]].

**The bug.** `takeDamage` multiplies ability damage by `Stats.abilityPower`
(`combat/Amplification.ts`), but a description is **authored HTML with the
number baked in**, so every tooltip showed first-frame tuning for the whole
match. `combat/Amplification.ts`'s new `amplifiedDamageText` rescales the
figure a `<span class="damage">` opens with; `Spell.effectiveDescription`
surfaces it beside `effectiveCoolDownMs`/`effectiveManaCost`, which is the
idiom `hudState.ts` already followed for the other two. Printed as
`15 (+30)`, not `45`.

**Corrected 2026-08-30 (core `3e5cd83`): item descriptions are NOT
rescaled.** `economy/ItemShop` sets `damageScalesWithAbilityPower = false`
on every item passive and active, so the first version printed Vĩnh Sương's
flat 30 as `30 (+60)`. The gate lives where the owner is known
(`Spell.effectiveDescription`); `hudState`/`shopState` hold a `def`, not a
spell, so they must not call `amplifiedDamageText` at all. On the item shelf
the three spans are **colour only**.

**`class="damage"` is a claim wherever a spell owns it.** Only `takeDamage`
amplifies — heals and shields do not — so a mis-tagged span reads back as a
promise the cast path will not keep. **Nine spans in `lol` were wrong**
(Shen_R shields, Soraka R/W, MasterYi_W, Janna_R, Tryndamere_Q).
`lol/tests/spellDescriptionTags.test.ts` scans every shipped spell *and item*
description; it caught the last two that a hand grep missed.

**Traps.** The refusal regex needs `(?![\d.])` before `(?!\s*%)` — without
it the engine answers a refused `40%` by backtracking `\d+` to `4`, whose
next char is `0`, and prints `120%`. `ShopDetail.vue` interpolated
descriptions (`{{ }}`) and `tests/items.test.ts` enforced "no angle brackets"
because of it; both changed together (`v-html` + a narrower contract allowing
only the `damage`/`buff`/`time` spans). Item stat text is the trap on the
other side: "Tăng 6 sát thương công" is a stat, not a hit.

**In this linked checkout `npm run chunks:check` fails** (pregame over its
ceiling, 64 spell chunks missing) — verified identical with the change
reverted, so it is the lol symlink, not a regression. Same story as the 9
failing vitest files.


## Shields are the third funnel, and heal() is their tag (2026-09-05)

The user hit Rammus W granting 712 shield off a "Khiên 80" tooltip with a
full AP build and asked whether the amplifier was missing a shield rule.
It is the other way round: `Shield.onCreate` (core) deliberately amplifies
`amount` by the caster's ability power — shields, damage and heals are the
three funnels — and the *description* made no claim. The sanctioned tag for
a flat shield figure is **`heal()`** (its doc says "a heal or a shield";
~19 lol shields + both naruto shields already used it); there is NO separate
`shield` span class and adding one costs a contract bump for nothing.

Fixed by retag (lol `0c9ab48`, dota `31de256`): Rammus_W + Warwick_E
(`class="buff"` span), Diana_W (bare number, no span), Nautilus_W (tagged
`dmg(…, 'MAGIC')` — the number rescaled by luck, the words claimed a magic
hit), Pudge_E (two buff spans; the per-enemy step DOES scale because the
composed amount is amplified once at onCreate). Item shields (Locket,
Steraks) are honest as-is: ItemShop sets `damageScalesWithAbilityPower =
false`, so they are flat and item descs are never rescaled anyway.

**Trap for the next sweep:** `testing/spellRules.ts`'s ANY_SPAN only scans
damage/heal spans, so a figure hidden in a `class="buff"` span is invisible
to every rule — that is exactly how these five shipped. A `buff` span
holding a bare flat number that the engine will amplify is the shape to
grep for (`Khiên/Lá Chắn/chắn` + `${`), and Janna_E's `+AD` in a buff span
is legitimately flat (stat grant, not amplified), so a blanket rule is not
safe — it stays a hand check.
