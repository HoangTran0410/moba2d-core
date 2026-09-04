import type Champion from '@/game/gameObject/attackableUnits/Champion';
import type { QualifiedItem } from '@/content/PackRegistry';
import type { ItemStatKey } from '@/game/items/itemStats';
import { shopItems } from '@/game/economy/itemCatalog';
import {
  atOwnFountain,
  buyItem,
  componentSlotsFor,
  priceFor,
  refundBag,
  refundFractionOf,
  refusalFor,
  sellItem,
  sellValueOf,
  type ShopHost,
  type ShopMode,
} from '@/game/economy/ItemShop';
import { CRIT_MULTIPLIER, MAX_ATTACK_SPEED, MAX_ABILITY_HASTE } from '@/game/gameObject/Stats';
import { abilityMultiplier } from '@/game/combat/Amplification';
import { SCALING_SPAN_OPEN } from '@/game/combat/DamageText';
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
 * ability damage its own kit says it deals.
 *
 * That last clause is `AbilityMix` below, and it is the one thing the bot asks
 * the *content* rather than the stat block. Everything else here is arithmetic
 * over numbers core owns; which stat amplifies an ability is a fact only the
 * pack knows, and it declares it in the one place it already had to — the
 * class on a `damage` span. Still not an archetype table: nothing is named, and
 * a champion is whatever the four descriptions it is holding add up to.
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
 * and `abilityHaste`.
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

/**
 * Which stat this champion's **abilities** actually scale on, read off the kit
 * it is holding.
 *
 * ## The bug this exists for
 *
 * `combatValue` priced every ability in the game as magic damage, because
 * that is the engine's default and nothing here could see past it. It is
 * wrong for a third of the shipped abilities: `combat/Amplification.ts`
 * multiplies a `PHYSICAL` ability by **bonus attack damage** and a `MAGIC`
 * one by **ability power**, and they are not interchangeable. So a bot on a
 * marksman whose four abilities are all physical read a rod of ability power
 * as a straight multiplier on its whole kit, bought it over a sword that
 * would really have scaled that kit, and got nothing at all for the gold. The
 * player across from it did not have that problem, because a player can read.
 *
 * ## Why the description is the signal
 *
 * A pack already declares this, once per figure, in the only place both the
 * stylesheet and `amplifiedDamageText` read: the class on a `damage` span.
 * Core does not have to ask a pack for anything new, and the answer is per
 * *ability* rather than per champion, which is the granularity the question
 * actually has: a shipped roster has several champions whose first ability is
 * physical and whose other three are magic.
 *
 * A `heal` span counts as magic, because that is what the engine does with
 * one: `takeHeal` and `buffs/Shield` amplify by `abilityPower` and there is
 * nothing for a restored number to read off attack damage. An untyped
 * `damage` span counts as magic for the same reason — it is the default
 * `amplifiedDamageText` applies to it.
 *
 * ## `coverage`, and why a support is not a carry
 *
 * The three shares say *which* stat amplifies this kit. They cannot say how
 * much of the kit is amplified at all, and that is the other half of the same
 * question: a champion whose four abilities are a dash, a stun, a taunt and a
 * shield has one number in it a power stat can move. Valuing all four as
 * amplified damage is what made every bot in every pack shop like a carry.
 *
 * Counted per *ability*, never per span. A pack that writes its damage over
 * time as "3 a tick (30 total)" spends two spans on one ability and one that
 * writes the total alone spends one, so counting spans would let prose style
 * outvote the kit.
 */
export interface AbilityMix {
  /** Share of this kit's amplified abilities that bonus attack damage scales. */
  physical: number;
  /** The same for ability power — heals and shields included. */
  magic: number;
  /** True damage, which `abilityMultiplier` pays out of whichever is better. */
  trueDamage: number;
  /** Share of the kit's abilities that anything amplifies at all, 0 to 1. */
  coverage: number;
}

/**
 * What a body that names no kit is worth, and it is deliberately *exactly*
 * what this module did before a kit could be read: every ability magic, every
 * ability amplified. Hand-built bodies in tests and any future caller with no
 * champion in hand keep the old valuation rather than silently losing their
 * ability term.
 */
export const DEFAULT_ABILITY_MIX: Readonly<AbilityMix> = Object.freeze({
  physical: 0,
  magic: 1,
  trueDamage: 0,
  coverage: 1,
});

