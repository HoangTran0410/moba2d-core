import type { ItemStatKey } from '@/game/items/itemStats';

/**
 * One Font Awesome class per stat, for every surface that draws stats.
 *
 * ## Why it is a table and not a literal
 *
 * The icons existed before this file did — hand-written into
 * `participantStats.ts`, one string literal per row of the roster's stat
 * sheet. That was fine while one panel drew stats. It stops being fine the
 * moment a second one does: the shop's filter chips want the same anchor for
 * the same stat, and a second hand-written list is a second list to keep in
 * step. Nothing would have caught the drift either — a chip whose `fa-shield`
 * disagrees with the sheet's `fa-shield-halved` is not an error anywhere, it
 * is just two pictures for one thing, which is worse than no picture at all.
 *
 * So the vocabulary is declared once and read from wherever a stat is drawn.
 * Every value here is the icon that was already on screen in the stat sheet:
 * this file started as a move, not a redesign, and only the stats no surface
 * had yet drawn (`critDamage`, `onHitDamage`) needed a choice made.
 *
 * ## The icon never carries the meaning alone
 *
 * `participantStats.ts` set this rule and it holds everywhere this table is
 * read: the **word stays**. An icon is an anchor to scan a column by, not a
 * label — `fa-khanda` is a sword to somebody who already knows the row says
 * "Sát thương". Any surface that draws one of these without its text is using
 * it wrong.
 *
 * ## Two key spaces, deliberately
 *
 * Every `ItemStatKey` is here because the compiler makes it so — a stat an
 * item may grant is a stat a chip may filter by, and a missing entry would be
 * a chip with a hole where its icon goes. The rest are stats no item grants
 * but the sheet still draws: current pools, body size, and the tally rows.
 *
 * `maxHealth` and `health` share `fa-heart` on purpose, as do `maxMana` and
 * `mana`. They are the same quantity read two ways and never appear on one
 * row; what must stay distinct is the seventeen **item** stats, since those
 * are the chips a player picks between — `statIcons.test.ts` holds that.
 *
 * ## No imports but a type
 *
 * `import type` is erased before Rollup sees this module, so this file has no
 * runtime dependency at all — which is what lets it be pinned to the `shared`
 * chunk beside `itemStats.ts` and read from either side of the pregame/game
 * boundary. A menu screen that wants to draw a stat should not have to pull
 * the match in to find out which icon it wears. See `vite.config.ts`.
 */

/** The stats no item grants, but a stat sheet still draws. */
export type NonItemStatKey =
  | 'health'
  | 'mana'
  | 'size'
  | 'kills'
  | 'deaths'
  | 'assists'
  | 'minionsKilled'
  | 'damageDealt'
  | 'damageTaken';

export type StatIconKey = ItemStatKey | NonItemStatKey;

/**
 * `Record`, not an inferred literal: the annotation is what makes the compiler
 * refuse a new `ItemStatKey` that arrives without an icon. An item stat with
 * no entry here would render a chip with an empty square in front of it.
 */
export const STAT_ICON: Record<StatIconKey, string> = {
  // ---------------------------------------------------- what an item may grant
  maxHealth: 'fa-heart',
  maxMana: 'fa-droplet',
  healthRegen: 'fa-heart-pulse',
  manaRegen: 'fa-bolt',
  speed: 'fa-person-running',
  // The runner is the flat one, because boots are what a player pictures. The
  // percent one is the wind: the same axis, and the thing that compounds with
  // whatever is already on the feet.
  speedPercent: 'fa-wind',
  attackDamage: 'fa-khanda',
  abilityPower: 'fa-wand-sparkles',
  abilityHaste: 'fa-clock-rotate-left',
  attackSpeed: 'fa-stopwatch',
  attackRange: 'fa-bullseye',
  armor: 'fa-shield-halved',
  magicResist: 'fa-hat-wizard',
  critChance: 'fa-burst',
  // The two nobody had drawn before, so the two that are a choice rather than
  // a move. Crit *damage* is the hit that lands, next to crit *chance*'s
  // starburst; on-hit is the flat extra every basic attack carries.
  critDamage: 'fa-explosion',
  onHitDamage: 'fa-fire',
  // Three sustain stats, three pictures. The hand holding a drop keeps the
  // general one; the typed pair reads off what feeds it — a heart taking a
  // hit back for the physical half, a flask for the magic one.
  omnivamp: 'fa-hand-holding-droplet',
  lifesteal: 'fa-heart-circle-plus',
  spellVamp: 'fa-flask',
  // The four counters, each drawn as the thing it gets *through* rather than
  // as the thing it grants: a hammer for armour broken through, a bare
  // wand for magic resist, a shackle coming off for tenacity, and a plus on
  // a heart for the sustain the wound shelf exists to take away.
  armorPenetration: 'fa-hammer',
  magicPenetration: 'fa-wand-magic',
  tenacity: 'fa-unlock',
  healingReceived: 'fa-kit-medical',
  visionRadius: 'fa-eye',

  // ------------------------------------------- what only a stat sheet draws
  health: 'fa-heart',
  mana: 'fa-droplet',
  size: 'fa-expand',
  kills: 'fa-crosshairs',
  deaths: 'fa-skull',
  assists: 'fa-handshake-angle',
  minionsKilled: 'fa-coins',
  damageDealt: 'fa-hand-fist',
  damageTaken: 'fa-heart-crack',
};
