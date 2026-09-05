---
name: moba2d-bot-shopping
description: "Bots got a 'Tự mua đồ' toggle and kit-aware item valuation (2026-09-04); the mix is read off damage-span classes"
metadata:
  type: project
---

Landed 2026-09-04 in `moba2d-core/` (uncommitted). Depends on
[[moba2d-dota-damage-types]] for the signal it reads.

**`BotBehaviour.autoBuy`** — the Đội tab's fourth toggle, "Tự mua đồ". Follow
`difficulty` as the template, not `autoMove`: it is a `BotBehaviour` field with
**no `AIConfig` global beside it** (the setup screen has no control for it).
The chain is exactly seven edits — `PregameConfig.ts` (interface,
`DEFAULT_BOT_BEHAVIOUR`, `globalBotBehaviour`, `sanitize`), `MatchDirector.ts`
(`addBot` options, `setBotBehaviour`, `behaviourOf`), `AIChampion.ts`
(`_autoBuy`, the option, an early return in `updateShopping`), and one entry in
`RosterTab.vue`'s `BEHAVIOUR_FLAGS` (the template just iterates it). Defaults
**on** — a bot that banks its gold is broken, not differently-behaved; the
switch exists to freeze a hand-built bag.

**Trap:** ~16 tests assert the whole `BotBehaviour` record with `toEqual`, so a
new field breaks all of them at once across `PregameConfig.test.ts`,
`MatchDirector.roster/persistence.test.ts`, `pregameConfigSource.test.ts` and
`matchConfigSource.contract.test.ts`. A regex over `autoCast: …,\n *difficulty:`
gets most; the stragglers are literals with trailing comments between the two
lines, and `{ ...globals, difficulty: 'normal' }`.

**`AbilityMix` in `ai/BotShopper.ts`.** `combatValue` priced every ability as
magic (a hand-copied `1 + abilityPower`), so a bot on an all-physical kit
bought ability power and got literally nothing. It now reads the champion's own
kit — `kitAbilityMix` scans each spell's `description` for
`damage physical|magic|true` / `heal` span classes, filtered by
`damageScalesWithAbilityPower === true` (which excludes the basic attack and
held items without naming either), and votes **per ability, never per span** so
a "3 a tick (30 total)" description does not outvote a one-span ability.
Untyped and `heal` spans count as magic, matching the engine. The valuation
then calls `combat/Amplification.ts`'s **real `abilityMultiplier`** rather than
restating it — that copy was the whole bug. `coverage` (share of abilities
anything amplifies) dilutes the multiplier toward 1; haste sits **outside** it,
because a stun on a shorter cooldown is still worth something.

Verified against real packs with no per-champion data: Sniper 100% physical,
Juggernaut 67%, the casters 100% magic, Axe 33/67, Slark 33/50/17 true;
Caitlyn 75% physical, Ashe 67%, Ignite 100% true. `bodyOf`/`itemValueFor` take
the mix as a defaulted parameter so `nextBotPurchase` scans the kit **once per
decision**, not once per item on the shelf.

**I tripped the vocabulary gate** writing "Ezreal" in a `src/` doc comment —
`tests/content/vocabularyBoundary.test.ts` + `corePackTarball.test.ts` scan
`src/` only (not tests) and name the file and the word. Describe champions by
archetype in core, never by name.

**Pre-existing core failures with all 3 packs linked**, A/B-proved 2026-09-04
by stashing only the source edits (leave `src/generated/installedPacks.ts` out
of the stash — that is the pop trap): exactly 7, in `registry` (4 packs vs 2
bundled), `matchConfigSource` ×2 (map count), `shopSubject`,
`preset.customKitDefence`, `preset.runtimePack`, `slotObjects`. `chunks:check`
also fails on the pregame ceiling + missing per-champion spell chunks for all
three packs. The list in [[moba2d-workspace-layout]] is older and no longer
matches — A/B rather than trusting either.
