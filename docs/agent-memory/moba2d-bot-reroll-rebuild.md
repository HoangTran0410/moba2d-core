---
name: moba2d-bot-reroll-rebuild
description: "A bot that re-rolls on death now gets its bag back at cost and re-buys in the same trip (2026-09-04), instead of paying 30% per slot"
metadata:
  type: project
---

Landed 2026-09-04 in `moba2d-core/`, uncommitted. Fixes the compounding leak
[[moba2d-bot-toggles]]' sell-to-rebuy created and [[moba2d-bot-shopping]]
priced.

**The bug the user reported from a real match:** a bot dies, re-rolls into a
different champion, keeps the bag, and the only repair available was
`bestBotSwap` — one slot at a time at `SELL_REFUND_FRACTION`. So every death
burned 30% of the build, and the more it died the poorer and weaker it got.

**The fix is that a re-roll is not a change of mind.** Three pieces:

- `ItemShop.refundBag(champion)` — unequips the whole bag, pays `def.cost`
  (`sellValueOf(def, 1)`, so one function still turns prices into coins), and
  `clearShopHistory`s. Guarded on `champion.wallet` existing, or `grantItem`'s
  cheat-door bags would be *deleted* rather than reversed. No host argument and
  no player-facing door — a full refund at will is the free-stat-toggles
  inventory `SELL_REFUND_FRACTION` exists to refuse.
- `BotShopper.rebuildBotBag` — the same fountain gate `botShopTick` opens with
  (refuse entirely rather than empty a bag it cannot refill), then `refundBag`,
  then `nextBotPurchase`+`buyItem` in a loop to `BOT_REBUILD_PURCHASE_LIMIT`
  (18 = three per slot; a ceiling only because a zero-priced item a combine
  keeps eating is a loop nothing else ends). One trip, not one item per 2s
  tick, because a bot walks out of the fountain seconds after respawning.
- `AIChampion.respawn` calls it **only** when `championId ?? name` actually
  changed (a fixed-champion bot re-applies the same preset every death — no
  churn) and only when `_autoBuy` is on (that switch means "leave this bag
  where I put it").

**Adjacent bug fixed on the way:** `updateShopping` built its `ShopHost` as
`{ fountains }`, so a bot priced every refund at the default 0.7 while
`sellItem` paid the map's `EconomyTuning.sellRefund` — on a map that refunds
less, `bestBotSwap` sold and then could not afford what it sold *for*. Now a
private `shopHost()` carries `sellRefund` too, read off `Game.sellRefund`.

**Still open, deliberately:** `MatchDirector.applyLoadout` (the picker's
mid-match champion swap) leaves the same stale bag behind and was left alone —
a deliberate swap by the owner reads as "keep what I gave it".

Traps: `createGame()` has **no fountains**, so any test of a shop gate has to
add one or it passes for the wrong reason; and `shopItems()` is **not** empty
in core's tests with packs linked (a rebuild really buys a real build), so
assert gold *conservation* — `wallet + Σ def.cost` — not an exact balance.
The 7 pre-existing failures with 3 packs linked were re-A/B'd and still 7.
