import type { SlotObjectFactory } from '@/content/ContentPack';
import { healthRelicFor, RELIC_ROLE } from './HealthRelic';

/**
 * The neutral-slot roles core answers on its own, and what it stands on them.
 *
 * `slots.neutral` is a list of named points and `NeutralSlot.role` is a free
 * string — core has never interpreted one, and a pack's `slotObjects` is still
 * the way to claim a role core has never heard of. This table is the small,
 * named exception: the roles that are *furniture* rather than flavour, where
 * every map that draws the point wants the same object and it should not
 * depend on which pack happens to be installed.
 *
 * **A pack still wins.** `preset.ts`'s `neutralSlotFill` asks the registry
 * first and falls back to here, so a pack that ships its own relic replaces
 * core's rather than fighting it — the seam is unchanged, only its floor moved.
 *
 * Kept deliberately short. A role belongs here when a map author drawing a
 * point in core's own editor would be surprised to find nothing on it; not
 * because it was convenient to have core build the thing.
 */
export const CORE_SLOT_OBJECTS: Readonly<Record<string, SlotObjectFactory>> = Object.freeze({
  [RELIC_ROLE]: healthRelicFor,
});

/** Core's own answer for a neutral-slot role, or `undefined`. */
export const coreSlotObjectFor = (role: string): SlotObjectFactory | undefined =>
  Object.prototype.hasOwnProperty.call(CORE_SLOT_OBJECTS, role)
    ? CORE_SLOT_OBJECTS[role]
    : undefined;
