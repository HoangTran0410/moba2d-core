---
name: moba2d-vamp-and-heal-cut
description: "Core 1.16 stat model + share-of-the-wearer grants + the record-parity sweep — counters (heal/shield cut, penetration, tenacity), ability haste, healingReceived — the lol pack's 25 new items, and the dota pack that 1.16 had silently broken (2026-09-01, committed)"
metadata: 
  node_type: memory
  type: project
  originSessionId: eafb93ee-cfe2-4d69-9a7a-fa23014ffe9e
  modified: 2026-08-31T19:41:01.267Z
---

Built 2026-09-01, **committed on `main` in all three repos, unpushed** — core
`649672b`/`f6c5f18`/`2158714`/`4cba92f`, lol `371b1f3`/`797fe73`, dota
`9cc6580`. Related: [[moba2d-shop-and-editor-seams]],
[[moba2d-workspace-layout]].

**The research behind all of this is written down: `docs/STATS_VS_LEAGUE.md`
in core** (linked from CLAUDE.md's doc table). Riot's wiki + LeagueSandbox's
`Stat.cs`/`ItemManager.cs` + Data Dragon 16.16.1 counted directly — the shared
five-slot formula, why Riot's `item.json` `stats` block must not be imported
(868 items, 12 keys, nothing modern), why `PercentAttackSpeedMod → FlatBonus`
maps to *our* `percentBaseBonus`, the four deliberate divergences, and Riot's
gold-per-point table with the reason it cannot price this shop. **Do not
re-research this** — read that file. The dota pack has its own half,
`dota/docs/STATS_VS_DOTA.md` + `tests/statConversion.test.ts`: convert a Dota
number **as a share of the health pool, never as a number** (time and mana are
the only axes that carry across nearly as written), and **dota must never use
`armorPenetration`/`magicPenetration`** — Desolator and Veil debuff the victim
so the whole team benefits, which is why they get drafted. It was recovered from this session's own
transcript after the offer to write it went unanswered for a day, which is
itself the lesson: an offer to write something down should just be taken.

**Core already had all three vamp stats before this** — `combat/Vamp.ts` splits
by *damage type*, not by League's attack/ability line: `lifesteal` pays out of
PHYSICAL+TRUE, `spellVamp` out of MAGIC, `omnivamp` out of all three, and they
add (clamped at 1). No item in the lol pack sold the first two until now.

**What was new: `combat/Healing.ts` + `buffs/HealCut.ts` (core 1.13.0).**
Health enters the pool by **two doors** — `AttackableUnit.takeHeal` and
`Stats.update`'s `healthRegen` — so `Stats.update(healingMultiplier = 1)` takes
the cut as an argument (`AttackableUnit.update` is its one caller, reading it
*after* `updateBuffs`). Strongest live `Buff.healCut` wins, they never sum, and
a shield is deliberately untouched. Structural interface like `Vamp.ts`, so any
buff exposing `healCut` cuts healing — the class is only what packs apply.

**`Buff.onDamageDealt(swung, landed, victim, type)`** is the attacker-side
mirror of `onDamageTaken`, walked from the victim's `takeDamage` over
`[...attacker.buffs]`, on both the normal and the shield-ate-it path (`landed`
0), never for self-damage. It exists because `Buff.onHit` is basic attacks
only, so a mage's wound item had nothing to hang on.

**A new `api.buffs.*` entry costs five edits**: the buff file, `ContentApi`'s
`BUFFS`, `content/types.ts` (`contentTypes.test.ts` fails otherwise), the
`contentApi.test.ts` title's buff count, then `npm run contract:bump` (bumps
core's *minor* and rewrites the API snapshot). Pack floor then goes to
`>=1.13.0` in `data.ts`'s `manifest`, with a paragraph in the note above it.

**Pack side (lol): 13 items, 3 passives — one per *trigger*, not per item.**
`Item_GrievousStrike` (physical+true), `Item_GrievousMagic` (magic),
`Item_BrambleVest` (`onDamageTaken`, wounds the attacker). Six items share
them. Giáp Gai now builds from Áo Choàng Gai + Giáp Lụa and arms the
component's wound itself, or the upgrade would silently drop it.

**Counts pinned in tests, all of which fail on any new item or test file:**
`items.test.ts`'s `SPEC` table + the written-out count + `registry.items()` length +
`ITEM_SPELL_IDS` + its own `COMPONENTS` list; `catalogCompleteness.test.ts`'s
`fromItems.size`; `noCoreReach.test.ts`'s `files.length`.

**Core 1.14 added three more counters, same shape as the wound.**
`armorPenetration`/`magicPenetration` are *shares* read in
`combat/Mitigation.ts` (`effectiveDamage` grew a 4th arg, `attacker`) and must
never touch an already-negative resistance; `tenacity` is applied once in
`addBuff` against `CROWD_CONTROL_FLAGS` and only to what someone else landed;
`healPower` is the heal cut's mirror and *multiplies* with it. A new stat costs
six edits in `Stats.ts` (`statFieldParity.test.ts` enforces) plus
`ITEM_STAT_KEYS`, `hud/itemStatLines.ts`'s `STAT_LABEL`/`AS_PERCENT` and
`hud/statIcons.ts`'s `STAT_ICON` — the last two are `Record<ItemStatKey, …>`,
so the compiler and `statIcons.test.ts` catch them.

**Core 1.15 added the fourth counter: `combat/Shielding.ts` + `buffs/ShieldCut`.**
Applied in `Shield.onCreate`, after the ability-power amplification and
**before `_initialAmount`** (the health bar draws a fraction of that, so
cutting after it paints a half shield reading as full). It reaches only shields
granted *while* the cut is on — never one already standing. It is its own
module rather than part of `Healing.ts` because that file's header states a
shield is not a heal and a wound is deliberately powerless against it.

**Stripping ≠ cutting.** `Renekton_W` (enraged) already deletes every live
`Shield` on the target by calling `deactivateBuff()` on each — that is the
answer to the shield standing now, and re-casting beats it. Kiếm Ác Xà cuts
what is granted *next*. Both can exist; do not treat one as the other.

**`Renekton_E`'s shred was the wrong stat for its whole life.** The buff is
named Rách Giáp and `docs/abilities/renekton/e.json` says "inflicts armor
reduction", but the code applied `attackDamage: { percentBaseBonus: -0.25 }` —
untested, and the tooltip said "sát thương". Fixed 2026-09-01 to
`armor: { percentBonus: -0.25 }`. **`percentBonus` vs `percentBaseBonus`
matters**: the inner slot only scales base+baseBonus, so a reduction written
there ignores everything the target bought.

**Core 1.16 replaced `cooldownReduction` with `abilityHaste` (points).**
`Stats.hasteCooldownMultiplier` = `100/(100+haste)`; `MAX_COOLDOWN_REDUCTION`
(0.6) is gone and `MAX_ABILITY_HASTE` (500) is a runaway rail, not a balance
line. Rationale, verified against the LoL wiki: casts/second is linear in
haste, so every point is worth the same and no cap is needed — the fraction
needed one, and under a cap each point was worth more than the last, which is
why a shop could not price it. `healPower` also became `healingReceived` in the
same pass (League has *two* things there: outgoing "heal and shield power",
which does not touch regen or lifesteal, and Spirit Visage's "healing
received"; ours is the second, and the name now says so).

**Renaming a stat is 6 places in `Stats.ts` + `ITEM_STAT_KEYS` +
`itemStatLines` (`STAT_LABEL`, `AS_PERCENT`) + `statIcons` + `BotShopper`'s
`BODY_FIELD`/valuation + `participantStats` + `src/testing/itemRules.ts`**, and
the pack fails *loudly* at install if it is missed (`validate.ts` names the key
— that is how the missed `healPower` in `spirit_visage` was found).

**Attack speed is a share of the wearer's base now, not swings a second.**
`items/Item.ts`'s `GRANT_SLOT` (was `PERCENT_OF_BASE`, now a `key -> [field,
slot]` table so a key may name a stat other than itself) routes the item grant
to `percentBaseBonus` (the *inner* factor), so every bonus pools additively and
multiplies the base once — League's arrangement. **Slows stay on the outer
`percentBonus`** so they multiply whatever the build reached. Two consequences
that bite: a **monster's** `stats.attackSpeed` base is 0 (it swings on
`attackInterval`), so a share of it is nothing — the chemtech drake's self-buff
had to stay flat; and **every test fixture leaves champions at base 0**, so any
probe asserting an attack-speed bonus has to set `baseValue` first (four tests
had to learn this).

**The `Ghosted` trap, found in play:** Janna's W passive (permanent) and
Nocturne's Q trail buff both carried `StatusFlags.Ghosted`, which also disables
`pushOutOfWalls` — so they walked through terrain and could leave the map.
Core's own `StatusFlags` doc reserves `Ghosted` for a *dash*; anything with a
duration wants `PhasesUnits`. Pantheon R keeps `Ghosted` on purpose (he is 700px
above the map). The Janna test had *asserted* `Ghosted`, pinning the bug.

**A camp that was *shoved* now walks back to its point, not to the edge of its
leash circle** (`Monster.wasShoved()`, off `AttackableUnit.displacementRevision`
vs a `_settledRevision` cleared on arriving home and on aggro). The old rule
only fired on `isOutsideCamp()`, and the pits this pack ships are **200 and 250
wide against a 260 knockback** — so Janna's Monsoon usually left the camp inside
its own circle, and a camp with no `wanderSpeed` stood where it was dumped for
the rest of the match. Reported from a real match. Packmate jostling never calls
`markDisplaced`, which is what keeps the wolves from shuffling home for ever.

**A knockback that overrides `Dash.onActivate` must call `super` first.**
`Janna_R_Knockback` replaced it outright and so skipped `blockedByGround` /
`blockedByAnchor` — Monsoon shoved bodies the engine had already ruled
unshovable. Its `onDeactivate` also wrote the target's `destination`, which
pinned a camp exactly where it landed; it calls `stopMovement()` now and lets
the body's own phase decide where to go next.

**The record-parity sweep (2026-09-01).** A sonnet subagent diffed every
`docs/abilities/<champ>/<slot>.json` against its implementation for mechanics
the engine only recently gained, and found **11 abilities shipping
substitutes**: Annie R / Darius E / Pantheon R had no penetration passive at
all; Garen E, Jarvan Q, Nasus E and Vi W were missing armour reduction (Vi's
was a *movement slow* under a buff named Rách Giáp); Garen W used omnivamp
where the record says 60% tenacity; Katarina R, Varus E and Singed R+Q were
missing Grievous Wounds. All fixed, and **`tests/spells/recordParity.test.ts`
is the single place that checks abilities against their records** — start any
future sweep there.

**`tests/content/items.test.ts`'s "not a stat" example keeps going stale**: it
used `abilityPower`, then `abilityHaste`, both of which became real. It is
`lethality` now — a thing the engine deliberately declines to model (penetration
here is a share, never flat points).

**The lol shop is 58 items now, and it has three balance gates, not one.**
`tests/balanceReport.test.ts` prints and pins the attack:ability per-gold ratio
(band 1.5–2.1, sitting at 1.89 after the haste migration); `items.test.ts` pins the best-six ability
power sum (7–9); `roleProfiles.test.ts` models a full tank against a full
marksman (3.5–6s) and now applies the carry's `armorPenetration` to the tank's
armour, because the shop sells penetration. **Both `balanceReport` and
`roleProfiles` are stats-only floors** — Rabadon's ×1.25 passive and every
on-hit proc are deliberately invisible to them, so the real ability path is
stronger than the printed ratio.

**What the 2026-09-01 audit found:** pricing a stat point off the shop's own
components shows ability power ranging from *free* (Vĩnh Sương and Khúc Ca
Shurelya cost less than their non-AP stats alone) to 1550g/point on a
component. Both were retuned, along with Vòng Sắt Mặt Trời, Gươm Suy Vong, Đao
Tím and four of the new items; 30 of 58 now sit in 85–115% of their stat value.
A per-stat efficiency table is the wrong tool for `abilityPower` on its own —
its price is set by the throughput band, not by a component anchor.

**Traps:** `StatAmp` defaults to `STACKS_AND_CONTINUE`, which deactivates only
`preBuffs[0]` and leaves the rest to the target's own sweep — an aura
re-applied every 250ms (Tim Băng) stacks two live copies unless it sets
`REPLACE_EXISTING`. `Shield.amount` is the settable field (`shieldAmount` is a
getter), and `node scripts/render-icons.mjs` re-renders *every* stale buff PNG,
not just the new one — check `git status` and revert what you did not mean to
touch. Item icons come from `npm run items:import`, which refetches all 58 from
the pinned Data Dragon patch and rewrites `docs/items-source-manifest.json`.


**The half of that change that was missed for a day: `AS_PERCENT`.**
`hud/itemStatLines.ts` decides whether a stat prints as `+0.15` or `+15%`, and
it is a *hand-written second list* that has to agree with `GRANT_SLOT`. It did
not: every attack-speed item on every shop card and inventory tooltip printed
its share as points, which reads as a fifteenth of a swing. The comment above
it even said "note who is not on it: `attackSpeed` is points in this engine".
`inventory.test.ts` now checks the two lists against each other **in one
direction only** — `AS_PERCENT` is deliberately wider, since `abilityPower:
0.35` is a fraction that lands on `flatBonus`. The user found this one by
reading the shop.

**`speedPercent` is a real item stat, beside `speed`, not instead of it** —
the way Riot's own data carries `PercentMovementSpeedMod` beside
`FlatMovementSpeedMod`. Flat lands on `speed.flatBonus`; percent lands on the
**outer** `percentBonus`, so `(3 + 0.45) * 1.07` and it multiplies the boots
instead of ignoring them. It also stays clear of `Slow`, which writes
`speed.percentBaseBonus` — put an item's percent there and a 30% slow plus a
30% item cancel to nothing. **Flat move speed is *not* the same defect as flat
attack speed**: every champion starts on `Stats.speed` 3 (packs set no
per-champion walk; `Champion.mapScale.speedMult` scales everyone alike), so
flat is fair here in a way it never was for a rate. The pair exists for what
they stack *with*, nothing else. Trinity Force and Dead Man's Plate use it (5%
each, per the wiki). New item stat = `ITEM_STAT_KEYS` + `STAT_LABEL` (must be
**distinct text** — `shopFilter.ts` keys its chips by label, so two "Tốc chạy"
collapse into one chip) + `AS_PERCENT` + `STAT_ICON` (must be a *unique* icon,
`statIcons.test.ts`) + `BotShopper`'s `BODY_FIELD`/`SHARE_OF`/`BotBody`.

**The dota pack had been dead since core 1.16 and nobody noticed.** Two items
(Đá Hư Không, Eul's) granted `cooldownReduction`, `ITEM_STAT_KEYS` is an
allow-list, and `validate.ts` refuses the **whole pack** over one unknown key —
so every hero, spell and map in it was unreachable, with one test
(`packInstallable.test.ts`) as the only signal. Now 1.2.0 against
`>=1.16.0`, 0.1/0.15 CDR → 12/18 haste. **After any breaking core change,
run dota's `npm run verify` too** — it is the pack that gets forgotten, and its
floor comment block in `pack.ts` is where the reasoning per version lives.

**Two things found in the tree that were not mine and had to be judged:**
`monsters/Dragon.ts` had `ROTATION` randomised with a module-level
`Math.random()` — a different drake order per client in the same LAN match, and
six failing tests; reverted to the declared order (a real roll needs a
host-shared seed). And `tests/game/combat/meleeSwingArt.test.ts` had
`afterEach(() => vi.unstubAllGlobals())`, an expression-bodied arrow returning
`VitestUtils`, which only `tsconfig.strict-core.json` rejects — so it passed
`typecheck` and failed `verify` for everything else in the tree.