/**
 * Every `damage`/`heal` span opener a pack writes — `combat/DamageText.ts`'s
 * own pattern, never a copy of it. Only the classes are read: this needs to
 * know which stat pays for the ability, not how much.
 *
 * It *was* a copy, and the copy is what made this whole module stop working
 * the day the packs started writing `data-base`. See `SCALING_SPAN_OPEN`.
 */
const SCALING_SPAN = SCALING_SPAN_OPEN;

/** Anything with a kit. Structural, so the valuation stays testable without a match. */
interface KitBearer {
  spells?: readonly {
    description?: unknown;
    damageScalesWithAbilityPower?: boolean;
  }[];
}

/**
 * The mix this champion's own kit declares.
 *
 * `damageScalesWithAbilityPower` is the filter, and it is the same gate
 * `Spell.effectiveDescription` asks before rescaling a tooltip — so the basic
 * attack (`coreSpells/BasicAttack` opts out) and a held item's own passive and
 * active (`economy/ItemShop` opts them out) are excluded without this having
 * to know what either of them is.
 *
 * Falls back to `DEFAULT_ABILITY_MIX` for a champion with no kit at all rather
 * than to a zeroed mix: no abilities read is "nothing to go on", which is the
 * old behaviour, and not "a kit that scales with nothing", which would have a
 * bot refuse to buy ability power for a pack that tags no spans.
 */
export function kitAbilityMix(champion: KitBearer): AbilityMix {
  const abilities = (champion.spells ?? []).filter(
    spell => spell?.damageScalesWithAbilityPower === true
  );
  if (abilities.length === 0) return DEFAULT_ABILITY_MIX;

  const total = { physical: 0, magic: 0, trueDamage: 0 };
  let amplified = 0;

  for (const spell of abilities) {
    const description = typeof spell.description === 'string' ? spell.description : '';
    const named = new Set<'physical' | 'magic' | 'trueDamage'>();
    for (const [, type] of description.matchAll(SCALING_SPAN)) {
      // An untyped span is the engine's own default, exactly as
      // `amplifiedDamageText` treats it.
      named.add(type === 'physical' ? 'physical' : type === 'true' ? 'trueDamage' : 'magic');
    }
    if (named.size === 0) continue;
    amplified++;
    // One ability is one vote, split evenly when it deals two types — an
    // execute that is magic until it beheads and true when it does, and
    // neither half is more of the ability than the other.
    for (const type of named) total[type] += 1 / named.size;
  }

  if (amplified === 0) {
    return { physical: 0, magic: 1, trueDamage: 0, coverage: 0 };
  }
  return {
    physical: total.physical / amplified,
    magic: total.magic / amplified,
    trueDamage: total.trueDamage / amplified,
    coverage: amplified / abilities.length,
  };
}

/** Sustain as effective health: 10% omnivamp reads as a fifth again of the pool. */
const OMNIVAMP_HEALTH_EQUIVALENT = 2;

/**
 * What a *typed* vamp point is worth against an omnivamp one.
 *
 * `lifesteal` and `spellVamp` each cover one side of the damage-type split
 * (`combat/Vamp.ts`), so a point of either returns health on some of a
 * champion's output rather than on all of it. Half, because the shopper does
 * not know which side this champion's kit sits on — it prices a build, and
 * asking the roster what type each ability deals is a question with 240
 * answers. A champion who really is one-typed is under-served by this, which
 * is the safe direction: it buys the general stat when in doubt.
 */
const TYPED_VAMP_SHARE = 0.5;

/**
 * The stats `combatValue` reads. A plain record rather than `Stats`, so the
 * "what if I also had this item" case is an object spread and needs no live
 * champion — which is what lets the whole valuation be tested as arithmetic.
 */
