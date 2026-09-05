---
name: moba2d-audio-design-parked
description: Audio (zzfx SFX) design for moba2d was scoped and parked on 2026-09-02 before approval; where the hooks already exist and which approach was proposed
metadata:
  type: project
---

On 2026-09-02 the user chose "SFX synth only (zzfx), no music, no sample files" for v1, then said "audio để sau đi" before the design was approved. Nothing was written to the repo.

Facts gathered (verified 2026-09-02, core 1.21):
- `src/libs/zzfx.ts` exists (zzfx/zzfxP/zzfxG) and is imported by nobody.
- `castSpec.sfx?: SpellSfxSpec` already exists in `src/game/spell/runtime/types.ts`; `SpellVfx` (src/game/vfx/SpellVfx.ts) already drives castStart/release/activate/channel/impact/cancel/complete for both vfx and sfx handles. No `SfxFactory` is ever supplied.
- Events: ON_ATTACK_LAUNCH, ON_ATTACK_HIT (has `crit?`), ON_TAKE_DAMAGE (`{unit, amount, type}`) are emitted; **ON_DIE is declared but never emitted** — would need an emit on the `die()` transition (`UnitDeathData.attacker` gives the killer).
- Only `HostSession` listens to ON_TAKE_DAMAGE, so a LAN client can safely re-emit it from its `dmg` handler; client deaths come from the snapshot `dead` flag via `unit.die()`.
- Settings pattern: `src/game/config/renderPreferences.ts`; `src/game/config/` is pinned to the pregame chunk, so audio prefs belong there. Settings tab section "Hiển thị" in `hud/config/SettingsTab.vue` is the template.
- Vitest has no AudioContext → engine needs a null backend.

Proposed (not approved) approach A: `src/game/audio/` with AudioEngine (context unlock on gesture, master gain, buffer cache, voice cap, per-key rate limit, pan/attenuation), SoundPalette (zzfx presets by semantic key), SoundDirector (eventManager + SpellVfx phases → key + position, visibility gate, default palette inferred from castSpec shape; a spell's own `sfx` overrides). Pack-authored sounds via `api.sfx` = v2, needs a contract bump.

**How to apply:** when the user returns to audio, resume from "present design sections for approach A", don't re-survey. See [[moba2d-sandbox-not-win-condition]].
