import type { ChampionPresetData } from '@/game/gameObject/attackableUnits/Champion';
import {
  DEFAULT_CHAMPION_ATTACK,
  DEFAULT_CHAMPION_DEFENCE,
} from '@/game/gameObject/attackableUnits/Champion';
import type { KitPlan } from '@/game/preset';
import { spellIdOfClass } from '@/game/spellRegistry';

/**
 * Kits on the wire. A kit change (đổi tướng) leaves `MatchDirector` as an
 * applied preset — real classes — and crosses the wire as a `KitPlan`, the
 * same plain-data shape spawn events and the hello already carry. This module
 * is the two conversions: preset → plan for the sender, raw wire data → plan
 * for the receiver. `protocol.ts` stays dependency-free on purpose (its own
 * header), which is why the plan-shaped halves live here instead.
 */

/**
 * Turn an applied preset back into the plan it was built from. Lossless as
 * long as every class came out of the registry — which `presetFromPlan`
 * guarantees — with the same `'BasicAttack'` fallback the host's live-champion
 * reverse (`HostSession.planFromLiveChampion`) has always used for a class
 * the display population does not name.
 */
export const planFromPreset = (preset: ChampionPresetData & { avatar?: string }): KitPlan => {
  const passiveId = preset.passive ? spellIdOfClass(preset.passive) : null;
  return {
    name: preset.name ?? 'Champion',
    avatar: preset.avatar ?? '',
    attack: preset.attack ?? DEFAULT_CHAMPION_ATTACK,
    defence: preset.defence ?? DEFAULT_CHAMPION_DEFENCE,
    spellIds: (preset.spells ?? []).map(spellClass => spellIdOfClass(spellClass) ?? 'BasicAttack'),
    ...(passiveId ? { passiveId } : {}),
  };
};

/**
 * The receiving end's gate: a `plan` off the wire is `unknown`, and like
 * `decodeMessage` the answer to a malformed one is `null`, never a throw —
 * a bad frame must not take the match down. Ids are only checked to be
 * strings, not to exist: `loadSpells` is safe with unknown ids and
 * `presetFromPlan`'s `classForId` has its own slot fallback, the same
 * tolerance every stale `localStorage` loadout already relies on.
 */
export const asKitPlan = (raw: unknown): KitPlan | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const plan = raw as Record<string, unknown>;
  if (typeof plan.name !== 'string' || typeof plan.avatar !== 'string') return null;
  if (typeof plan.attack !== 'object' || plan.attack === null) return null;
  if (typeof plan.defence !== 'object' || plan.defence === null) return null;
  if (!Array.isArray(plan.spellIds) || plan.spellIds.length === 0) return null;
  if (!plan.spellIds.every(id => typeof id === 'string')) return null;
  if (plan.passiveId !== undefined && typeof plan.passiveId !== 'string') return null;
  return plan as unknown as KitPlan;
};
