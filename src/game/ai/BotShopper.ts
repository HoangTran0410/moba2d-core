import type Champion from '@/game/gameObject/attackableUnits/Champion';
import type { QualifiedItem } from '@/content/PackRegistry';
import type { ItemStatKey } from '@/game/items/itemStats';
import { shopItems } from '@/game/economy/itemCatalog';
import {
  atOwnFountain,
  buyItem,
  componentSlotsFor,
  priceFor,
  refusalFor,
  type ShopHost,
  type ShopMode,
} from '@/game/economy/ItemShop';
import {
  CRIT_MULTIPLIER,
  MAX_ATTACK_SPEED,
  MAX_COOLDOWN_REDUCTION,
} from '@/game/gameObject/Stats';
import { profileFor, type BotDifficulty } from '@/game/ai/Difficulty';

/**
 * Bots buying their own items.
 *
 * ## The hole this fills
 *
 * `buyItem` had exactly two callers — the HUD panel and `net/HostSession`
 * answering a LAN client — and both of them are a *person*. Nothing in
 * `game/ai/` had ever mentioned the shop. So a bot earned gold from the first
 * minion of the match to the last and spent none of it, ever, while the player
 * across from it multiplied its damage by the better part of an order of
 * magnitude (`ChampionDefence.test.ts` measures a full attack build at about
 * 298 damage a second against a starting 15.4). Every match therefore had the
 * same shape: close for two minutes, then unloseable.
 *
 * ## What a bot buys, and why it is not a build order
 *
 * The obvious design is a list — boots, then a sword, then the big sword — and
 * core cannot write one. It does not know any pack's item names, and it must
 * not: a build order living here would be one pack's build order hard-coded
 * into the engine, wrong for every other pack and unmaintainable for that one.
 *
 * So the bot values items the way a player does, out of the numbers: it asks
 * what an item would do to *its own body*, and buys the best answer per gold.
 * `combatValue` is that question, and it is deliberately one formula rather
 * than a table of per-archetype weights — a marksman ends up buying attack
 * speed and a mage ability power without either of them being told which they
 * are, because the same multiplication values a point of attack speed by the
 * attack damage already on the champion and a point of ability power by the
 * ability damage every champion has.
 *
 * Offence and survival **multiply**, which is the one structural decision in
 * here. Added, a bot buys damage until the shop runs out; multiplied, the
 * marginal value of the fifth damage item falls below the first health item on
 * its own, and the bot diversifies for the same reason a player does.
 *
 * ## What it deliberately does not value
 *
 * `maxMana`, `manaRegen`, `healthRegen`, `attackRange` and `visionRadius`
 * contribute nothing. Mana is the honest omission of the five: how much a
 * champion needs depends on the kit it is holding, which is a pack's business,
 * and a wrong guess would have every bot in every pack overpaying for a
 * resource half of them barely spend. The consequence is stated rather than
 * hidden — a bot underrates a mana component, and will still buy one for the
 * ability power beside it.
 *
 * ## Every rule the player plays by
 *
 * Nothing here reimplements a shop rule. `refusalFor` decides whether a
 * purchase is legal — at its own fountain or dead, gold in hand, a slot free
 * or a recipe to fill, spells loaded — and `buyItem` re-checks all of it,
 * which means a bot cannot buy out in the lane, cannot overdraw, and appears
 * in `ShopHistory` exactly as a person's purchase does.
 */

/**
 * How often a bot looks at the shop. Slow on purpose: a purchase is a decision
 * about the whole match, `refusalFor` walks the entire catalogue, and a bot
 * spends all but a few seconds of its life somewhere a purchase is refused
 * anyway. Two seconds is well inside a death timer and inside the pause any
 * recall ends with.
 */
export const BOT_SHOP_INTERVAL_MS = 2_000;

/**
 * What a champion's abilities are worth per second, for valuing `abilityPower`
 * and `cooldownReduction`.
 *
 * A constant, because the real number is unknowable from here: it is the sum
 * over a pack's own spell classes of damage core never sees as a total. It is
 * set level with what an unbuilt champion's autos do (`DEFAULT_CHAMPION_ATTACK`
 * is 14 at 1.1/s), which encodes one claim — that a champion with no items is
 * worth about as much through its kit as through right-click. That is the
 * balance a shop is meant to be tuned toward, and the one a pack measures from
 * its own side when it decides how much ability power to sell.
 *
 * Being a constant is also what makes it fair between archetypes: a marksman
 * has more auto damage to multiply and a mage has less, so the same ability
 * term is a larger *share* of a mage's total and ability power outbids attack
 * damage on its sheet without anybody classifying it.
 */
export const BOT_ABILITY_BASELINE_DPS = 15.4;

