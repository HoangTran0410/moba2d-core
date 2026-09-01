import StatusFlags from '@/game/enums/StatusFlags';
import { hasFlag } from '@/utils/index';
import type Buff from '@/game/gameObject/Buff';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/**
 * **Acting gives a hidden unit away.**
 *
 * ## The rule, as League states it
 *
 * > "Stealth is broken by attacking or casting most abilities."
 *
 * Every stealth in the source game that a champion can *act* out of ends the
 * moment it acts — the rat's approach, the jester's blink, the drowned man's
 * dive, the hunter's roll under her ultimate. The stealth is the approach and
 * the attack is what it was for: an invisibility that survives its own opening
 * is not a repositioning tool, it is a permanently untargetable champion
 * standing in the middle of a fight, which is what this engine shipped.
 *
 * ## What breaks it, and what deliberately does not
 *
 * Committing to a swing and casting an ability. Not *landing* the swing —
 * `BasicAttackController.launch` is the seam, for the same reason the reveal
 * hangs there (`combat/AttackReveal.ts`): hanging it on the bolt's impact
 * leaves a ranged attacker invisible for the whole of its flight, which is
 * exactly the stretch the victim is trying to read.
 *
 * And **not damage**. A poison applied before the champion vanished goes on
 * ticking, and every tick is damage the hidden unit dealt; ending stealth on
 * that would make a damage-over-time kit unable to use its own stealth at all.
 * The rule is about the unit *taking an action*, which is why this module
 * hangs off the two action seams rather than off `onDamageDealt`.
 *
 * ## Why the flag and not the class
 *
 * `buffs/Invisible` is the one core ships, but a pack subclasses it (this
 * game already has two) and nothing stops a pack writing its own buff that
 * turns the flag on. What makes a unit hidden is `StatusFlags.Stealthed`, so
 * that is what this asks about — a stealth core has never heard of still ends
 * when its owner attacks.
 */

/** What this module needs of a unit, so a test need not build a champion. */
export interface Hideable {
  buffs: Buff[];
}

/** Whether this buff is what is hiding its owner. */
export const grantsStealth = (buff: Buff): boolean =>
  hasFlag(buff.statusFlagsToEnable, StatusFlags.Stealthed);

/**
 * Every stealth standing on this unit right now.
 *
 * Written as a loop over a shared empty result rather than a `filter` because
 * the cast seam asks this on **every press attempt**, accepted or not, and an
 * AI champion attempts a cast several times a second and is refused almost
 * every time. Nothing is allocated for the overwhelmingly common answer of
 * "this unit is not hidden".
 */
export const stealthsOn = (unit: Hideable | undefined | null): readonly Buff[] => {
  const buffs = unit?.buffs;
  if (!buffs || buffs.length === 0) return NO_STEALTH;
  let found: Buff[] | null = null;
  for (const buff of buffs) {
    if (buff.toRemove || !grantsStealth(buff)) continue;
    (found ??= []).push(buff);
  }
  return found ?? NO_STEALTH;
};

/** The answer for a unit that is not hiding, allocated once. */
export const NO_STEALTH: readonly Buff[] = Object.freeze([]);

/**
 * End the unit's stealth, because it did something.
 *
 * `only` is the pre-action snapshot, and it exists for one case that would
 * otherwise be unfixable: the ability *granting* the stealth is itself a cast,
 * so a cast seam that ended every stealth would undo the vanishing with the press
 * that cast it. Passing what was standing *before* the action leaves anything
 * the action itself hung alone.
 *
 * Through `deactivateBuff`, never `toRemove`: the flag is applied by the
 * buff's activation and only `onDeactivate` gives it back, so a buff merely
 * marked for the sweep leaves its owner hidden until the next tick collects it.
 */
export const breakStealth = (
  unit: Hideable | undefined | null,
  only?: readonly Buff[]
): void => {
  for (const buff of only ?? stealthsOn(unit)) {
    if (buff.toRemove) continue;
    buff.deactivateBuff();
  }
};

/** Narrowing helper for the two call sites, which hold a real unit. */
export const breakStealthOn = (unit: AttackableUnit | undefined | null): void =>
  breakStealth(unit as unknown as Hideable | undefined | null);
