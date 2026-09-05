---
name: moba2d-monster-attack-vfx
description: "Monster basic attacks became real objects (claw/spit/breath, plus lash 2026-09-01); style derives from attackRange for melee/ranged only"
metadata: 
  node_type: memory
  type: project
  originSessionId: 67523105-a721-4c0a-b5ca-b1a2f7f4ae83
  modified: 2026-08-29T15:28:55.299Z
---

Landed 2026-08-29 on the same unpushed branches as [[moba2d-map-tuning]]:
core `feat/map-tuning` (`c94d426`), lol `feat/new-jungle-camps` (`48d7659`).

**The bug the user reported.** A camp called `target.takeDamage()` on the
frame `Monster.updateAttack` allowed a swing and drew a 180ms stroke from
its body to the target. Their words: "hit như bluetooth vậy". Invisible for
a boss whose reach is 320-400px.

**The fix.** `src/game/gameObject/attackableUnits/monsterAttacks.ts` —
`MonsterClaw` / `MonsterSpit` / `MonsterBreath`, mirroring `MinionSwing` /
`MinionBolt` in `Minion.ts`. `MonsterAttackStyle` on `MonsterBody` and
overridable per slot (`MonsterSlotStats.attackStyle`, editor field
`stats.attackStyle`); `attackColor` beside it. **Absent, the style is
derived from `attackRange` vs `MONSTER_MELEE_REACH` (100)** — that default
is what carried every existing pack unedited. The lol pack declares exactly
one override: the dragon's `breath`. The cone is single-target on purpose.

**Facts worth not re-deriving.** Core's `vocabularyBoundary.test.ts` /
`corePackTarball.test.ts` scan **comments** for pack champion/monster names
— writing "Baron" in a doc comment in `src/` fails the gate; say "a boss
camp" instead. `champion.isDead` is a getter, so a test kills with
`takeDamage(99_999, attacker)`. `checkMonsterBody` does **not** reject
unknown keys, so a pack shipping `attackStyle` still installs on an older
core, it just ignores it — graceful, not a break. In this linked checkout
**9 core tests fail before any edit** (lol symlinked into node_modules:
matchConfigSource ×2, preset.catalog ×4, shopSubject, preset.runtimePack,
preset.customKitDefence) — verified by reverting src and re-running, so
judge a change by the delta, not the absolute.

**A fourth style, 2026-09-01 (`1b0146b`).** `lash` — a real whip, anchored at
the camp's mouth and solved by `render/creature/chain.ts`, for the segmented
bodies the creature rig grew (see [[moba2d-creature-leg-rig]]). Its damage
lands at `LASH_IMPACT_MS`, full extension, **not** at the end of the wind-up
like the claw and the cone: the wind-up is the tail rearing, so striking there
means hurting you before the tail has left the body. Like `breath` it is
**never derived** — only `melee`/`ranged` come from `attackRange`, and
deriving `lash` from a spine would change what every existing camp does the
moment somebody gave it one. Adding a style means four edits that must move
together: the union in `monsterAttacks.ts`, `MONSTER_ATTACK_STYLES` in
`ContentPack.ts`, the branch in `Monster.launchAttack`, and the `options:` list
on `stats.attackStyle` in `mapEditor/ui.ts` — `editorTuningSchema.test.ts`
scans that list's source text and fails if it drifts from the constant.

**The melee reach check was inverted-in-effect, fixed 2026-09-01 (`39d4e99`).**
`BasicAttackController` launches a swing on the first frame the target is inside
reach — chasing, that is *at* the boundary — then roots the attacker for the
whole wind-up (`stopMovement()` every frame). `strike()` re-checked
`dist > reach` against the same reach with no slack, so at `MELEE_WINDUP_MS`
180 and default `speed` 2.6/frame the target gained ~28 units the attacker could
not answer: **every melee basic attack aimed at anything retreating missed**,
while `BasicAttackBolt.onArrive` checks no distance at all and ranged never
missed. `stillInReach` (in `combat/BasicAttack.ts`, *not* `Reach.ts` — that
module's header excludes basic attacks) forgives what the victim could have
*walked* in the window, read off its own speed. The rule to keep: **a target
cannot walk out of a melee attack; it can blink, dash or be knocked out of one.**
Same fix applied to `MinionSwing` and to `stillLands` for claw/cone/lash.

**Melee art is one function now**, `vfx/MeleeSwing.ts`: champion and minion
swings were hand-written twins that had drifted (the minion had a bright leading
arc, the champion did not). The camp's claw is deliberately *not* in that family
— three stroked arcs is its own legibility decision for a 100px body.

**Balance follow-up, same day.** The dragon was doing 5.6 dps — the weakest
fighting camp in the jungle (raptors 14.0, buff camps 8.0). Cause: it is the
only boss with **no kit** (`makeDragonAbilities` returns one entry, the
death blessing, `range: -1` so never cast), while Baron and Vilemaw look
equally modest on basics because their kits carry ~8.6 and ~4.7 dps more.
Now `damage: 24 / attackInterval: 1_600` = 15.0 dps.
`lol/tests/monsters/campPower.test.ts` builds each camp as a real `Monster`
and measures it — **six of the nine bodies omit `damage`** and let core
derive it (`min(25, max(3, health/25))`, interval 1500), so reading
`data.ts` gives the wrong numbers. That is how this hid. `lol`'s
`tests/noCoreReach.test.ts` pins the test-file count (now 97).

**Camp regen + rooted leash, 2026-08-30.** Two engine facts worth not
re-deriving: **regen is applied per frame with no `deltaTime`**
(`Stats.update` adds `healthRegen.value` onto `health.baseValue`), so
`Monster._leashRegen = health/60` is a full bar in **one second** and
`_idleRegen = health/120` in two. And `updateAttack`'s `isImmovable` branch
used to call `goBackToCamp()` the frame a target left reach, skipping the
give-up leash — a free full heal on every `speed: 0` boss. Both fixed:
`MONSTER_REGEN_DELAY_MS` (4s, refreshed by `takeDamage`, checked **before**
the phase because the phase does not mean "fight over"), plus the rooted
branch now holds its lock. A camp's reach is `attackRange + ownSize/2 +
targetSize/2` (`DEFAULT_UNIT_SIZE = 55`), which is what the dragon's
wingbeat `landing` must stay under.