/**
 * How much of a body's worth mobility is. Applied as `mobility ** exponent`
 * over the whole value rather than added to either half, because move speed
 * genuinely multiplies both: it is reach for the offence and escape for the
 * survival.
 *
 * Without it nothing values `speed` at all and no bot ever buys boots, which
 * is the single most visible thing a shopping bot does.
 */
export const BOT_MOBILITY_EXPONENT = 0.7;

/** Sustain as effective health: 10% omnivamp reads as a fifth again of the pool. */
const OMNIVAMP_HEALTH_EQUIVALENT = 2;

/**
 * The stats `combatValue` reads. A plain record rather than `Stats`, so the
 * "what if I also had this item" case is an object spread and needs no live
 * champion — which is what lets the whole valuation be tested as arithmetic.
 */
export interface BotBody {
  attackDamage: number;
  attackSpeed: number;
  onHitDamage: number;
  critChance: number;
  critDamage: number;
  abilityPower: number;
  cooldownReduction: number;
  omnivamp: number;
  maxHealth: number;
  armor: number;
  magicResist: number;
  speed: number;
}

/** Reads a live champion's current numbers, items and buffs included. */
export function bodyOf(champion: Champion): BotBody {
  const stats = champion.stats;
  return {
    attackDamage: stats.attackDamage.value,
    attackSpeed: stats.attackSpeed.value,
    onHitDamage: stats.onHitDamage.value,
    critChance: stats.critChance.value,
    critDamage: stats.critDamage.value,
    abilityPower: stats.abilityPower.value,
    cooldownReduction: stats.cooldownReduction.value,
    omnivamp: stats.omnivamp.value,
    maxHealth: stats.maxHealth.value,
    armor: stats.armor.value,
    magicResist: stats.magicResist.value,
    speed: stats.speed.value,
  };
}

/** The ceilings `Stats` enforces, applied here so a bot never pays past one. */
const clamp = (body: BotBody): BotBody => ({
  ...body,
  attackSpeed: Math.min(body.attackSpeed, MAX_ATTACK_SPEED),
  cooldownReduction: Math.min(body.cooldownReduction, MAX_COOLDOWN_REDUCTION),
  critChance: Math.min(body.critChance, 1),
  abilityPower: Math.max(-1, body.abilityPower),
});

/**
 * Which `BotBody` field an item stat lands on. The three item stats with no
 * entry — `maxMana`, `manaRegen`, `healthRegen` — are the omission the header
 * names; `attackRange` and `visionRadius` are the other two.
 */
const BODY_FIELD: Partial<Record<ItemStatKey, keyof BotBody>> = {
  attackDamage: 'attackDamage',
  attackSpeed: 'attackSpeed',
  onHitDamage: 'onHitDamage',
  critChance: 'critChance',
  critDamage: 'critDamage',
  abilityPower: 'abilityPower',
  cooldownReduction: 'cooldownReduction',
  omnivamp: 'omnivamp',
  maxHealth: 'maxHealth',
  armor: 'armor',
  magicResist: 'magicResist',
  speed: 'speed',
};

/** `body` with an item's stats added (`sign` 1) or taken back off (`sign` -1). */
export function applyItemStats(body: BotBody, def: QualifiedItem, sign = 1): BotBody {
  const next = { ...body };
  for (const [key, amount] of Object.entries(def.stats ?? {})) {
    const field = BODY_FIELD[key as ItemStatKey];
    if (!field || typeof amount !== 'number') continue;
    next[field] += sign * amount;
  }
  return next;
}

/**
 * The move speed every champion starts on (`Stats.speed`'s own default), used
 * only as the denominator that turns a speed into a ratio. Written here rather
 * than imported so a retune of the default cannot silently rescale every bot's
 * valuation of every item at once.
 */
const DEFAULT_BODY_SPEED = 3;

/**
 * What this body is worth in a fight, as one number.
 *
 * Offence times survival, both in units nobody has to interpret: damage a
 * second, and how much damage it takes to remove. The product is "how much
 * damage this body deals before it dies", which is the thing a build is
 * actually bought to raise and the reason the two halves multiply — see the
 * header.
 *
 * Only comparisons of this number mean anything. Its absolute magnitude is
 * damage-squared-per-second and is not a quantity.
 */
