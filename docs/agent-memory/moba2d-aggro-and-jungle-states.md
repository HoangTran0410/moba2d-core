---
name: moba2d-aggro-and-jungle-states
description: "Turret/minion target priority ladder, camp wander state, and the 7-drake dragon pit (landed 2026-08-30, unpushed)"
metadata:
  node_type: memory
  type: project
---

Landed 2026-08-30, **unpushed**: core `3be93a9` `3f74329` `3e5cd83` on
`feat/map-tuning`, lol `44b9d20` `b3d97cc` `fc62df7` on
`feat/new-jungle-camps`. Related: [[moba2d-hud-effective-numbers]],
[[moba2d-monster-attack-vfx]], [[moba2d-map-tuning]].

**Temperament, 2026-09-01 (`ea89912`) — one fixed bug and one live design
question.** `skittish` entered `FLEE` correctly but could not move: `fleePoint`
tried three fixed hops (420/260/130) and kept only candidates inside
`roamContains`, which for a plain camp is a circle of `camp.r` about the body's
own home, so **every** candidate failed for a pit under ~130 units and the
fallback is "go home" — where a body on its own spot already is. Measured:
`r: 300` retreated 108 units, `r: 150` 82, `r: 100` and `r: 60` zero. The ladder
is shares of the room available now (`MONSTER_FLEE_SHARES`, capped by
`MONSTER_FLEE_REACH`). **`passive` is not a bug and may still be wrong**: no
camp in this engine initiates at all — `updateIdle` has no proximity aggro, so
even `aggressive` waits to be hit — which leaves `passive`'s only difference
being that it does not *retaliate*, i.e. a punching bag. The user asked about
it on 2026-09-01 and it was left unchanged pending their call; the obvious
alternative meanings are "does not retaliate" (today) versus "does not
initiate" (worthless here) versus a fourth value.

**`combat/AggroPriority.ts` is the one place a turret or a wave picks a
target.** Ordered *(attacker, victim)* rungs, then nearest-by-kind as the
floor; a held target is given up only to a **better** rung, never an equal
one (equal ranks thrash every scan). Rungs are predicates, not constructors,
because `Minion` cannot `instanceof Turret` — `Turret` imports `Minion`. The
wave's turret rung is written as "anything else already in the candidate
set".

**`tests/game/structures/Turret.test.ts` and `tests/game/minions/Minion.test.ts`
never run here** — they import `packs/riot/maps/…`, so `pack-dependent-tests`
excludes them. Any turret/minion behaviour change needs its test in a file
that actually runs (`tests/game/combat/AggroPriority.test.ts`).

**`MonsterPresetData.wanderSpeed`** is the stroll pace; absent/0 means the
camp holds its spot, and the `wanderSpeed > 0` guard is why no existing camp
has its `speed.baseValue` written each frame. `skittish` **no longer flees on
proximity** — only `takeDamage` → `aggroOn` starts a retreat.

**The dragon pit rotates through 7**, and the body is *dressed* per spawn:
`onSpawn` writes `name`, `avatar`, `attackStyle`, `attackColor`,
`attackInterval`. The ring is `WeakSet`-guarded per camp; the dressing must
**not** be. Trap when testing this: `dragon()` in `DragonKit.test.ts` builds a
fresh `makeDragonAbilities(api)` per call, so two bodies carry two `ringed`
sets — drive one body through death and respawn or the guard is untested.
Elder gets a `StatAmp` on spawn with **no `maxHealth`** (it would not raise
`health`, so it would arrive wounded).
