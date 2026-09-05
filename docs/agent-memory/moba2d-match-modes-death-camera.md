---
name: moba2d-match-modes-death-camera
description: "Match modes (macro-then-overlay over existing knobs, rules.recall) and the death camera (DeathCamera state machine + SpectateBar) landed 2026-09-02; the literal-churn trap when MatchRulesConfig grows, the deathAtMs tick trap"
metadata: 
  node_type: memory
  type: project
  originSessionId: 40c76eac-3d37-4bf8-b1f2-81a38c8ab810
  modified: 2026-09-02T10:22:00.181Z
---

On 2026-09-02 items 8 and 11 of the idea list landed in core (spec `docs/superpowers/specs/2026-09-02-match-modes-and-death-camera-design.md`):

**Modes** (`src/game/config/matchModes.ts`, 6 rows: classic/blitz/urf/brawl/duel/war). A mode is a *macro* — `applyMode` (pregame) / `MatchDirector.setMode` (live, reshapes bots via removeBot/addBotLoaded) write rules+world+bot count into the existing knobs, then the id is only a label (`modeDrift` → "đã chỉnh" in `MatchTab.vue`). The *overlay* half rides on the id at boot: `Game.mapTuning = mergeTuning(map.tuning, mode.tuning)` and `planMatchKits` honours `allRandom`. `PregameConfig.mode` persisted; `MatchPlan.mode` carries the host's mode to LAN clients (`hello.mode`). New rule `rules.recall` (brawl) checked at press time in `Recall.isCastableNow`, `Game.recall()`, `BotBrain.manageRecall`, and hidden from HUD/touch when off; `hello.rules.recall?` absent = on. ARAM-one-lane was dropped: no pack has a one-lane map and core may not name pack maps.

**Death camera** (`src/game/render/deathCamera.ts`): pure `DeathCamera<T>` over a 5-function context (same shape as `MatchAnnouncer`, because no headless `Game` exists in tests); 1.5s linger, then ally in a fight (`AttackableUnit.lastCombatMs`, stamped on both sides in `takeDamage`) else nearest; `next()` cycles roster order; `Game.followForDeathCamera` refuses when `camera.target === null` (Space free-cam). HUD: `HudState.spectating`, `SpectateBar.vue` bottom-centre (118px desktop / 18px touch), `#game-scene.dead-view canvas` grayscale filter toggled from `InGameHUD.vue`.

**Why:** the user wants a phòng tập, so modes are tuning bundles with no win rule, and the dead-time was the one stretch with nothing to do.

**User-reported bug, fixed same day:** switching to Đại chiến mid-match gave 7v3 because arrivals took `stored.ai.botTeams[i]` — slots past the live count hold stale evenings. Now `balancedBotTeams` (pregame) and `teamForAddedBot` + `evenOutSides` (live) deal the sides; a mode that names a bot count owns the team shape.

**Second user report, same day:** the death grey caused a hitch on the phone's first death — a CSS `filter` over a full-screen canvas compiles a shader + promotes a layer on first use and re-filters every frame. Touch now paints `.dead-tint` (translucent quad, opacity `<Transition>`), desktop keeps the filter. Rule: never put `filter`/`backdrop-filter`/`mix-blend-mode` on the game canvas for the touch UI.

**Random pool per pack + folded picker (same day, user request):** `config/championPool.ts` (`moba2d:championPool:v1`, stores `disabledPacks`; `poolOf` never returns empty) filters the ONE random door `preset.ts randomChampionKit`; `PlayableChampionKit.packId` added; die pill `.kit-pack-pool` on each `.kit-pack-row` in `KitRoster.vue`. The picker no longer seeds the biggest pack open — `expandedPacks` starts empty; `kitRosterGrouping.test.ts` pins both. Pack ids in the user's install: lol, dota, naruto, reference.

**Item 9 (same day): match history + mastery.** `config/matchHistory.ts` (ring 40 by `Game.matchId`, archive fold, mastery points/levels) + `combat/MatchRecorder.ts` (autosave 30s match time; save on destroy/_leavePage/pagehide; disabled on net client). UI: `.kit-tile-mastery` badge in KitRoster (needs `KitShelf.championId`), "Trận gần đây" in MatchTab. Spec `2026-09-02-match-history-and-mastery-design.md`. Daily challenge deliberately not built.

**Folding sections (same day, user: "nhiều field quá, mới vô nhìn rối"):** `PanelSection.vue` + `panelSections.ts` (`moba2d:panelSections:v1`, overrides over defaults). Trận đấu: Chế độ open by default, rest folded; Cài đặt: all folded. E2E TRAP: folded controls are `v-show`n away → `openPanelSections(page)` in harness.mjs must run after every `#practice-tab-rules/settings` click (4 scripts updated). TEMPLATE-REWRITE TRAP: `.index('</template>')` finds the first INNER `<template v-if>` end tag — cut to the file's last root `</template>` instead (it left old tails in two files and Vite's error overlay blocked the e2e).

**How to apply / traps:** growing `MatchRulesConfig`/`MatchRules` breaks ~15 test literals across PregameConfig, contract, netClient, MatchDirector.* tests and `NO_MATCH_RULES` in spellCatalog.ts + preset.ts — regex `{ cooldownReductionPercent: N, manaFree: X }` fixes most, but check indent-specific `rules:` lines inside typed `PregameConfig` customs (they also need `mode`). `MatchDirector.resetToDefaults` must reset every seeded field (it forgot `_mode` first time). `DeathCamera` stamps `deathAtMs` on the first *dead tick*, so a test must tick once before advancing time. The mapPickerModal class-scan test covers `MatchTab.vue`: any new `class="…"` needs a rule in `styles/*.css`. Pre-existing linked-state failures unchanged: contract map-list ×2, shopSubject. See [[moba2d-hit-feedback]], [[moba2d-sandbox-not-win-condition]].
