---
name: moba2d-death-recap
description: "Death recap: shields now reported, window is an engagement gap not a clock, non-champions group by kind (2026-09-04)"
metadata:
  type: project
---

Landed 2026-09-04 in `moba2d-core/`, uncommitted branch
`feat/damage-text-helpers`. Related: [[moba2d-bot-toggles]].

**Shields were invisible.** `takeDamage` runs `modifyIncomingDamage` (shields
and damage-reduction buffs) and **returns early when the hit is eaten whole**,
so a fully absorbed blow wrote nothing to the ledger at all — a player who died
behind a big bubble read a recap listing only what got through. `swung` (post-
resistance, pre-shield) minus the surviving damage is the absorbed part;
`DamageLogEntry.blocked` carries it, an entry is now written even at `amount:
0`, and the panel prints "khiên chặn N" plus a per-source 🛡 chip in the colour
the health bar's own shield segment wears. LAN gets it free — `HostSession`
forwards the whole `recap` object.

**The window was 12s measured from the newest hit, re-applied on every hit** —
so a finisher's blows walked the cutoff forward and ate the earlier fight one
hit at a time. Replaced by `DEATH_RECAP_ENGAGEMENT_GAP_MS = 8_000`: prune back
to the newest *gap* of that size between consecutive entries. League's own
recap is a short rolling window of about the same size and is widely
criticised for exactly this failure, so matching it was not worth doing.

**The gap rule only works with merging.** `DEATH_RECAP_MERGE_MS = 1_000` folds
hits sharing (attacker, source, type); without it a damage-over-time spends the
whole 60-entry budget on ticks, the cap trims from the front, and the start of
the fight vanishes through a different door. Merge searches *backwards through
the window*, not just the last entry — two enemies trading blows alternate, and
a last-entry-only merge never collapses that. `DamageLogEntry.hits` carries the
count; `hudState` must sum `entry.hits`, not count entries.

**Non-champion attackers group by kind** (`recapGroupOf`): `attackerId` is the
unit id for `killCredit === 'champion'` and the display *name* otherwise, so a
wave is one row instead of six. Champions keep their id because two bots can be
the same champion. `recapIconsFor` keys on the source label, not `attackerId`,
so this does not disturb icons.

**Trap:** a test that burns a victim down triggers `die()`, which *clears* the
ledger — give the victim a deep pool when testing accumulation.


## Identity, not the body (2026-09-04, pushed)

Rows were keyed on the attacker's **unit id**, but a bot becomes a different
champion every time it dies (`AIChampion._autoReroll`, default on), and the row
takes its label from its *first* entry — so everything one body ever did
collected under whoever it was first. Symptom: "Hạ gục bởi X" with no X row and
X's abilities filed under the champion that body used to be. Random, because it
needs a bot to die and re-roll mid-engagement — and the 8s engagement window
made it far more reachable than the old 12s clock. `recapGroupOf` now keys
champions on `` `${id}\u0000${name}` ``.

## Damage dealt, same window (2026-09-04, pushed)

`AttackableUnit.recentDamageDealtLog` is the other end of the same ledger,
written at the `tally.damageDealt` site and pruned by the **same** `pruneLog`.
`die()` snapshots and clears both. In an outgoing entry
`attackerName`/`attackerId` name the **victim**.

A first attempt used `MatchTally.damageDealtByType` (match totals) — rejected by
the user: the two numbers sit side by side and must cover the same stretch of
time to be comparable. That field was removed rather than left beside the
ledger; two places keeping one number is how they drift.

**Core bans pack champion names in `src/` comments** and I tripped that gate
twice more this session (a Lux W note, then a Jinx/Alistar one). Describe
champions by archetype in core; tests are not scanned.
