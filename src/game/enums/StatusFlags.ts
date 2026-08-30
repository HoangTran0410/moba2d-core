import { hasFlag } from '@/utils/index';

const StatusFlags = {
  None: 0,
  // Bit 1 is the slot League reserves for the attack permission, so the disarm
  // concept keeps living on the attack bit even though this list states crowd
  // control positively (Stunned, Rooted, Silenced) rather than as permissions.
  Disarmed: 1 << 1,
  CanCast: 1 << 2,
  CanMove: 1 << 3,
  Charmed: 1 << 5,
  /**
   * Forced to attack whoever applied it. Deliberately does NOT clear
   * `CAN_ATTACK` or `CAN_MOVE` the way every other control effect does — a
   * taunt *directs* the swings and the walking, it does not stop them. Casting
   * is the only thing it takes away. See `Stats.updateActionState`.
   */
  Taunted: 1 << 6,
  Feared: 1 << 8,
  /**
   * Passes through everything: bodies AND terrain. Right for a dash, which is
   * short and ends on a point already chosen; wrong for anything that lasts,
   * because a unit that can stand inside a wall can leave the map.
   */
  Ghosted: 1 << 11,
  /**
   * Passes through *bodies only* — terrain still stops it. The one a sustained
   * effect wants: a spin attack ploughing through a wave, a summoner spell's
   * phasing shouldering past, a rolling ultimate ploughing through. Split out
   * of `Ghosted` because that flag also disables the wall push-out, and a
   * three-second spin with it on lets the spinning champion
   * walk out of the world.
   */
  PhasesUnits: 1 << 30,
  Grounded: 1 << 9,
  Immovable: 1 << 13,
  Invulnerable: 1 << 14,
  NearSighted: 1 << 16,
  NoRender: 1 << 18,
  Rooted: 1 << 22,
  Silenced: 1 << 23,
  Stealthed: 1 << 25,
  Stunned: 1 << 26,
  Suppressed: 1 << 28,
  Targetable: 1 << 29,
  InBush: 1 << 12,
};
Object.freeze(StatusFlags);
export default StatusFlags as typeof StatusFlags;

/**
 * What a set of flags takes away, as three questions, in one place.
 *
 * `Stats.updateActionState` is the engine's answer and was the only one, which
 * was fine while nothing else needed to know. The buff tooltip needs to know:
 * a row that says "Choáng, còn 1.2 giây" and nothing about what a stun *does*
 * is six icons a player can only learn by being hit by each of them once. The
 * honest way to write that sentence is to ask the same predicate the engine
 * asks, not to hand-write a second copy of these lists in Vietnamese and hope
 * the two are edited together — the day a pack adds a flag to one of them, the
 * copy that was not updated does not fail, it just quietly lies.
 *
 * Here rather than beside `Stats` because it is a property of the flags, and
 * because this module has no imports but the flag test itself: a description
 * is built in the HUD's half of the world and must not drag the stat block
 * into it.
 */
export const deniesMovement = (flags: number): boolean =>
  hasFlag(flags, StatusFlags.Charmed) ||
  hasFlag(flags, StatusFlags.Feared) ||
  hasFlag(flags, StatusFlags.Immovable) ||
  hasFlag(flags, StatusFlags.Rooted) ||
  hasFlag(flags, StatusFlags.Stunned) ||
  hasFlag(flags, StatusFlags.Suppressed);

/**
 * A taunt is on this list and on neither of the others. It takes the decision
 * away rather than the weapon — `Taunt` spends the swings and the walking
 * itself, every frame, on the champion it holds.
 */
export const deniesCasting = (flags: number): boolean =>
  hasFlag(flags, StatusFlags.Silenced) ||
  hasFlag(flags, StatusFlags.Charmed) ||
  hasFlag(flags, StatusFlags.Feared) ||
  hasFlag(flags, StatusFlags.Taunted) ||
  hasFlag(flags, StatusFlags.Stunned) ||
  hasFlag(flags, StatusFlags.Suppressed);

/**
 * Disarm is the dedicated flag, but everything that takes control of a unit
 * stops its swings too — a stunned or fleeing champion still attacking would
 * read as a bug.
 */
export const deniesAttacking = (flags: number): boolean =>
  hasFlag(flags, StatusFlags.Disarmed) ||
  hasFlag(flags, StatusFlags.Charmed) ||
  hasFlag(flags, StatusFlags.Feared) ||
  hasFlag(flags, StatusFlags.Stunned) ||
  hasFlag(flags, StatusFlags.Suppressed);
