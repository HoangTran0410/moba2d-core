/**
 * Who dealt this hit, when the hit did not say so itself.
 *
 * `takeDamage(damage, attacker, type, source)` takes the ability's own name as
 * its fourth argument, and the death recap prints it. A caller that omits it
 * lands under `DAMAGE_TYPE_LABEL` instead — the player reads "Sát thương phép"
 * and is told nothing about what killed them. Reported from a real match, from
 * an installed pack whose whole kit omits it.
 *
 * Asking every ability to remember a display string is what produced the state
 * this replaces: 224 sites across two packs pass it, 20 do not, and the ones
 * that do pass a string equal to their own `name` in all but five cases. The
 * information was always available — it just was not reachable from where the
 * damage lands.
 *
 * ## Why an ambient rather than a parameter
 *
 * Damage rarely lands in the method that knows the ability. A missile's hit
 * runs in its own object's `onHit`, frames after the cast returned, on an
 * object with no `name` and no back-link to its spell (`SpellObject` carries
 * neither). Passing the spell down would mean changing every spell object's
 * constructor in every pack — the thing this exists to avoid.
 *
 * So core brackets the three places it *already* owns the call into pack code,
 * and whatever is running is what a nameless hit is attributed to:
 *
 *   - a spell's cast, through `Spell`'s runtime delegate;
 *   - a buff's tick and its `onDamageTaken`, which is how `DamageOverTime` and
 *     `DamageReflect` (an item's Blade Mail) name themselves;
 *   - a spell object's `update()`, using the attribution stamped onto it when
 *     it was constructed — which is inside its own spell's cast for 34 of one
 *     installed pack's 40 spells and 226 of the other's 268.
 *
 * ## The rules that keep it honest
 *
 * **An explicit `source` always wins.** Five sites across the installed packs
 * deliberately name a sub-ability or a particular projectile rather than the
 * spell that fired it, and an ambient that overrode them would be a downgrade.
 *
 * **Save and restore, never assign.** `DamageReflect` re-enters `takeDamage` on
 * the attacker from inside the victim's own damage pass, so attributions nest.
 * Each bracket keeps the previous value and puts it back in a `finally`; the JS
 * call stack is the stack, which is why there is no array here to leak.
 *
 * **No allocation per frame.** `ObjectManager.update()` brackets every object
 * every tick, so this deliberately has no closure-taking `withAttribution`
 * helper — a callback per object per tick is 30k throwaway closures a second at
 * a teamfight's object count.
 */

/** Anything that can own a hit. `Spell` and `Buff` both already are one. */
export interface DamageAttributable {
  readonly name?: string;
}

let current: DamageAttributable | null = null;

/**
 * Makes `source` the attribution and hands back what it replaced.
 *
 * Always paired with `endAttribution(previous)` in a `finally` — see the header
 * on why nesting is not hypothetical.
 */
export function beginAttribution(
  source: DamageAttributable | null | undefined
): DamageAttributable | null {
  const previous = current;
  current = source ?? null;
  return previous;
}

/** Puts back what `beginAttribution` replaced. */
export function endAttribution(previous: DamageAttributable | null): void {
  current = previous;
}

/** What is running right now, for a spell object to stamp onto itself. */
export function currentAttribution(): DamageAttributable | null {
  return current;
}

/**
 * The label a nameless `takeDamage` is filed under, or `undefined` when nothing
 * is running that could answer — in which case the recap falls back to the
 * damage type exactly as it did before.
 */
export function currentAttributionName(): string | undefined {
  const name = current?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** Test-only: drops any attribution left standing by a thrown update. */
export function resetAttributionForTests(): void {
  current = null;
}
