---
name: moba2d-bot-toggles
description: "Đội tab gained autoBuy + autoReroll toggles and bots learned to sell-to-rebuy (2026-09-04); ability power now displays as points"
metadata:
  type: project
---

Landed 2026-09-04 in `moba2d-core/`, uncommitted. Extends
[[moba2d-bot-shopping]].

**Two new `BotBehaviour` flags**, both defaulting on, both following
`difficulty`'s pattern (a `BotBehaviour` field with **no `AIConfig` global**):
`autoBuy` ("Tự mua đồ") and `autoReroll` ("Tự đổi tướng khi chết"). Seven edit
sites each — `PregameConfig.ts` ×4, `MatchDirector.ts` ×3, `AIChampion.ts`,
`RosterTab.vue`'s `BEHAVIOUR_FLAGS`. **~17 tests assert the whole record with
`toEqual`**, so each new field breaks them all at once; a regex over
`<prev>: X,\n *difficulty:` gets most, stragglers are literals with trailing
comments and `{ ...globals, … }`.

**`autoReroll` is deliberately NOT `_respawnWithNewPreset`.** That field is a
mechanism the UI arms and disarms: the picker's "clone my spells" pins a bot,
and `MatchDirector.applyLoadout` sets it back to `true` every time so a
mid-match champion swap survives the next death (pinned by
`MatchDirector.loadout.test.ts`). A preference stored there is cleared by any
visit to the picker. `respawn()` now asks both.

**Bots sell to rebuy.** `nextBotPurchase` answers `null` for a full bag, so a
finished bot banked its income forever — and after a re-roll (`respawn()` does
**not** empty the bag) it was a mage holding six attack-damage items with the
gold to fix it and no way to. `bestBotSwap` picks the best sell-one-buy-one;
`botShopTick` asks it only after a plain purchase comes back empty.
`BOT_SWAP_MARGIN = 0.1` of current `combatValue` is what makes each swap
one-way — nothing can gain a tenth in both directions, so two builds cannot
oscillate and burn the 30% refund every tick. Candidates whose
`componentSlotsFor` includes the slot being sold are excluded, or selling
would raise their own price and the bot would be down a slot for nothing.

**Ability power now reads as points, not a percentage.** It is stored as a
fraction (`1.5` = +150% ability damage) and both surfaces said so, which is
useless beside `Sát thương 26`. `itemStatLines.ts` gained `AS_POINTS` (a set
of one, checked **before** `AS_PERCENT` or a rod advertises `+0.35`) and
`participantStats.ts` a `points()` helper. The two must agree — the roster row
and the shop card are the only places it is read; `participantStats.test.ts`
pins both in one case.
