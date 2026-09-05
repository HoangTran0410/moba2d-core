---
name: moba2d-unstoppable-dash
description: Dash.unstoppable + Buff.blocksIncoming (2026-09-05) — a displacement is another Dash and used to replace a charge outright; uncommitted on core+lol
metadata: 
  node_type: memory
  type: project
  originSessionId: 39240f27-05a9-4656-82f9-d50bb98cf249
  modified: 2026-09-04T21:04:44.581Z
---

Landed 2026-09-05, **uncommitted** on `moba2d-core` and `lol`. Bug as reported:
Malphite R's card says "Không thể cản phá bởi các hiệu ứng khống chế" but
Temari's W and R still stopped it.

**The mechanism, which is general and worth knowing:** every pull, knockback and
throw in every pack is `new api.buffs.Dash(...)` applied to the *victim*. Core's
`Dash.buffAddType` is `REPLACE_EXISTING` and `Buff.stackId` is `new.target`, so
an incoming displacement shares a stack with a charge already in flight and
`AttackableUnit.addBuff` deactivates the charge to make room. Nothing consults
`cancelable` — that flag only skips the `foreignControlBuff` check inside
`Dash.onUpdate`, which is a different question. 34 spells across the packs set
`cancelable = false` and almost all of them mean "my own pull must not be
cancelled by my own slow", not "I am unstoppable".

Fix, in three pieces:
- `Buff.blocksIncoming?(incoming): boolean` — a live buff gets a say in what
  lands. `AttackableUnit.addBuff` asks every live buff **before** tenacity and
  before the `buffAddType` switch. First and so far only user is Dash.
- `Dash.unstoppable = false` (new). When true it refuses a foreign `Dash`
  (`incoming.sourceUnit !== this.sourceUnit`, so a self-renewing drag still
  renews) and implies `cancelable = false`. Every non-Dash buff still lands —
  the promise is that CC cannot *stop the charge*, not that it cannot apply.
- `Malphite_R` swaps `cancelable = false` for `unstoppable = true`.

**Three cards make the claim, in three different sentences**, and the first two
greps found only one: "Không thể cản phá bởi các hiệu ứng khống chế"
(`Malphite_R`), "không gì cản được" (`Vi_R`), "không ngăn được cú kéo này"
(`Amumu_Q`). All three now set `unstoppable = true`; Vi R had been expressing it
as `buffsToCheckCancel = []`, which `unstoppable` subsumes (the interrupt check
is not reached at all), and Amumu Q as `cancelable = false`. The other 33
`cancelable = false` uses need **no** change — the flag's meaning is untouched,
and almost all of them are displacements meaning "my own pull must not be
cancelled by my own slow".

Guarded by a source sweep in `lol/tests/spells/Malphite_R.test.ts`: any spell
whose *description* (not its comments — that file's own prose names all three)
carries one of the promise phrases must contain `unstoppable = true`. Proven to
fail by reverting Vi R. Add the phrase to `PROMISES` when a new card says it a
new way.

**Why:** the trap is that "cancelable" reads like it covers this and does not,
and the interaction is invisible from either side alone.

**How to apply:** two traps hit while doing this — core's vocabulary gate
(`vocabularyBoundary` / `corePackTarball`) fails on the word *Malphite* in a
core **comment**, so describe the case without naming a pack champion; and
`lol/tests/noCoreReach.test.ts` hard-codes the pack test-file count (now 124),
which must be bumped with a note when adding a pack test. See
[[moba2d-workspace-layout]].
