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
 * **Several of these are fractions and the rest are points.** `abilityPower:
 * 0.35` is +35% ability damage, and so read `critChance`, `critDamage`, the
 * three vamp stats, `armorPenetration: 0.35` (35% of the victim's armour
 * ignored), `tenacity: 0.3` and `healingReceived: 0.25`. The rest are points:
 * `attackDamage: 35` is thirty-five damage, and **`abilityHaste: 25` is
 * twenty-five points of haste** — a fifth off every cooldown, with the next
 * twenty-five taking another fifth off what is left (`Stats.ts`'s
 * `hasteCooldownMultiplier` has the curve and the argument for it).
 *
 * Two of the fractions are a share of *the wearer*, not of a fight, and
 * `Item.ts`'s `GRANT_SLOT` is where that is decided: `attackSpeed: 0.15` is
 * +15% of the champion's own swing rate, and `speedPercent: 0.07` is +7% move
 * speed on top of whatever boots are already on.
 *
 * **`speed` and `speedPercent` are both here on purpose**, the way Riot's own
 * item data carries `FlatMovementSpeedMod` beside `PercentMovementSpeedMod`.
 * Boots are flat because a fixed number is worth more to the champion who has
 * the least; the percent one compounds with them, so a shelf can sell both a
 * first item and a fifth. Every champion starts on the same 3 (`Stats.speed`),
 * so unlike attack speed neither is unfair to a body in particular — the
 * difference is what they stack *with*, and nothing else.
 *
 * An item written with the wrong one of those is not a type error and never
 * will be — both are numbers — so it is worth reading twice. `abilityPower: 35`
 * is a champion whose abilities hit for thirty-six times normal, and
 * `abilityHaste: 0.25` is a quarter of a point, which is nothing at all.
 *
 * `inventory.test.ts` checks every key here reaches a real `StatsModifier`
 * field — this file cannot import `Stats` to check it itself, and a typo would
 * be an item that silently grants nothing, forever, with nothing to look at.
 */
export const ITEM_STAT_KEYS = [
  'maxHealth',
  'maxMana',
  'healthRegen',
  'manaRegen',
  'speed',
  'speedPercent',
  'attackDamage',
  'abilityPower',
  'abilityHaste',
  'attackSpeed',
  'attackRange',
  'armor',
  'magicResist',
  'critChance',
  'critDamage',
  'armorPenetration',
  'magicPenetration',
  'tenacity',
  'healingReceived',
  'omnivamp',
  'lifesteal',
  'spellVamp',
  'onHitDamage',
  'visionRadius',
] as const;

export type ItemStatKey = (typeof ITEM_STAT_KEYS)[number];
