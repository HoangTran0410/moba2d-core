import { ITEM_STAT_KEYS, type ItemStatKey } from '@/game/items/itemStats';
import type { ItemDef } from '@/content/ContentPack';
import { FRAMES_PER_SECOND } from '@/game/gameObject/Stats';

/**
 * What an item grants, as lines a player reads — one stat per line.
 *
 * Lived inside `shop/shopState.ts` until the inventory tooltip needed the same
 * thing. It needed it because of what the packs were doing to work around not
 * having it: every item description opened by restating its own stat block in
 * prose ("Tăng 40 giáp, 30 kháng phép và 55% sát thương chiêu thức"), so the
 * shop card printed the same numbers twice — once as a list, once as a
 * sentence — and the inventory tooltip, which had no list, printed them only
 * as the sentence and in one flat colour.
 *
 * With the list available in both places the prose can stop repeating it, and
 * a description goes back to being what it should have been: the passive, the
 * active, and any note the numbers cannot carry.
 */

/**
 * What each stat is called.
 *
 * Written out rather than derived from the key, because the derivation would
 * be "insert spaces and capitalise", which produces `Magic Resist` — English,
 * in a UI that is Vietnamese everywhere else.
 */
export const STAT_LABEL: Record<ItemStatKey, string> = {
  maxHealth: 'Máu tối đa',
  maxMana: 'Năng lượng tối đa',
  healthRegen: 'Hồi máu',
  manaRegen: 'Hồi năng lượng',
  speed: 'Tốc chạy',
  // Two move-speed stats, and the labels have to be told apart because
  // `shopFilter.ts` keys its chips *by label* — two entries reading "Tốc chạy"
  // would collapse into one chip that counts half the shelf. The percent one
  // wears the sign in its name for the same reason Riot's own item data has
  // `FlatMovementSpeedMod` beside `PercentMovementSpeedMod`.
  speedPercent: 'Tốc chạy %',
  attackDamage: 'Sát thương',
  abilityPower: 'Sức mạnh phép',
  abilityHaste: 'Điểm hồi kỹ năng',
  attackSpeed: 'Tốc đánh',
  attackRange: 'Tầm đánh',
  armor: 'Giáp',
  magicResist: 'Kháng phép',
  critChance: 'Chí mạng',
  critDamage: 'Sát thương chí mạng',
  // Three sustain stats need three names a player can tell apart at a glance.
  // `omnivamp` was plain "Hút máu" while it was the only one; it keeps the
  // general word and gains the qualifier that says it covers everything.
  omnivamp: 'Hút máu toàn phần',
  lifesteal: 'Hút máu vật lý',
  spellVamp: 'Hút máu phép',
  onHitDamage: 'Sát thương cộng thêm',
  visionRadius: 'Tầm nhìn',
  // The counters. Each is a *share* of something the other side bought, so
  // each name says what it eats rather than what it grants.
  armorPenetration: 'Xuyên giáp',
  magicPenetration: 'Xuyên kháng phép',
  tenacity: 'Kháng hiệu ứng',
  healingReceived: 'Tăng hồi phục nhận vào',
};

/**
 * Stats a player reads as a percentage rather than as points.
 *
 * Exported because a buff asks the same question — `buffs/describeBuff.ts`
 * lists what a `StatAmp` grants — and the answer is a property of the stat,
 * not of the shop.
 *
 * **This list has to agree with `items/Item.ts`'s `GRANT_SLOT`**, and it once
 * did not: attack speed became a share of the wearer's own rate there and this
 * file went on printing it as points, so a bow granting +15% swing rate drew
 * `+0.15` on its card — a number that reads as a fifteenth of a swing and is
 * off by the champion's whole base rate. Anything landing on a `percent*`
 * slot belongs here, and the two lists are checked against each other by
 * `itemStatLines.test.ts` rather than by remembering.
 *
 * `abilityHaste` is the one that looks like it belongs and does not: it is
 * points on purpose, and 25 of them is not 25% off anything (`Stats.ts`'s
 * `hasteCooldownMultiplier`).
 */
/**
 * Stats stored per *frame* and read by humans per second.
 *
 * `Stats.ts` adds the whole regen stat once per frame, so `manaRegen: 1.2` is
 * 72 mana a second — and its own comment says it outright: "every place that
 * shows regeneration to a human has to multiply by this". Two of the three
 * places did. `practice/participantStats.ts` divides by nothing and prints
 * `x / giây`, `buffs/describeBuff.ts` prints `+x/giây`, and this file — the
 * shop card, the one a player reads *before* spending gold — printed the
 * stored number raw.
 *
 * So a card promising "Hồi năng lượng +1.2" delivered 72/s against a base of
 * 6, and the panel two clicks away said 78 / giây about the same item. It is
 * also how the wrong number gets *written*: a pack author picks a per-second
 * figure, the card agrees with them, and nothing anywhere says otherwise until
 * somebody notices a 500-gold stone refilling a 500 pool in seven seconds —
 * "sao mấy item hồi năng lượng, nó hồi nhanh vl vậy?".
 */
export const AS_PER_SECOND = new Set<ItemStatKey>(['healthRegen', 'manaRegen']);

export const AS_PERCENT = new Set<ItemStatKey>([
  'critChance',
  'critDamage',
  'omnivamp',
  'lifesteal',
  'spellVamp',
  'abilityPower',
  'armorPenetration',
  'magicPenetration',
  'tenacity',
  'healingReceived',
  'attackSpeed',
  'speedPercent',
]);

export interface StatLine {
  label: string;
  /** Already formatted — `+40`, `+8%`. */
  amount: string;
}

const formatAmount = (key: ItemStatKey, amount: number): string => {
  const sign = amount < 0 ? '' : '+';
  if (AS_PERCENT.has(key)) return `${sign}${Math.round(amount * 100)}%`;
  // The unit the stat is *stored* in is not the unit it is read in. One
  // decimal and no trailing `.0`, the same shape `participantStats.ts` prints,
  // so the card and the panel are recognisably the same number.
  if (AS_PER_SECOND.has(key)) {
    return `${sign}${Number((amount * FRAMES_PER_SECOND).toFixed(1))}/giây`;
  }
  return `${sign}${Math.round(amount * 100) / 100}`;
};

/**
 * `ITEM_STAT_KEYS` order, not the def's own key order, so two items that grant
 * the same pair of stats list them the same way round — a card a player can
 * compare against the card beside it, and a tooltip that does not reshuffle
 * itself when a pack author reorders an object literal.
 */
export function statLinesFor(def: Pick<ItemDef, 'stats'> | undefined): StatLine[] {
  const lines: StatLine[] = [];
  if (!def) return lines;
  for (const key of ITEM_STAT_KEYS) {
    const amount = def.stats?.[key];
    if (typeof amount !== 'number' || amount === 0) continue;
    lines.push({ label: STAT_LABEL[key], amount: formatAmount(key, amount) });
  }
  return lines;
}