export interface BotBody {
  attackDamage: number;
  attackSpeed: number;
  /**
   * The wearer's *unbuilt* swing rate, which an item's attack speed is a share
   * of (`items/Item.ts`'s `GRANT_SLOT`). Carried beside the total because
   * "what if I also had this item" has to add the same absolute number the
   * stat pipeline would — a share of the *current* total compounds, and a bot
   * would price its fourth attack-speed item as its most valuable one.
   */
  baseAttackSpeed: number;
  onHitDamage: number;
  critChance: number;
  critDamage: number;
  abilityPower: number;
  abilityHaste: number;
  /**
   * The wearer's *unbuilt* attack damage, because only the **bonus** half
   * scales a physical ability (`Amplification.physicalPowerMultiplier`).
   * Optional: a body that omits it reports no bonus, which is what a body
   * that also omits `abilityMix` is valued as anyway.
   */
  baseAttackDamage?: number;
  /** What this champion's abilities scale on. Defaults to `DEFAULT_ABILITY_MIX`. */
  abilityMix?: AbilityMix;
  omnivamp: number;
  lifesteal: number;
  spellVamp: number;
  maxHealth: number;
  armor: number;
  magicResist: number;
  speed: number;
  /** The wearer's *unbuilt* walk, for `speedPercent` — the same reason as `baseAttackSpeed`. */
  baseSpeed: number;
}

/**
 * Reads a live champion's current numbers, items and buffs included.
 *
 * `mix` is a parameter with a default rather than always being read here
 * because `nextBotPurchase` calls this once per item on the shelf, and the kit
 * behind it does not change between two items in the same decision — see the
 * call there. Every other caller gets the champion's real kit by omitting it.
 */
export function bodyOf(champion: Champion, mix: AbilityMix = kitAbilityMix(champion)): BotBody {
  const stats = champion.stats;
  return {
    attackDamage: stats.attackDamage.value,
    attackSpeed: stats.attackSpeed.value,
    baseAttackSpeed: stats.attackSpeed.baseValue,
    onHitDamage: stats.onHitDamage.value,
    critChance: stats.critChance.value,
    critDamage: stats.critDamage.value,
    abilityPower: stats.abilityPower.value,
    abilityHaste: stats.abilityHaste.value,
    baseAttackDamage: stats.attackDamage.baseValue,
    abilityMix: mix,
    omnivamp: stats.omnivamp.value,
    lifesteal: stats.lifesteal.value,
    spellVamp: stats.spellVamp.value,
    maxHealth: stats.maxHealth.value,
    armor: stats.armor.value,
    magicResist: stats.magicResist.value,
    speed: stats.speed.value,
    baseSpeed: stats.speed.baseValue,
  };
}

/** The ceilings `Stats` enforces, applied here so a bot never pays past one. */
const clamp = (body: BotBody): BotBody => ({
  ...body,
  attackSpeed: Math.min(body.attackSpeed, MAX_ATTACK_SPEED),
  abilityHaste: Math.min(body.abilityHaste, MAX_ABILITY_HASTE),
  critChance: Math.min(body.critChance, 1),
  abilityPower: Math.max(-1, body.abilityPower),
});

/**
 * Which `BotBody` field an item stat lands on. The three item stats with no
 * entry — `maxMana`, `manaRegen`, `healthRegen` — are the omission the header
 * names; `attackRange` and `visionRadius` are the other two.
 */
/**
 * The numeric fields an item may actually move. Spelled out rather than
 * `keyof BotBody`, which now also names `abilityMix` — a record, not a number,
 * and `+=` on it is exactly the mistake worth a compile error.
 */
type GrantableBodyField =
  | 'attackDamage'
  | 'attackSpeed'
  | 'onHitDamage'
  | 'critChance'
  | 'critDamage'
  | 'abilityPower'
  | 'abilityHaste'
  | 'omnivamp'
  | 'lifesteal'
  | 'spellVamp'
  | 'maxHealth'
  | 'armor'
  | 'magicResist'
  | 'speed';

const BODY_FIELD: Partial<Record<ItemStatKey, GrantableBodyField>> = {
  attackDamage: 'attackDamage',
  attackSpeed: 'attackSpeed',
  onHitDamage: 'onHitDamage',
  critChance: 'critChance',
  critDamage: 'critDamage',
  abilityPower: 'abilityPower',
  abilityHaste: 'abilityHaste',
  omnivamp: 'omnivamp',
  lifesteal: 'lifesteal',
  spellVamp: 'spellVamp',
  maxHealth: 'maxHealth',
  armor: 'armor',
  magicResist: 'magicResist',
  speed: 'speed',
  speedPercent: 'speed',
};