export function combatValue(raw: BotBody): number {
  const body = clamp(raw);

  const swing = (body.attackDamage + body.onHitDamage) *
    (1 + body.critChance * Math.max(0, body.critDamage - 1));
  const autos = swing * body.attackSpeed;
  // Cooldown reduction is more casts in the same second, which is what `1/(1-r)`
  // says and `r` alone does not: 50% off a cooldown is twice the casts, not
  // half again.
  const casts =
    (BOT_ABILITY_BASELINE_DPS * (1 + body.abilityPower)) / (1 - body.cooldownReduction);
  const offence = Math.max(0, autos + casts);

  // `Mitigation`'s own curve, averaged over the two damage types because a
  // build is bought against a team that has both.
  const mitigated = 0.5 * (1 + body.armor / 100) + 0.5 * (1 + body.magicResist / 100);
  const survival =
    Math.max(1, body.maxHealth) * mitigated * (1 + body.omnivamp * OMNIVAMP_HEALTH_EQUIVALENT);

  const mobility = Math.max(0.1, body.speed) / DEFAULT_BODY_SPEED;
  return offence * survival * Math.pow(mobility, BOT_MOBILITY_EXPONENT);
}

/**
 * What buying `def` would do to this champion's `combatValue`.
 *
 * The components a combine eats are taken **off** first. Without that a
 * finished item is valued as if its parts stayed in the bag, which is a
 * valuation of stats the champion is about to lose — and the cheaper the
 * combine, the worse the error, since `priceFor` has already credited exactly
 * those parts. Negative for a recipe that is a downgrade, which is a purchase
 * this refuses to make rather than one it has to be told about.
 */
export function itemValueFor(champion: Champion, def: QualifiedItem): number {
  const before = bodyOf(champion);
  let after = before;
  for (const slot of componentSlotsFor(champion, def)) {
    const part = champion.items?.[slot]?.def;
    if (part) after = applyItemStats(after, part as QualifiedItem, -1);
  }
  after = applyItemStats(after, def, 1);
  return combatValue(after) - combatValue(before);
}

export interface BotPurchaseOptions {
  /** Everything for sale. Defaults to every installed pack's shop. */
  catalog?: readonly QualifiedItem[];
  /** Which rules apply. Never `'CHEAT'` from the game — see `ShopMode`. */
  mode?: ShopMode;
  /**
   * How sharply this bot buys. An easy bot's ranking is badly jittered and a
   * hard one's barely — the same `DifficultyProfile.noise` column, applied the
   * same symmetric way `BotBrain.scoreSpell` applies it, so a tier's shopping
   * and its casting are graded by one number rather than two.
   */
  difficulty?: BotDifficulty;
  rng?: () => number;
}

/**
 * The single best thing this champion could buy right now, or `null`.
 *
 * One purchase, not a shopping spree: a bot with a lot of gold works through
 * its build over successive ticks, which keeps every step re-measured against
 * the body the last step produced — a bot that bought its whole build in one
 * frame would be valuing item four against the body it had before item one.
 *
 * An item already in the bag is never a candidate. Core has no opinion on
 * whether a pack's items stack, and six copies of one component is the shape
 * that failure takes when nothing says otherwise.
 */
export function nextBotPurchase(
  champion: Champion,
  host: ShopHost,
  options: BotPurchaseOptions = {}
): QualifiedItem | null {
  const { catalog = shopItems(), mode = 'PLAYER', rng = Math.random } = options;
  const noise = options.difficulty ? profileFor(options.difficulty).noise : 0;

  const held = new Set<string>();
  for (const item of champion.items ?? []) if (item?.def) held.add(item.def.id);

  let best: QualifiedItem | null = null;
  let bestScore = 0;

  for (const def of catalog) {
    if (held.has(def.id)) continue;
    if (refusalFor(champion, def, host, mode) !== null) continue;

    const gain = itemValueFor(champion, def);
    if (gain <= 0) continue;

    // Per gold, so a 300g component competes with a 1500g finished item on the
    // only terms a wallet understands. Floored at 1 so a free item — a map may
    // price one at zero — is not a division by zero that wins everything.
    const perGold = gain / Math.max(1, priceFor(champion, def));
    const score = noise > 0 ? perGold * (1 + (rng() * 2 - 1) * noise) : perGold;
    if (score > bestScore) {
      bestScore = score;
      best = def;
    }
  }

  return best;
}

/**
 * One shopping tick. Answers what it bought, or `null`.
 *
 * The location gate is asked here as well as inside `refusalFor` — not to
 * enforce it twice but because it is the cheap question: a bot is in its lane
 * for almost all of a match, and this is what keeps the catalogue scan off
 * every one of those ticks.
 */
export function botShopTick(
  champion: Champion,
  host: ShopHost,
  options: BotPurchaseOptions = {}
): QualifiedItem | null {
  if (champion.toRemove) return null;
  if (options.mode !== 'CHEAT' && !champion.isDead && !atOwnFountain(champion, host)) return null;

  const def = nextBotPurchase(champion, host, options);
  if (!def) return null;
  return buyItem(champion, def, host, options.mode ?? 'PLAYER') ? def : null;
}
