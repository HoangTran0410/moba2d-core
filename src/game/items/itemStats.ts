/**
 * The stats an item may grant, and nothing else.
 *
 * Its own file, with **no imports at all**, because both sides of the pack
 * boundary need it: `game/items/Item.ts` builds the modifier from it, and
 * `content/validate.ts` refuses a pack that names a key not on it. Validation
 * runs in the data half of the pack contract — the half a menu screen loads to
 * draw a picker — and `Item.ts` reaches `Stats.ts` and through it the whole
 * engine, so importing the list from there dragged the match into the menu's
 * chunk. `contentApiChunk.test.ts` caught exactly that.
 *
 * An allow-list rather than "every field on `StatsModifier`", and the
 * exclusions are the point. `health` and `mana` are *current pools*, not
 * capacities — an item granting `health` would top a champion up on equip and
 * **take that health back on sale**, which is a shop that can kill you.
 * `size` and `height` are presentation and collision, and an item that changed
 * a champion's body radius would silently change every ability range measured
 * against it (`combat/Reach.ts`).
 *
 * **Two of these are fractions and the rest are points.** `abilityPower: 0.35`
 * is +35% ability damage and `cooldownReduction: 0.15` is a cooldown 15%
 * shorter, the same convention `critChance`, `critDamage` and the three vamp
 * stats already use; `attackDamage: 35` is thirty-five points of damage. An item
 * written with the wrong one of those is not a type error and never will be —
 * both are numbers — so it is worth reading twice. `abilityPower: 35` is a
 * champion whose abilities hit for thirty-six times normal.
 *
 * `inventory.test.ts` checks every key here is a real `StatsModifier` field —
 * this file cannot import `Stats` to check it itself, and a typo would be an
 * item that silently grants nothing, forever, with nothing to look at.
 */
export const ITEM_STAT_KEYS = [
  'maxHealth',
  'maxMana',
  'healthRegen',
  'manaRegen',
  'speed',
  'attackDamage',
  'abilityPower',
  'cooldownReduction',
  'attackSpeed',
  'attackRange',
  'armor',
  'magicResist',
  'critChance',
  'critDamage',
  'omnivamp',
  'lifesteal',
  'spellVamp',
  'onHitDamage',
  'visionRadius',
] as const;

export type ItemStatKey = (typeof ITEM_STAT_KEYS)[number];
