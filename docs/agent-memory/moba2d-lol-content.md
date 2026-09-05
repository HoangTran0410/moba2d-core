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


## Round two of the shelves (2026-09-05 late, lol `bf92cac` + dota `2e426dd`)

~30 more, agent-built. **lol 77 -> 95**: fighter shelf (Black Cleaver — shred
as `percentBonus` -5%x3 so armor can never go negative; Sundered Sky,
Shojin, Stridebreaker = first item with BOTH passive and active, Hullbreaker
swap-modifier), marksman middle (Phantom Dancer, Collector's TRUE execute
<5% — gold half omitted, no pack gold API; RFC's +90 range armed-while-idle,
Shieldbow, Navori refunding 300ms/swing), enchanter shelf off new kindlegem
(Ardent, Moonstone never-self heal via takeHeal, Zeke, Wardstone = first
visionRadius item), Guardian Angel = clamp-to-1-HP + 50s rearm via
modifyIncomingDamage. Ratio 2.08 -> 2.06 (band 1.5-2.1); zero new AP.
**dota 26 finished / 15 components**: Force Staff (self-push only, full 480
always), Blink Dagger (needs a hidden sensor buff to hear onDamageTaken —
arming on press would leak the first blink), Mekansm, Drum, Radiance +
Vladmir auras, Skadi/Basher(4th hit)/Maelstrom(3rd hit, skips echo hits)/
Daedalus-from-Crystalys/Halberd's Disarm/Octarine (first spellVamp).

**Engine gaps the agents hit honestly (worth knowing before promising an
item):** `modifyIncomingDamage` is not told the source spell -> no honest
"block the next ability" (Edge of Night, Linken's); `Spell` carries no slot
info -> no on-ultimate-cast triggers (Hexplate); no pack-side gold API ->
no Collector bounty/Midas; no evasion model; no cooldown-reset/polymorph/
death-defiance hooks (Refresher/Hex/Aeon Disk). Nobody has played any of
round two yet.


## Rearm is core's + effect numbers scale (2026-09-06 small hours)

Three user reports in one night, all landed:

1. **`Buff.startRearm(ms)` / `rearmed`** (core `f09f0ad`) — the whole rearm
mechanism for once-in-a-while item passives: base update ticks it, the item
slot draws it (hudState pours it into the slot's cooldown fields; touch grid
shows a dim uncastable disc only while re-arming), the match's
cooldownMultiplier shortens it, and deactivation PARKS the remainder under
**(wearer, spell.name)** so neither death nor a sell-and-rebuy resets it —
keying by spell instance was the first version and selling destroyed the key
(a cooldown reset for 30% of the price; the user called it a cheat, LMHT
refuses it too). lol lifelines (GA/Banshee/Maw/Sterak/Shieldbow) + dota
barriers (Vanguard/Hood) all ride it; a barrier's purchase-time raise checks
`rearmed` first. GA revival got its own render (wings unfold + progress ring
+ motes — NOT Stasis's hourglass, user complaint). Trap paid: `\bany\b`
comment gate caught "any of this" in a Buff doc comment; and test `age()`
helpers that jump time in ONE update need one 16ms detection frame before a
rebuild window.

2. **Fixed effect numbers rot into late game** (user: "15 giáp của Pipe cuối
game ko chống chọi đc gì"). Doctrine applied across both packs (lol
`57cdcab`, dota `e2a87d4`): shields/heals -> share of the RECIPIENT's max
HP; tank-item damage -> base + share of wearer max HP; weapon procs -> share
of AD; spellblades -> share of BASE AD (AP is closed to items, total-AD
would repoint mage fangs at marksmen); flat resists -> percentBonus
multiplier. Anchored so mid-game ≈ old flat. Honest skips recorded per file
(Everfrost's payload is the root; Heartsteel's permanent +HP would compound
on itself). Anchors: MARKSMAN 125 / MAGE 135 / BRUISER 190 / TANK 220 base
HP.

3. takeHeal clamp + the whole rearm/scale sweep is live on pages.dev; the
user's PWA needed its update cycle before the slot countdown showed.
