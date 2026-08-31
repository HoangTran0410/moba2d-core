import type { LegRigConfig } from './legRig';

/**
 * What a pack writes to give a creature legs, and what core turns it into.
 *
 * The declaration is data — a pack states a shape, core owns every number that
 * makes it walk — for the same reason `attackStyle` is data: a pack that had to
 * write animation code would be a pack that breaks when the animation improves.
 *
 * **`rig` absent means nothing changes.** Unlike `attackStyle`, which core
 * derives from `attackRange` when a pack declares none, nothing here is ever
 * inferred: growing legs on every camp that never asked for them would rewrite
 * the look of every pack at once. Opt-in, always.
 */

export type CreatureBodySpec =
  /** Today's circular sprite, drawn over the legs. */
  | 'avatar'
  /** No sprite at all: a body drawn from code, for a creature that has no art. */
  | { kind: 'orb'; color?: [number, number, number]; glow?: number };

export interface CreatureLegsSpec {
  /** Even, 2..12. Legs are mounted in mirrored pairs. */
  count: number;
  /**
   * How far past the body's edge a foot plants, **as a multiple of the body's
   * radius**. Default 1.6.
   *
   * A ratio rather than pixels because camps in this game differ by an order of
   * magnitude in `size` — a scuttle crab against a drake — so one spec has to
   * read correctly at any of them, and a map that scales a camp must not break
   * its legs.
   */
  reach?: number;
  /** A foot steps once it is this many `reach` from where it belongs. Default 0.35. */
  step?: number;
  /** Which way the knees break. Default `'up'`, which is the spidery one. */
  bend?: 'up' | 'down';
  /** Stroke width of the upper bone, in world units. Defaults from the body. */
  thickness?: number;
  color?: [number, number, number];
  /** Radians the pairs fan across, front to back. Default 1.6. */
  spread?: number;
}

export interface CreatureRigSpec {
  /** Default `'avatar'`. */
  body?: CreatureBodySpec;
  /** Absent means a body with no legs — a thing that drifts. */
  legs?: CreatureLegsSpec;
}

export interface ResolvedRig {
  body: 'avatar' | { kind: 'orb'; color: [number, number, number]; glow: number };
  legs?: {
    config: LegRigConfig;
    thickness: number;
    color: [number, number, number];
  };
}

export const RIG_DEFAULTS = {
  reach: 1.6,
  step: 0.35,
  spread: 1.6,
  /** Longest a swing may take. `legRig.ts` shortens it as the body speeds up. */
  stepMs: 140,
  /** In trigger-widths — see `LegRigConfig.lead` for why it is not a duration. */
  lead: 1,
  bend: 'up',
  glow: 0,
  /**
   * Bone, and **light on purpose**.
   *
   * This was `[26, 30, 40]` — picked as "dark enough to read as a silhouette",
   * which was reasoning about a map nobody had looked at. The floor is
   * `background(30)`, so the legs came out 0.1 luma away from the ground they
   * walk on and were not faint but absent. Every other test passed: the rig
   * walked correctly, in a colour nobody could see.
   *
   * The map is dark everywhere a camp can stand, so anything drawn on it has to
   * be lighter than it, not darker. `creatureSpec.test.ts` holds that against
   * `MAP_BACKGROUND_GREY` now, and bone reads as chitin rather than as UI.
   */
  color: [206, 196, 176] as [number, number, number],
  /**
   * A procedural body with no colour named. Optional with a default rather than
   * required, exactly as `attackColor` is: the editor's body control would
   * otherwise have to write two fields in one edit to leave valid data behind,
   * and "a body somebody forgot to paint" is a mistake worth defaulting through
   * rather than refusing to install over.
   */
  bodyColor: [150, 110, 255] as [number, number, number],
} as const;

/** A body cannot carry fewer than one pair, and twelve is already a centipede. */
export const MIN_LEGS = 2;
export const MAX_LEGS = 12;

/**
 * Every number below is **clamped, never refused**, and that is a bug report
 * rather than a preference.
 *
 * Typing 7 into the editor's leg count made the whole map disappear: the slot
 * failed validation, `localMaps.keepValid` dropped the map with a `console.warn`
 * nobody reads, and the playtest the player had just launched landed back at
 * the menu. A cosmetic field deleted their map.
 *
 * So the validator now only refuses what cannot be guessed — a word core does
 * not know, a colour that is not three numbers — and this function is what
 * makes that safe. Anything numeric has one obvious repair, and taking it is
 * strictly better than losing the map.
 */
const clamp = (value: number | undefined, low: number, high: number, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
};

const evenCount = (count: number): number => {
  const held = Math.min(MAX_LEGS, Math.max(MIN_LEGS, Math.floor(Number(count) || MIN_LEGS)));
  return held % 2 === 0 ? held : held - 1;
};

/** Beyond this many body radii a leg is not a leg, it is a tentacle on a stick. */
const MAX_REACH_RATIO = 8;

/**
 * A step trigger past one whole `reach` puts the foot further from its hip than
 * the leg is long every single stride, so `clampToReach` would drag constantly.
 */
const MAX_STEP = 1;

/**
 * Turn a pack's declaration into the numbers the rig runs on, or `undefined`
 * when there is nothing to draw.
 *
 * `bodyRadius` is what every ratio here resolves against, so this is the one
 * place a creature's size enters the rig.
 */
export function resolveRig(
  spec: CreatureRigSpec | undefined,
  bodyRadius: number
): ResolvedRig | undefined {
  if (!spec) return undefined;

  const body = spec.body ?? 'avatar';
  const legs = spec.legs;

  // An empty declaration is a pack that opened the door and walked away.
  // Building an avatar-bodied, legless rig for it would cost a call a frame to
  // draw exactly what `AttackableUnit` already draws.
  if (!legs && body === 'avatar') return undefined;

  const resolved: ResolvedRig = {
    body:
      body === 'avatar'
        ? 'avatar'
        : {
            kind: 'orb',
            color: body.color ?? RIG_DEFAULTS.bodyColor,
            glow: body.glow ?? RIG_DEFAULTS.glow,
          },
  };

  if (legs) {
    // A non-positive reach falls back to the default rather than to some tiny
    // floor: "legs of length almost zero" is not what anyone meant by `-1`, and
    // the honest reading of a nonsense reach is the same as declaring none.
    const declared = legs.reach;
    const ratio =
      declared !== undefined && Number.isFinite(declared) && declared > 0
        ? Math.min(declared, MAX_REACH_RATIO)
        : RIG_DEFAULTS.reach;
    resolved.legs = {
      config: {
        count: evenCount(legs.count),
        reach: ratio * bodyRadius,
        step: clamp(legs.step, 0.05, MAX_STEP, RIG_DEFAULTS.step),
        bend: (legs.bend ?? RIG_DEFAULTS.bend) === 'down' ? -1 : 1,
        spread: clamp(legs.spread, 0.05, Math.PI, RIG_DEFAULTS.spread),
        stepMs: RIG_DEFAULTS.stepMs,
        lead: RIG_DEFAULTS.lead,
        bodyRadius,
      },
      // A leg thicker than the body it hangs off is a blob, not a creature.
      thickness: clamp(legs.thickness, 0.5, bodyRadius, Math.max(1.5, bodyRadius * 0.12)),
      color: legs.color ?? RIG_DEFAULTS.color,
    };
  }

  return resolved;
}
