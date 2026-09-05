---
name: moba2d-damage-text-helpers
description: "Descriptions stopped being parsed for numbers (2026-09-04); api.text.dmg writes the markup and data-base carries the figure. Core 1.22.0."
metadata:
  type: project
---

Landed 2026-09-04, uncommitted, core **1.22.0** + all three packs on
`coreRange: '>=1.22.0'`. Replaces the approach in
[[moba2d-dota-damage-types]] and [[moba2d-hud-effective-numbers]].

**Why.** `amplifiedDamageText` used to find a spell's damage by parsing the
Vietnamese sentence — first digit run inside a `damage` span, unless followed
by `%`, unless the head of a longer number, mind the dash for a range. Every
clause was a guess, and a wrong guess is **silent**: the span renders as
authored, which is also what an unbuilt champion looks like. The user's own
framing: "lỡ viết desc sai cấu trúc là ko test nào bắt được, cứ chết âm thầm."

**The design.** `src/game/combat/DamageText.ts` exports
`dmg(amount, type, tail?)`, `dmgRange(lo, hi, type, tail?, sep?)`,
`heal(amount, tail?)`, `tint(text, type?)`, `pct(...)`. They emit
`<span class="damage magic" data-base="26">26 sát thương phép</span>`.

**The helper writes the damage noun too**, from `DAMAGE_WORD` (moved into
`DamageText.ts`; `describeBuff` re-exports it). The type is already an argument
at the call site, so letting the sentence restate it by hand is letting it
disagree — `dmg(60,'MAGIC',' sát thương chuẩn')` type-checks, renders violet,
deals magic and says "true". `tail` is what comes *after* the noun (" mỗi
giây"); `dmgValue`/`dmgRangeValue` are the no-noun variants for "(tổng 30)" and
a range end the sentence already named — a separate call, so dropping the words
is never a forgotten argument. The reader
replaces a prefix it **generates** from `data-base` via the shared
`printFigure` — no digit matching at all. Reached from a pack as
`api.text.dmg` (new `text` namespace on `ContentApi`, hence the contract bump).

What this makes impossible rather than merely detectable: forgetting the
damage type (required arg), a leading `+` killing the rescale, tagging a
strike count or an execute threshold, and a range whose second end never
moved. `tint`/`pct` write `data-flat="none"` — that attribute is what
separates "paint, deliberately" from "a figure whose author forgot the
helper", which no test could tell apart before.

**Legacy path kept on purpose**: a span with neither attribute still goes
through the old prose parser, so a pack built against an older core keeps
working. Our three packs can never reach it — `describeSpellDescriptions`
forbids an unmarked span.

**Traps hit while migrating 440 spans** (dota 38, naruto 40, lol 370), across
three passes — convert spans, fold the noun in, absorb a noun sitting *outside*
the call (naruto wrote `<span>18-48</span> sát thương`, so 17 figures rendered
with no type word at all):
- `whole.replace(inner, …)` clobbers `data-base="26"` when a span has no tail
  (`inner` is just `26`). Rebuild from the captured open/close tags instead.
- Pairing quotes across a whole file breaks on an **apostrophe in a comment**
  ("Gaara's ultimate") — the codemod's re-quoting pass must be line-based.
- Spans split across two source lines: `[^<]*` swallows the quotes and the
  `+`. Refuse and hand-fix (2 in lol, 1 in naruto).
- lol already has a local `pct`; the codemod emits `tint` for percentages.
- Changing `dmg` to write the noun made three call sites render it **twice**
  (`35 sát thương phép sát thương phép`) — the fold pass had refused them
  because their arguments contain nested parens (`Math.round(...)`) or a
  hand-written range. The reliable check is scanning the *generated catalogs*
  for a doubled noun, not trusting the codemod's own report.
- `Vi_Q` hid a second silent bug: a range written as one figure plus prose, so
  its upper end never scaled. Now `dmgRange`.
- The later passes changed which helper each file calls, leaving 22 unused
  `const X = api.text.X;` aliases that `check-unused` (a verify step, not a
  test) failed on.
- `contract:bump` always raises the minor and has no record-only mode. Adding
  helpers after a bump in the same unreleased change means re-running it and
  then putting `package.json`'s version and the snapshot's `contract` back by
  hand.
- lol's `data.ts` is the **data half** and may not value-import core, so its 8
  item spans carry `data-flat="none"` typed by hand. `testing/itemRules.ts`'s
  `ALLOWED_SPAN` had to admit the attribute.
- A real bug the helper *fixed* rather than caught: Jhin_Q lists bounces as
  `18 / 24 / 30` and the old parser scaled only the first. Now
  `JHIN_Q_DAMAGE.map(step => dmg(step, 'PHYSICAL')).join(' / ')`.

**Finding the doubled nouns took three attempts, and the first two under-read.**
Scanning the generated catalog for a repeat *inside one span* misses the
common shape entirely, because the second noun lives in the prose outside the
span (`</span> sát thương`). A source-level scan of `${dmg(...)}` call sites
finds more but cannot see rendered text. Only the permanent rule — anchored to
both edges of a span that already contains the noun — catches all of it. It
went off on four *correct* sentences first: `dmgValue` writes no noun on
purpose, so "18 / 24 / 30 sát thương vật lý" is the shape it exists for. A
proximity scan is the wrong instrument: 11 of its 12 hits were ordinary
sentences naming two figures. The rules carry a falsification case for exactly
this reason — each was narrowed at least once against a real sentence, and a
rule narrowed enough stops matching anything.

**`@moba2d/core/testing/spellText`** (`src/testing/spellRules.ts`) is the one
copy of the rules, following `describeItemShop`'s precedent — the three packs
had three divergent scans, which is how a defect caught in one shipped in the
other two. Adding a `testing/*` subpath needs it added in **three** places:
`package.json` exports, `src/seams/packCoreBoundary.ts`'s `ALLOWED_VALUE`, and
lol's own `tests/noCoreReach.test.ts` allow-list.


## The copies of the span pattern, and what each one cost

Adding `data-base` to the markup broke **every** reader that had its own copy
of the span pattern, silently, because a reader that matches nothing is
indistinguishable from content that is clean. Found one at a time, each from a
symptom rather than from a test:

- `ai/BotShopper.ts`'s `kitAbilityMix` — anchored to `">` after the class. Every
  champion read as `coverage: 0`, the ability term vanished from the valuation,
  and **every bot in the game started buying attack damage**, mages included.
  Reported from a match ("Lux mua đồ sát thương vật lý"). It also counted
  `tint` spans as amplified abilities, since `data-flat` still matched.
- `lol/scripts/wiki/sync-damage-types.mjs` — rewrote prose spans that no longer
  exist, so `damage:check` (a **verify** step) passed vacuously and could never
  go red again. Now reads the `dmg(n, 'TYPE')` argument, and carries a guard
  that fails when a run inspects zero type arguments.
- `combat/Amplification.ts`'s `AUTHORED_SPAN` — listed the attributes in a
  fixed order, so any reorder or addition drops the span to the legacy prose
  parser. Reads attributes by name now.
- `testing/itemRules.ts`'s `ALLOWED_SPAN` — narrow, but fails *loudly*, which is
  the safe direction. Widened to all three `data-` attributes in any order.

The fix that generalises: **`SCALING_SPAN_OPEN` lives in `DamageText.ts`, the
module that writes the markup**, and consumers import it. And test fixtures are
built by calling the emitters (`dmg()`, `heal()`, `tint()`), never by typing a
span literal — a hand-typed fixture is exactly what let `BotShopper.test.ts`
stay green while the shopper was blind.