/**
 * The stats granted as a **share of the wearer**, and the unbuilt number that
 * share is of. Mirrors `items/Item.ts`'s `GRANT_SLOT`: a key here is a key
 * whose amount is a fraction, and pricing it as points is a bot that values a
 * +15% bow at fifteen hundredths of a swing.
 *
 * The share is always of the *base*, never of the running total. The total
 * already contains the last three items, so a share of it compounds and a bot
 * prices its fourth attack-speed item as its most valuable one — and it would
 * no longer subtract to zero when `applyItemStats` takes a component back off.
 */
const SHARE_OF: Partial<Record<ItemStatKey, 'baseAttackSpeed' | 'baseSpeed'>> = {
  attackSpeed: 'baseAttackSpeed',
  speedPercent: 'baseSpeed',
};

/** `body` with an item's stats added (`sign` 1) or taken back off (`sign` -1). */
export function applyItemStats(body: BotBody, def: QualifiedItem, sign = 1): BotBody {
  const next = { ...body };
  for (const [key, amount] of Object.entries(def.stats ?? {})) {
    const field = BODY_FIELD[key as ItemStatKey];
    if (!field || typeof amount !== 'number') continue;
    const shareOf = SHARE_OF[key as ItemStatKey];
    const points = shareOf ? amount * body[shareOf] : amount;
    next[field] += sign * points;
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

  const swing =
    (body.attackDamage + body.onHitDamage) *
    (1 + body.critChance * Math.max(0, body.critDamage - 1));
  const autos = swing * body.attackSpeed;
  // What this build does to *this* kit, asked of `combat/Amplification.ts`
  // itself rather than restated here. That module is what `takeDamage`,
  // `takeHeal` and `buffs/Shield` all run through, so routing the bot's
  // valuation through the same function is what makes "what the bot thinks an
  // item is worth" and "what the item does" one answer that cannot drift —
  // the previous code was a hand-copied `1 + abilityPower`, which was the
  // whole of the physical-kit bug.
  const mix = raw.abilityMix ?? DEFAULT_ABILITY_MIX;
  const source = {
    stats: {
      abilityPower: { value: body.abilityPower },
      attackDamage: {
        value: body.attackDamage,
        // No base means no bonus, never a negative one — see `baseAttackDamage`.
        baseValue: body.baseAttackDamage ?? body.attackDamage,
      },
    },
  };
  const amplified =
    mix.physical * abilityMultiplier('PHYSICAL', source) +
    mix.magic * abilityMultiplier('MAGIC', source) +
    mix.trueDamage * abilityMultiplier('TRUE', source);

  // `coverage` blends that multiplier toward 1 for the share of the kit
  // nothing amplifies. A dash and a taunt are still abilities worth casting
  // and still come up sooner with haste — they are simply not numbers a power
  // stat moves, so they dilute the multiplier instead of being priced as if
  // they were damage.
  const share = Math.min(1, Math.max(0, mix.coverage));

  // Haste is *casts per second*, linear in the stat by construction: 100 haste
  // is one extra cast in the time two used to take. That is the whole reason
  // the stat is points rather than the fraction it replaced — the bot's
  // valuation is a straight multiply now instead of `1/(1-r)`, which grew
  // without bound as the fraction approached its cap. It multiplies the whole
  // kit, amplified or not, which is why it sits outside `amplified`.
  const casts =
    BOT_ABILITY_BASELINE_DPS * (1 + (amplified - 1) * share) * (1 + body.abilityHaste / 100);
  const offence = Math.max(0, autos + casts);

  // `Mitigation`'s own curve, averaged over the two damage types because a
  // build is bought against a team that has both.
  const mitigated = 0.5 * (1 + body.armor / 100) + 0.5 * (1 + body.magicResist / 100);
  const vamp = body.omnivamp + (body.lifesteal + body.spellVamp) * TYPED_VAMP_SHARE;
  const survival =
    Math.max(1, body.maxHealth) * mitigated * (1 + vamp * OMNIVAMP_HEALTH_EQUIVALENT);

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
export function itemValueFor(
  champion: Champion,
  def: QualifiedItem,
  mix: AbilityMix = kitAbilityMix(champion)
): number {
  const before = bodyOf(champion, mix);
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

  // Once for the whole shelf. The kit is the same for every candidate, and
  // reading it per item would re-scan every ability's description once per
  // item on sale.
  const mix = kitAbilityMix(champion);

  let best: QualifiedItem | null = null;
  let bestScore = 0;

  for (const def of catalog) {
    if (held.has(def.id)) continue;
    if (refusalFor(champion, def, host, mode) !== null) continue;

    const gain = itemValueFor(champion, def, mix);
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
 * How much better a swap has to be before a bot will pay the refund to make it.
 *
 * A sale returns `SELL_REFUND_FRACTION` of what the item cost — 30% of the
 * gold evaporates — so a swap that is merely *level* is a straight loss, and a
 * swap that is barely ahead is a loss the next tick will want to undo. The
 * margin is what makes the decision one-way: each swap has to raise
 * `combatValue` by a tenth, and nothing can raise it by a tenth in both
 * directions, so a bot cannot oscillate between two builds.
 *
 * A share of the champion's *current* value rather than a flat number, because
 * `combatValue` is damage-squared-per-second and its magnitude means nothing
 * on its own — a fixed threshold would be untouchable at level one and
 * meaningless on a finished build.
 */
export const BOT_SWAP_MARGIN = 0.1;

/** A sale and the purchase it pays for. */
export interface BotSwap {
  slot: number;
  sell: QualifiedItem;
  buy: QualifiedItem;
}

/**
 * The best "sell one, buy one" this champion could make, or `null`.
 *
 * ## Why a bot needs this at all
 *
 * `nextBotPurchase` answers `null` for a full bag — every candidate is refused
 * with `NO_SLOT` — so a bot that finished a build stopped shopping for the
 * rest of the match and banked its income forever. That is merely wasteful
 * until the bot **respawns as a different champion**, which is the default
 * (`AIChampion._respawnWithNewPreset`): `respawn()` does not empty the bag, so
 * a mage inherits the marksman's six attack-damage items and can never sell
 * one to fix it. Reported exactly that way — a bot re-rolled into a new
 * champion, holding the wrong build, with the gold to fix it and no way to.
 *
 * ## Only when there is nothing to buy outright
 *
 * `botShopTick` asks this after `nextBotPurchase` comes back empty, never
 * instead of it. Selling costs 30% and a free slot never needs paying for, so
 * a swap is the answer to "the bag is full and wrong", not to "I am poor".
 *
 * ## What it will not consider
 *
 * A candidate that is **built from the slot being sold**. `priceFor` credits
 * components already in the bag, so selling one raises the price of anything
 * that would have eaten it — the bot would sell, then find it could no longer
 * afford the thing it sold for, and be down the refund for nothing. Excluding
 * them is what makes the price computed here the price `buyItem` will charge.
 */
export function bestBotSwap(
  champion: Champion,
  host: ShopHost,
  options: BotPurchaseOptions = {}
): BotSwap | null {
  const { catalog = shopItems(), mode = 'PLAYER' } = options;

  const items = champion.items ?? [];
  const held = new Set<string>();
  for (const item of items) if (item?.def) held.add(item.def.id);

  const mix = kitAbilityMix(champion);
  const body = bodyOf(champion, mix);
  const now = combatValue(body);
  const gold = champion.wallet?.balance ?? 0;
  const refundFraction = refundFractionOf(host);

  let best: BotSwap | null = null;
  let bestGain = now * BOT_SWAP_MARGIN;

  for (let slot = 0; slot < items.length; slot++) {
    const sold = items[slot]?.def as QualifiedItem | undefined;
    if (!sold) continue;

    const budget = gold + sellValueOf(sold, refundFraction);
    // The body this champion would have standing in the shop with the slot
    // empty — what every candidate below is measured against.
    const without = applyItemStats(body, sold, -1);

    for (const def of catalog) {
      if (held.has(def.id)) continue;
      // See the header: a combine that would have eaten this slot prices
      // itself differently the moment the slot is gone.
      if (componentSlotsFor(champion, def).includes(slot)) continue;
      if (priceFor(champion, def) > budget) continue;
      // Everything else the shop refuses for — spells not loaded, and the
      // location rule `botShopTick` has already asked about.
      if (refusalFor(champion, def, host, mode) === 'NOT_LOADED') continue;

      const gain = combatValue(applyItemStats(without, def, 1)) - now;
      if (gain > bestGain) {
        bestGain = gain;
        best = { slot, sell: sold, buy: def };
      }
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

  const mode = options.mode ?? 'PLAYER';

  const def = nextBotPurchase(champion, host, options);
  if (def) return buyItem(champion, def, host, mode) ? def : null;

  // Nothing to buy outright. That is a finished build most of the time and a
  // *wrong* build after a re-roll, so the bag itself becomes the candidate —
  // see `bestBotSwap`.
  const swap = bestBotSwap(champion, host, options);
  if (!swap) return null;

  // Sell first, then buy: the slot has to be free before `buyItem` will take
  // it. `bestBotSwap` has already priced the purchase against the refund and
  // excluded anything whose price the sale would move, so this cannot leave
  // the bot down a slot and unable to fill it — but if the purchase is
  // refused anyway, the refund is in the wallet and the next tick reconsiders
  // from the body it actually has, rather than this one retrying blind.
  if (sellItem(champion, swap.slot, host, mode) === 0) return null;
  return buyItem(champion, swap.buy, host, mode) ? swap.buy : null;
}

/**
 * How many purchases one rebuild may make before it stops and leaves the rest
 * to the ordinary shop tick.
 *
 * A safety net, not a budget. The loop below ends on its own the moment
 * `nextBotPurchase` runs out of things worth buying, which for a bag that was
 * just handed back is about as many purchases as it had items. The ceiling is
 * there because a shelf may price an item at zero — `nextBotPurchase` floors
 * the divisor at 1 for exactly that reason — and a free component that a
 * combine keeps eating is a loop nothing else terminates. Three per slot,
 * because filling six slots with components and then combining each one is a
 * legitimate twelve.
 */
export const BOT_REBUILD_PURCHASE_LIMIT = 18;

/**
 * Hands this champion's bag back at cost and buys a new one for the kit it is
 * holding now. Answers whether it did.
 *
 * ## The bug this is the answer to
 *
 * A bot re-rolls into a new champion every time it dies and `respawn()` does
 * not empty the bag, so it wakes up as a mage holding six attack items.
 * `bestBotSwap` was the first answer and it is the wrong one *here*: a swap
 * pays `SELL_REFUND_FRACTION` for the privilege, so fixing a six-item build
 * one slot at a time burns 30% of the whole bag — and then the bot dies again,
 * re-rolls again, and pays it again. Every death made it poorer, which is the
 * opposite of what a shopping bot is for and was reported as exactly that: the
 * more it died, the more it sold and re-bought, the weaker it got.
 *
 * The tax is what is wrong, not the rebuilding. A bot that re-rolls did not
 * change its mind about its build — the match changed the champion under it —
 * so `refundBag` reverses the purchases at the price they were made and the
 * bot buys again with the same gold it had. See `ItemShop.refundBag` for why
 * that is not the free-refund door it looks like.
 *
 * ## Why the whole build, in one call
 *
 * `nextBotPurchase` buys one item per tick on purpose, and this is the one
 * moment that pacing would be wrong: a bot respawns, walks out of the fountain
 * within a couple of seconds, and would be carrying one item and a purse for
 * the rest of the life. Each step is still re-measured against the body the
 * step before it produced — the loop calls `nextBotPurchase` again rather than
 * ranking the shelf once — so the build it lands on is the one it would have
 * arrived at anyway, just without the walk.
 *
 * ## What it refuses to do
 *
 * Anything at all when the champion is not somewhere it could shop. The refund
 * and the re-buy have to be the same trip: a bot that emptied its bag out in
 * the lane would be holding nothing until it next went home. It asks the
 * question `botShopTick` opens with, and when the answer is no it leaves the
 * wrong build alone — that is the case `bestBotSwap` still covers.
 */
export function rebuildBotBag(
  champion: Champion,
  host: ShopHost,
  options: BotPurchaseOptions = {}
): boolean {
  if (champion.toRemove) return false;
  const mode = options.mode ?? 'PLAYER';
  if (mode !== 'CHEAT' && !champion.isDead && !atOwnFountain(champion, host)) return false;
  // Nothing to hand back is not a rebuild — `nextBotPurchase` on the next tick
  // is already the right answer for an empty bag.
  if (!(champion.items ?? []).some(held => held)) return false;

  refundBag(champion);

  for (let bought = 0; bought < BOT_REBUILD_PURCHASE_LIMIT; bought++) {
    const def = nextBotPurchase(champion, host, options);
    if (!def) break;
    // A refusal here is the shop saying no to something this had already
    // priced — nothing left to do but stop, with the gold still in the wallet
    // for the next tick to spend.
    if (!buyItem(champion, def, host, mode)) break;
  }

  return true;
}
