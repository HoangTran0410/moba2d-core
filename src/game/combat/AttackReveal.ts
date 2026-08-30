/**
 * Attacking out of the dark gives you away.
 *
 * ## The rule, as League states it
 *
 * > "By default, when an ally uses a unit-targeted spell, including basic
 * > attacks, on an enemy unit from inside Fog of War, a 300-unit radius of Fog
 * > of War is revealed for the enemy team centered on the attacker which grants
 * > vision for 2 seconds after the attack completes."
 * > — League of Legends Wiki, *Fog of war*
 *
 * The brush page says the same thing about brush specifically ("using targeted
 * attacks and abilities will reveal a 300 radius centered around the champion
 * for 2 seconds"), which is the reported case — but the general rule is the
 * interesting one, and it is broader than the report: **it is not about brush.**
 * A champion behind a wall, in plain fog, who unit-targets somebody is revealed
 * by exactly the same rule. That answers the question the report asked in
 * passing ("kể cả khi đánh thường qua tường?") with a yes.
 *
 * ## And what it is *not*
 *
 * **Only unit-targeted actions.** A skillshot fired out of a brush reveals
 * nothing, and that is not an oversight in League — it is why firing one from
 * brush is a real thing to do. So this hangs off the presence of a resolved
 * target (`CastContext.target`), never off "a spell was cast": a spell that
 * names no unit is exactly the spell that must not give its caster away.
 *
 * Damage does not reveal either. Being *hit* by something out of the fog tells
 * you a direction, not a position, which is the whole tension of a bush — so
 * the reveal is hung on the attacker's own action, not on the victim's
 * `takeDamage`.
 */

/**
 * League's own two numbers, and core's answer when a map states nothing.
 *
 * A map may state something — `MapTuning.vision` — and both ends are real
 * maps: 0ms is brush as genuine stealth, 5000 is one swing as a commitment.
 * These live in `config/tuningDefaults.ts` rather than here so that this module
 * stays importable from either side of the pregame/game chunk boundary; the
 * names are re-exported below so a reader who arrives at the rule finds the
 * numbers beside it.
 */
export { DEFAULT_ATTACK_REVEAL_MS, DEFAULT_ATTACK_REVEAL_RADIUS } from '@/game/config/tuningDefaults';

/** What the reveal rule needs to know about a unit. */
export interface Revealable {
  teamId?: string;
  isRevealed?: boolean;
}

/**
 * Whether `target` has given itself away *to `observer`'s side*.
 *
 * The reveal is granted to the attacker's enemies. An ally who attacks out of a
 * brush is revealed to the other team and not to yours — you could see them
 * anyway — so the team test is not a formality: without it, a bot on your own
 * side attacking from a bush would light itself on your screen through a wall.
 */
export const revealedTo = (observer: Revealable, target: Revealable): boolean =>
  target.isRevealed === true && target.teamId !== observer.teamId;
