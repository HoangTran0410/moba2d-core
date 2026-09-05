---
name: moba2d-match-rules-in-world
description: "GameObjectGameContext.matchRules lets any world object read the match's CDR/URF rules; the lol Health Relic uses it for its respawn (2026-09-02, pushed in core `045a0db`)"
metadata:
  type: project
---

Asked 2026-09-02: "cho health relic apply giảm thời gian hồi chiêu từ config
trận luôn" — the practice match's CDR slider should shorten the Cổ Vật Hồi Máu's
respawn too, not just abilities.

**The seam.** `Spell.reducedCooldown` was the only reader of
`game.matchRules.cooldownMultiplier`, and it is unreachable from a plain
`GameObject` — which is what a relic pad, a shrine, anything on a timer that is
not a spell, actually is. `matchRules?: Readonly<MatchRules>` now lives on
**`GameObjectGameContext`** (the base, `src/game/gameObject/GameObject.ts`), not
on `GameObjectRuntimeContext` beside `matchTimeMs`/`mapTuning`: those are things
the world answers, this is a rule the match declares, and the objects that most
need it only ever see the base context. `Readonly` because nothing in the world
may retune a match.

The type resolves for packs because `src/content/types.ts` **already**
re-exports it (`export type { MatchRules } from '@/game/config/PregameConfig'`)
and `./content/types` is a published subpath — no new export, no five-edit
churn.

**The relic half** (now `src/game/gameObject/structures/HealthRelic.ts` — it moved into core the same day, see [[moba2d-core-furniture-and-aram]]): `relicRespawnMs(mult)`
scales `RELIC_RESPAWN_MS`, read at the moment the wait starts and never cached
(`MatchDirector.setRules` mutates the rules object in place, so a spell or a pad
already counting keeps the number it started under — same contract
`Spell.reducedCooldown` keeps). `coolingTotal` was added so the draw arc fills
against the wait actually being served.

**`RELIC_BEAM_DELAY_MS` is deliberately NOT scaled.** The 2.5s between pickup
and beam is the decision the object exists to ask — an ally arriving to share
it, the enemy on the pad healed twice what you were. Shrinking it with the CDR
slider deletes the object rather than speeding it up. There is a test that pins
this; do not "finish the job" by scaling it later.

**Drive-by:** `lol/tests/spells/Anivia_R.test.ts` had `const URF: MatchRules =
{ cooldownMultiplier, manaFree }` missing `recall`, failing the pack's
`tsc` on `main` since `recall` was added. Fixed in the same round. See
[[moba2d-match-modes-death-camera]] for the MatchRulesConfig literal churn this
belongs to.
