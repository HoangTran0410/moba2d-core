---
name: moba2d-pet-kill-credit
description: "Who a kill is booked to in core: killCreditedTo for pets and creditForDeath for turret/minion/camp executions — both pushed 2026-09-02"
metadata:
  type: project
---

Two rounds of the same question — `AttackableUnit.die` credited whoever landed
the blow, and "whoever landed the blow" is the wrong answer twice.

**Round 1 (pets), reported 2026-09-02.** A Naruto clone (or Shaco's boxes,
Zed's shadow) last-hitting a minion paid **nobody**: `Pet` sets `wallet =
null`, `killCredit = 'none'`, `awardsAssists = false` on purpose, so
`killer.wallet?.earn(bounty)` swallowed the bounty and `minionsKilled++` went
onto a tally that dies with the summon. Fix: `killCreditedTo`, the mirror of
`killCredit` — that one asks the **victim** "what is killing me worth", this
one asks the **killer** "whose kill is this". Default `this`; `Pet` returns
`ownerUnit`; `Turret` deliberately unchanged (no owner to walk up to, so its
last hit still denies the gold). `UnitDeathEvent` gained `creditedTo` beside
`killer`. Core commit `e56d065`. Pushed to `main` on 2026-09-02 (auto-deploys to
Cloudflare Pages).

**Round 2 (executions), 2026-09-02, core `da09645`, pushed.** The
user's words: fighting an enemy champion *and* their minions, the minion lands
the last hit, and "tướng phải là người được mạng". League's rule, now core's:
`AttackableUnit.creditForDeath` books a **champion's** death to the last enemy
champion who damaged them inside `economy.killCreditWindowMs`
(`KILL_CREDIT_WINDOW_MS`, 10s) whenever the finishing blow came from anything
that is not a champion — turret, minion, camp, or nothing named at all.

Facts worth not re-deriving:

- **The gate is the victim's `killCredit === 'champion'`.** Farm must stay
  last-hit: a minion is `'minion'`, and a dragon sniped by the enemy's smite is
  the play, not a bug.
- **The candidate filter is the *attacker's* `killCredit === 'champion'`** —
  the discriminator `BotBrain`, `TeamBlackboard`, `Announcer` and `hudState`
  already use for "is this a champion". No `instanceof`.
- It reads `_assistLedger`, the same ledger `payAssists` uses, so pet damage is
  already booked to the owner. **Scan for the max `seen`, never take the last
  entry**: `Map` keeps *insertion* order and `rememberParticipant` re-`set`s an
  existing key without moving it.
- `die()` now clears `_assistLedger` on the death transition, so a fight does
  not carry into the next life. Both readers run before the clear, which is why
  `credited` is computed once at the top of `die()`.
- The death-recap headline (`deathRecap.killerName`) follows `credited` too, so
  the recap and the kill feed cannot disagree; the per-row damage log still
  names the turret.
- A LAN client is unaffected: its `takeDamage` is gated, so its ledger is empty
  and `creditForDeath` falls through to the direct killer.
- New tests: `tests/game/combat/killCredit.test.ts` (15 cases).

**Trap that cost a cycle:** `tests/game/types/BuffUnitTypes.test.ts` runs
`expect(source).not.toMatch(/\bany\b/)` over the *raw source* of
`AttackableUnit.ts` and friends — the English word "any" **in a comment** fails
the gate. Reword. This is a second, separate comment-scan gate from the pack-name
one in [[moba2d-monster-attack-vfx]].

**Verify is not green in this checkout and that is not your change:** the three
dev-linked packs ([[moba2d-multi-pack-install]]) make `links:check`,
`chunks:check` and 6 test files fail on `main` too. Baseline them by stashing
only your own files — `git stash push -- <paths>`, never `-- src`, which also
stashes the modified `src/generated/installedPacks.ts` and hides the cause.

See [[moba2d-naruto-pack]].
