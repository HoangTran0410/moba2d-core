import { ITEM_STAT_KEYS, type ItemStatKey } from '@/game/items/itemStats';
import type { ItemDef } from '@/content/ContentPack';

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
  attackDamage: 'Sát thương',
  abilityPower: 'Sức mạnh phép',
  cooldownReduction: 'Giảm hồi chiêu',
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
};

/**
 * Stats a player reads as a percentage rather than as points.
 *
 * Exported because a buff asks the same question — `buffs/describeBuff.ts`
 * lists what a `StatAmp` grants — and the answer is a property of the stat,
 * not of the shop. Note who is *not* on it: `attackSpeed` is points in this
 * engine, and a second copy of this list written from memory gets that wrong.
 */
export const AS_PERCENT = new Set<ItemStatKey>([
  'critChance',
  'critDamage',
  'omnivamp',
  'lifesteal',
  'spellVamp',
  'abilityPower',
  'cooldownReduction',
]);

export interface StatLine {
  label: string;
  /** Already formatted — `+40`, `+8%`. */
  amount: string;
}

const formatAmount = (key: ItemStatKey, amount: number): string => {
  const sign = amount < 0 ? '' : '+';
  if (AS_PERCENT.has(key)) return `${sign}${Math.round(amount * 100)}%`;
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
