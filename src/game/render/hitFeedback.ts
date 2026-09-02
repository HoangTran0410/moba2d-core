/**
 * The maths behind a hit you can *feel*.
 *
 * Three presentation systems answer the same question — "how hard was that?"
 * — and each used to answer it alone or not at all: the damage number was a
 * fixed 20px whatever it said, no body but the turret's ever flashed, and the
 * camera never moved. This module is the one table all three read from, so a
 * heavy hit is heavy everywhere at once and can be tuned in one place.
 *
 * Everything is expressed as a **fraction of the victim's max health**, not as
 * a raw number: 40 damage is a scratch on a 3,000-health monster and a third
 * of a level-one champion, and the picture has to say so. Pure functions, no
 * p5, so the numbers are testable and the consumers stay thin.
 *
 * Colour is deliberately absent. Damage type has exactly one colour channel
 * — the combat text (`DAMAGE_TEXT_COLOR`, `VFX_STANDARD.md` rule 1) — so a
 * crit is marked by *size and rhythm*, and a hit flash is white.
 */

/** `amount` as a share of `maxHealth`, clamped to `[0, 1]`; 0 when the pool is unusable. */
export const hitFraction = (amount: number, maxHealth: number): number => {
  if (!(maxHealth > 0) || !Number.isFinite(amount)) return 0;
  const fraction = amount / maxHealth;
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
};

/** A hit at or above this share of max health is "heavy" for the flash. */
const HEAVY_HIT_FRACTION = 0.15;
const FLASH_BASE_MS = 120;
const FLASH_HEAVY_MS = 200;
const FLASH_CRIT_BONUS_MS = 40;

/** How long the victim's body stays lit, in ms. */
export const hitFlashMs = (fraction: number, crit: boolean): number => {
  const weight = Math.min(1, Math.max(0, fraction) / HEAVY_HIT_FRACTION);
  return FLASH_BASE_MS + (FLASH_HEAVY_MS - FLASH_BASE_MS) * weight + (crit ? FLASH_CRIT_BONUS_MS : 0);
};

/** A hit at or above this share of max health draws the largest number. */
const BIG_NUMBER_FRACTION = 0.25;
const TEXT_SCALE_MAX = 1.5;
const TEXT_CRIT_SCALE = 1.3;
/** Two multipliers stacked; the cap keeps a crit that one-shots a minion readable. */
const TEXT_SCALE_CEILING = 1.9;

/** Multiplier over the combat text's base size. */
export const damageTextScale = (fraction: number, crit: boolean): number => {
  const weight = Math.min(1, Math.max(0, fraction) / BIG_NUMBER_FRACTION);
  const scale = (1 + (TEXT_SCALE_MAX - 1) * weight) * (crit ? TEXT_CRIT_SCALE : 1);
  return Math.min(TEXT_SCALE_CEILING, scale);
};

/** Below this share of max health a hit on the player does not move the camera. */
const SHAKE_MIN_FRACTION = 0.05;
/** At this share the hit's shake is at its ceiling. */
const SHAKE_MAX_FRACTION = 0.3;
const SHAKE_HIT_MAX = 0.45;
const SHAKE_CRIT_BONUS = 0.1;

/**
 * Trauma (see `Camera.shake`) for the *player* taking this hit. Chip damage
 * is silent on purpose: a minion wave's pokes would otherwise keep the screen
 * trembling, and a shake that never stops is one nobody notices.
 */
export const hitShakeTrauma = (fraction: number, crit: boolean): number => {
  const clamped = Math.max(0, fraction);
  const span = SHAKE_MAX_FRACTION - SHAKE_MIN_FRACTION;
  const weight =
    clamped <= SHAKE_MIN_FRACTION ? 0 : Math.min(1, (clamped - SHAKE_MIN_FRACTION) / span);
  return SHAKE_HIT_MAX * weight + (crit ? SHAKE_CRIT_BONUS : 0);
};

/** The player's own death: the one hit that always lands hardest. */
export const DEATH_SHAKE_TRAUMA = 0.7;
/** The player killing a champion: a kick, not a blow. */
export const KILL_SHAKE_TRAUMA = 0.3;
