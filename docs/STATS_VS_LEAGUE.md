# Stats, against the game this one is inspired by

What League of Legends has, what this engine has, and where the two deliberately
differ. Written so nobody has to read Riot's wiki and a C# server again to
answer "should this be points or a fraction, and which slot does it land on".

Sources, all read on 2026-08-31: the official wiki's
[Champion statistic](https://wiki.leagueoflegends.com/en-us/Champion_statistic),
[Armor penetration](https://wiki.leagueoflegends.com/en-us/Armor_penetration),
[Ability haste](https://wiki.leagueoflegends.com/en-us/Ability_haste),
[Tenacity](https://wiki.leagueoflegends.com/en-us/Tenacity),
[Heal and shield power](https://wiki.leagueoflegends.com/en-us/Heal_and_shield_power)
and [Gold efficiency](https://wiki.leagueoflegends.com/en-us/Gold_efficiency);
[LeagueSandbox/GameServer](https://github.com/LeagueSandbox/GameServer)
(`Stat.cs`, `Stats.cs`, `ItemManager.cs`); and Data Dragon 16.16.1's
`item.json`, counted directly.

---

## 1. The formula is the same formula

`GameServer/Logic/GameObjects/Stat.cs`:

```csharp
Total = ((BaseValue + BaseBonus) * (1 + PercentBaseBonus) + FlatBonus) * (1 + PercentBonus)
```

`Stat.value` in `src/game/gameObject/Stats.ts` is that expression, character for
character, with the same five slots and the same add/remove pair. This was not
copied — it was arrived at independently and then checked — which is worth
knowing, because it means **the slot arguments in that file transfer directly**:
if the wiki says a bonus is additive with other bonuses of its kind before
multiplying the base, it belongs in `percentBaseBonus`, and reasoning about
League's stacking rules is reasoning about ours.

**An item is a buff on both sides, too.** LeagueSandbox has
`public class ItemType : IBuff`; buying calls `Stats.AddBuff(itemTemplate)` and
selling calls `RemoveBuff`. That is `HeldItem.modifier` with
`stats.addModifier` / `removeModifier` — the same design, which is why an item
that grants armour and a buff that grants armour are indistinguishable
downstream here.

## 2. Do not import Riot's item data

The temptation is to read `item.json` and get a shop for free. It does not work,
and the measurement is why: across **868 items** in 16.16.1, the `stats` block
uses **only 12 distinct keys** — `FlatHPPoolMod` 265 times,
`FlatPhysicalDamageMod` 201, `PercentAttackSpeedMod` 92, `PercentLifeStealMod`
25, and a thin tail. There is **no key at all** for armour penetration, magic
penetration, tenacity, ability haste, omnivamp, heal-and-shield power, or any
other stat introduced after about 2014. Everything modern lives in the item's
**description text**.

So an importer reading `stats` produces a shop missing half of what each item
does, silently and plausibly. The lol pack imports **icons and Vietnamese names
only** (`scripts/import-items.mjs`, with a provenance ledger in
`docs/items-source-manifest.json`); every number is chosen against this engine's
own economy.

The one useful thing in that block is the **slot mapping**
(`ItemManager.cs:145-166`), and three rows of it are worth stating:

| Riot key | Lands on | What it tells you |
|---|---|---|
| `FlatMagicDamageMod` | `AbilityPower.FlatBonus` | AP is **points** there, because their abilities each carry an AP ratio |
| `PercentMagicDamageMod` | `AbilityPower.PercentBonus` | this is Rabadon's, and it is a multiplier over the points |
| `PercentAttackSpeedMod` | `AttackSpeed.FlatBonus` | see below — the trap in this table |

**The attack-speed row is a difference in what the stat *stores*, not a
disagreement.** In LeagueSandbox, `AttackSpeed` is a *multiplier* whose base is
1.0, sitting beside a separate per-champion base rate; adding 0.3 to its
`FlatBonus` therefore means ×1.3 on the champion's own rate. Here,
`stats.attackSpeed` **is** the rate in swings per second, base and all. So the
slot that means the same thing is `percentBaseBonus` — the inner factor, where
bonuses pool additively and multiply the base once. Reading their mapping
literally would give every champion the same absolute number of extra swings,
which is the bug this engine had until core 1.16.

## 3. The stat list, side by side

| | League | moba2d |
|---|---|---|
| Attack damage | points | `attackDamage`, points |
| Ability power | points, with per-spell ratios | `abilityPower`, **a fraction**, see §4 |
| Attack speed | % of base | `attackSpeed`, % of base (`percentBaseBonus`) |
| Crit chance / damage | % | `critChance` / `critDamage`, % |
| Armour / magic penetration | **points (lethality) and %** | `armorPenetration` / `magicPenetration`, **% only** |
| Life steal / omnivamp | % | `lifesteal` / `omnivamp` / `spellVamp`, % |
| Health, health regen | points, regen per 5s | `maxHealth`, `healthRegen` **per frame** |
| Armour, magic resist | points | `armor`, `magicResist`, points |
| Tenacity | %, capped at 100 | `tenacity`, %, `Stat` max 1 |
| Slow resist | % | — not modelled |
| Ability haste | points | `abilityHaste`, points |
| Mana, mana regen, energy | points | `maxMana`, `manaRegen`; no energy |
| Move speed | flat **and** % | `speed` flat, `speedPercent` % |
| Attack range | points | `attackRange` |
| Heal & shield power (outgoing) | % | — not modelled, see §4 |
| Healing received (Spirit Visage) | item passive | `healingReceived`, a real stat |
| Gold per 10s | points | — not modelled |

Beyond the list, this engine has `onHitDamage`, `visionRadius`, `size` and
`height` as stats, because it needs them and they were free.

## 4. The four deliberate divergences

Everything above that does not line up is one of these, and each is a decision
rather than a gap.

### a. Ability power is a multiplier, not points

**League:** every ability declares its own AP ratio, and an item grants points.
**Here:** `abilityPower` is a *fraction* applied once at the damage funnel
(`combat/Amplification.ts`), so `abilityPower: 0.35` is "+35% ability damage"
for every ability in every pack, and no spell reads a stat of its caster.

This is the single biggest divergence and it is load-bearing: it is what lets a
pack author write a new spell without also writing a scaling clause, and it is
why 308 abilities across two packs scaled with a build the day the stat landed,
without any of them being edited. The cost is that per-spell scaling cannot be
expressed at all — a spell that should scale twice as hard as its neighbour has
no way to say so.

**If that ever needs to change**, the migration is additive rather than a
rewrite: keep the global multiplier and let a spell opt into an extra `apRatio`.
Turning `abilityPower` into points and demanding a ratio per spell would make
every new spell harder to write, which is the wrong trade for this project.

**Read `abilityPower: 1.6` correctly.** It is not "160 ability power", it is
**+160% ability damage** — roughly a whole League build in one item. The lol
shop was audited against exactly this misreading, and several items were
retuned; Rabadon's is the ceiling of the shelf now rather than the middle of it.

### b. Penetration is a share, never points

League has both lethality (flat) and percent penetration. This engine models
only the share, on purpose: flat penetration is worth wildly different amounts
against a 20-armour support and a 300-armour tank, and this engine's resistances
live on a much shorter scale than League's.

**The order rule is theirs and we match it.** The wiki: *"percentage reductions
and penetrations no longer apply once armor reaches 0 or below."*
`combat/Mitigation.ts` returns early when the resistance is already `<= 0`,
because a share of a negative number **gives armour back** — a shred put it
there, and penetration must not undo a shred.

### c. Tenacity does not cover everything that stops you

League exempts knock-ups, **nearsight**, **suppression**, stasis and drowsy, and
applies a 0.3s floor. This engine's `CROWD_CONTROL_FLAGS` originally included
`NearSighted` and `Suppressed`, so Mercury's Treads shortened two effects the
source game deliberately leaves alone. `TENACITY_EXEMPT_FLAGS` and
`TENACITY_FLOOR_MS` in `AttackableUnit.ts` are that fix. Tenacity is applied
**once, in `addBuff`**, and only to what somebody *else* landed — never to a
self-buff.

### d. Ability haste, because the fraction was the mistake Riot already made

`cooldownReduction` was a fraction that stacked additively under a hard 60% cap,
which is precisely the system Riot replaced in late 2020. The argument, which
holds here for the same reasons:

- casts per second is **linear in haste** (`100 / (100 + haste)`), so every
  point is worth the same as the last;
- under a capped fraction, each point was worth *more* than the last, which is
  why a shop could not price it and why a cap was needed to keep a cooldown off
  zero;
- with haste, `MAX_ABILITY_HASTE` (500) is a runaway rail, not a balance line.

Related: **`healPower` was renamed to `healingReceived`** in the same pass,
because League has *two* different things and the old name was the other one.
"Heal and shield power" boosts healing you **cause** and does not touch
regeneration or life steal; "healing received" is Spirit Visage's own passive.
This engine implements the second — including regen — so the name now says so.

## 5. Move speed: two stats, on purpose

`speed` is flat and `speedPercent` is a share, exactly as Riot's data carries
`FlatMovementSpeedMod` beside `PercentMovementSpeedMod`. Boots are flat; the
Zeal-line items are percent.

**Flat move speed is not the trap that flat attack speed was.** Every champion
here starts on `Stats.speed` 3 — no pack declares a per-champion walk, and
`Champion.mapScale.speedMult` scales everyone alike — so a flat grant is the
same share for everybody. Attack speed was a rate that differed per champion
(0.7 to 1.65), which is what made a flat grant quietly worth most to whoever
needed it least. The move-speed pair exists for what the two stack *with*:
percent lands on the **outer** `percentBonus`, so it multiplies the boots rather
than ignoring them, giving `(3 + 0.45) * 1.07` — League's own
`(base + flat) * (1 + %)`.

It also has to stay clear of `Slow`, which writes `speed.percentBaseBonus`. Put
an item's percent in the same slot and a 30% slow plus a 30% item cancel to
nothing, which is a cripple a player buys their way out of by arithmetic
accident.

## 6. Riot's gold-per-point table, and why ours cannot match it

Riot's own numbers, for reference:

| Stat | Gold/point | Stat | Gold/point |
|---|---|---|---|
| Attack damage | 35 | Crit chance | 40 per % |
| Ability power | 20 | Attack speed | 25 per % |
| Armour | 20 | Move speed | 12 |
| Magic resist | 20 | Ability haste | 50 |
| Health | 2.67 | Armour pen | 41.67 per % |
| Mana | 1 | Lethality | 30 |
| Health regen /5s | 3 | Life steal | 53.55 |

**Do not price this shop off that table.** Two ratios show why:

- **AD : armour** is 1.75 in League and 3.5 here.
- **Health : armour** is 0.13 per point in League and 0.96 here.

Health is about seven times more valuable relative to armour here, because a
champion has a **100-point pool** rather than 2000+. That is not an error — it
falls out of the economy this game is tuned to (500 starting gold, 2/s income, a
ten-minute match, a three-item full build). But it explains a shape that reads
wrong at a glance: Hồng Ngọc at 400g for 25 health *sounds* cheap and is
actually priced level with 25 armour.

The table is still useful for one thing: **relative** sanity within a shelf. If
one item's ability power costs 1550g per point and another gives it away free,
something is wrong regardless of what the absolute number should be — which is
how the 2026-09-01 audit found Vĩnh Sương and Khúc Ca Shurelya priced below
their non-AP stats alone.

## 7. Where the rules live in code

| Question | File |
|---|---|
| the five-slot formula, every stat, the rails | `src/game/gameObject/Stats.ts` |
| which slot an item's grant lands on | `src/game/items/Item.ts` (`GRANT_SLOT`) |
| which stats an item may grant at all | `src/game/items/itemStats.ts` |
| how a stat is *printed* | `src/game/hud/itemStatLines.ts` (`AS_PERCENT`) |
| penetration and the negative-resistance rule | `src/game/combat/Mitigation.ts` |
| healing reduction, both doors into the pool | `src/game/combat/Healing.ts` |
| shield reduction, kept separate on purpose | `src/game/combat/Shielding.ts` |
| tenacity, its exemptions and its floor | `src/game/gameObject/attackableUnits/AttackableUnit.ts` |
| the rules every pack's shop obeys | `src/testing/itemRules.ts` |

Adding a stat is six edits in `Stats.ts` (`statFieldParity.test.ts` enforces
them) plus `ITEM_STAT_KEYS`, `STAT_LABEL`, `AS_PERCENT`, `STAT_ICON`,
`BotShopper` and `participantStats`. The two `Record<ItemStatKey, …>` tables
make the compiler catch most of it; `AS_PERCENT` is a plain `Set` and is the one
that has actually gone stale, printing attack speed as `+0.15` on a card that
meant +15%.
