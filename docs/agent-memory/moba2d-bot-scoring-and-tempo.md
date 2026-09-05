---
name: moba2d-bot-scoring-and-tempo
description: Two shared pack gates in core — bot role scoring (@moba2d/core/testing/bots) and the cooldown band (@moba2d/core/testing/tempo); the SELF-cast blind spot and the numbers
metadata:
  type: project
---

Landed 2026-09-01 across all four repos (core `94a4d34`, naruto `d906369`, lol `b08d152`, dota `1fbf7b7`), all **unpushed**.

**The blind spot.** `inferRoles` reads a costed `SELF` cast as `Buff | Shield`
and nothing else, and `BotBrain.scoreSpell` pays `Shield` **+20 below half
health, −5 above** — so the mask is exactly **0** in a fight, and
`chooseSpell` drops candidates scoring `<= 0`. The ability is *not in the
list*, not merely deprioritised. Core also refuses to infer `Dash`, `Escape`
or `Summon` at all, on purpose.

**Sweep of the three packs found 226; all 226 are now tagged and every
`knownDebt` list is empty.** Done by spawning 5 subagents (~13-15 champions
each) to read every spell file and propose a mask + one-sentence reason, then
applying by hand — never a batch script over names. Worst finds: `Garen_R`,
`ChoGath_R`, `Nasus_Q`, `Axe_R` are `ExecuteSpell`s that scored **0 fighting /
25 wounded**; `Yasuo_E` declared no range so its inferred `Buff|Shield`
satisfied `isRetreatCandidate` — a fleeing bot could dash *through* its
pursuer thinking it was a shield.

A **declared** `Heal`/`Shield`/`Escape` now exempts a spell from
`dead-in-combat` and `panic-ultimate`: those flags mean "press when nearly
dead", so scoring 0 in a fight is the ability working. Inference producing the
same mask is not the same claim, so the licence needs the declaration.
`Pyke_W` and `Twitch_Q` are the first spells anywhere to declare `Escape`.

Scoring facts worth keeping:
- **`SpellRole.Summon` has no term in `scoreSpell`.** Tagging it alone scores
  *less* than the inference it replaces. Pair it with a paid role.
- **`Shield` means "press when nearly dead", not "this protects me".** It is
  wrong on a shield-shaped *engage* ultimate.
- Weights: Damage 10, Poke 6, Burst 14 (target ehp < 40), Cc 12 (focus only),
  Heal/Shield ±20/−5, Escape +25/−10, Dash +6/−4, Buff 5, Zone 8, Ultimate 6.
- `isRetreatCandidate` excludes ultimates and anything with a declared range,
  so a defensive R can never be pressed while retreating.

**A second, unrelated cause of "the bot never uses R" (fixed 2026-09-02, core
`8c743e1`).** Scoring was only half of it. `BotBrain.cast` schedules a
follow-through press for **every** `RECAST` activation, and `recastDelayMs`
defaults to 0 — so a transform whose recast is the *toggle-off* was entered
and cancelled on the next think tick. 100 chakra for one frame of form;
nothing visible from outside. `Spell.aiRecastAfterMs` (a third `ai*` static beside
`aiRoles`/`aiProjectileSpeed`) says **when** the bot may spend a recast —
`Infinity` = never, a number = wait that long, omitted = today's behaviour.
It started as a boolean and reading all 8 lol RECAST spells proved that too
narrow. Lesson: **a good score does not mean the ability happens** — measure
the behaviour, not the number.

Who needs it, after reading every RECAST spell in all three packs:
- `Naruto_R`, `Sasuke_R`, `Janna_Q` → `Infinity`. Janna's is the surprising
  one: the storm object fires itself at full charge, so the bot's automatic
  press was *strictly worse than doing nothing*.
- `Riven_R` → `R_DURATION_MS - 800`. Its recast fires the cone **and** ends a
  9s buff, so neither "at once" nor "never" is right — the case that forced
  the field to be a number.
- `TwistedFate_W` → ~1000ms, landing the stun card. `showingCard` is
  `CARD_ORDER[floor(elapsed/400)%3]` and the bot always locked step 0, so two
  thirds of the ability were unreachable.
- Payload recasts (`Jhin_R`, `Ziggs_W`, `Irelia_E`, `Renekton_E`, `Syndra_W`)
  stay untagged — a detonation that never detonates is the opposite regression.

**Same family, `TOGGLE` (fixed 2026-09-02, core `8184d67`).** `cast()` returns
early for TOGGLE and nothing ever pressed again, while `SpellRuntime` ends a
toggle only via `recast()` or `active.maxDurationMs` — which a standing toggle
declares neither of. So the bot switched `Anivia_R` / `Pudge_W` on and left
them on: Rot is 2 self-damage per 500ms plus a self-slow, Glacial Storm eats
mana to empty. Both have floors, so nothing died and nothing was ever
reported. `BotBrain.releaseToggles()` now switches one off when nothing it can
damage is inside the ability's reach. **Presence, not posture** — the first
version keyed on PUSH and the test showed PUSH is mostly an empty lane.

**Charges (fixed 2026-09-02, core `4920781`).** `BotBrain.cast` released every
charge at `maxDurationMs / 2` with no comment saying why, so bots threw
`Naruto_Q` (18–48) at 33 and `Sasuke_E2` (45–75) at 60, always. Default is now
full charge, plus `Spell.aiChargeReleaseAtMs` per spell.

**The trap that makes a blanket rule impossible:** `SpellRuntime.updateCharge`
**cancels** a charge with `releaseAtMax: false` the moment ratio hits 1 —
holding to `maxDurationMs` destroys the ability, mana and cooldown included.
`Pantheon_Q`, `Pyke_Q`, `Varus_Q` are all `releaseAtMax: false`; `Irelia_W`,
`Vi_Q`, `Naruto_Q`, `Sasuke_E2` are `true`. Core clamps to
`maxDurationMs - CHARGE_CANCEL_MARGIN_MS` (100) and clamps a declared value the
same way. Also: most charges stop paying early — `Varus_Q` maxes range at
1500ms and damage at 1250ms against a 4000ms window, and `advanceCharge`
returns `true` while holding, so the bot is blind and still for every wasted
second. Those three declare `RANGE_CHARGE_MS`.

**The cooldown band.** Measured off lol's 306 abilities: **ultimates 3–10s
(median 10, none above 10), basics 0–12s (median 8)**. moba2d is a fast game.
naruto shipped 90s/95s ultimates and a 26s basic; nothing compared a cooldown
to anything until `testing/tempo` existed. dota is out of band by inheritance
(R up to 60s) and declares its own override — a real balance decision still
open. The band cannot see **uptime**; durations live in each spell's own
constants, so shorten a cooldown and check the duration in the same edit.

Both gates are in the pack scaffold, so a new pack starts inside them. Adding
a `@moba2d/core/testing/*` subpath means **four** edits: `package.json`
exports, `src/seams/packCoreBoundary.ts`'s `ALLOWED_VALUE`,
`tests/content/publicSurface.test.ts`'s list, and lol's own
`tests/noCoreReach.test.ts` (which keeps a second copy plus a file count).

See [[moba2d-naruto-pack]], [[moba2d-workspace-layout]].
