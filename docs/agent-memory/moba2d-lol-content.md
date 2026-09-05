---
name: moba2d-lol-content
description: "lol pack: Orianna's ball has vision, dragon blessings scale with match time (2026-09-04)"
metadata:
  type: project
---

Landed 2026-09-04 on **main, pushed** (lol `421a56e`, `5c99cfe`).

**A spell object grants vision with `visionRadius` alone.** `SpellObject`
already carries its owner's `teamId`, and core's `FogOfWar.fogRevealOf` falls
back to `visionRadius` when there is no `fogRevealRadius` getter (that getter
lives on `AttackableUnit`). Ashe's hawk has a redundant one from before core
was fixed — do **not** copy it into new objects. Orianna's ball is 250, against
a ward's 350 and a minion's 300, because the ball can be *sent* (`LEASH_RANGE`
720) and re-placed every few seconds.

Test a vision object by driving `FogOfWar.calculateSight` with
`calculateSightForObject` stubbed to reveal only when that object is the
observer — asserting on the `visionRadius` field proves nothing, since the
field has looked correct while lighting nothing before. Such a test reads
`visibleToPlayerTeam`, which trips the `target-vision` seam: add the filename
to `GRANDFATHERED_FOG_READS` in `lol/tests/seam-debt.mjs`. Adding any pack test
file also needs the count in `lol/tests/noCoreReach.test.ts` bumped (its
comment ledger's arithmetic is already stale — trust the assertion, not the
prose).

**Dragon blessings scale with match time** (`monsters/Dragon.ts`).
`DRAGON.scaling` = `+1/15` per minute, capped at ×3; `scaledBonuses()` applies
it. Read **once, at grant**: a blessing lasts 180s against a 60s respawn and a
new drake replaces the held one (`stackId`, `REPLACE_EXISTING`), so nobody ever
carries a stale grant and growing an applied buff would be re-applying a
modifier for nothing. `percentBonus` is deliberately **not** scaled — it is a
share of what the wearer already has, so it never went stale, and it is the
only slot the wind drake uses (tripling move speed is a different game).
`ELDER.body` and the chemtech `frenzy` are buffs on the *monster's own body*,
not team rewards, and correctly do not scale; `ELDER.bonuses` is in `ROTATION`
so it does.


## The tank shelf (2026-09-05, lol `6c16561` + dota `5347854`)

The user's balance read: too many AP items, nothing tanky survives them.
Answered with items, not nerfs — agent-built, both packs:

- **lol 61 -> 77**: 4 components (chain_vest/negatron/giants_belt/spectres_cowl)
  + 6 MR/anti-AP (Force of Nature, Kaenic Rookern's permanent magic-only
  shield via `Shield.absorbs: ['MAGIC']`, Banshee's spell-block with 12s
  re-arm, Maw, Silvermere reusing Item_Quicksilver's cleanse, Hollow
  Radiance) + 5 armor/HP (Randuin, Sunfire — one shared `Item_Immolate`
  serves both burn items, Heartsteel capped at +20 max HP, Gargoyle,
  Iceborn subclassing SpellbladeBuff) + Redemption (heals via `takeHeal`
  so heal cuts apply). balanceReport ratio untouched (no new item enters
  either best-six). Damage-type latch pattern: `modifyIncomingDamage` is
  the only Buff hook told the DamageType — latch there, spend in
  `onDamageTaken` after the chain settles.
- **dota 12 more** (shop now 14 finished): the physical/magic barrier pairs
  Vanguard+Crimson Guard vs Hood+Pipe (rebuilding `Shield.absorbs`
  barriers), Satanic, Power Treads, Crystalys, 5 components. Blade
  Mail/BKB/Heart already existed — check the shop before assuming a gap.
  dota pack 1.2.0 -> 1.3.0.

Nobody has PLAYED with any of these yet — per-fight feel (barrier rearm
windows, Heartsteel pacing, Pipe teamfight value) is unreviewed.
