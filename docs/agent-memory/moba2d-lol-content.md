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
