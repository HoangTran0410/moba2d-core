/**
 * A bot spending its own gold.
 *
 * Bots had earned gold since the wallet existed and had never once opened the
 * shop: `buyItem`'s only callers were the HUD panel and the LAN host, both of
 * them a person. So every match went the same way — even for two minutes,
 * then unloseable, because one side's damage multiplied with its build and the
 * other side's did not.
 *
 * The two things worth pinning are what it buys and what it refuses to. The
 * first is a *valuation*, not a build order (core cannot name a pack's items),
 * so the cases below are about the valuation behaving like one: a marksman's
 * sheet must make attack speed beat armour, a mage's must make ability power
 * beat attack damage, and a champion that has bought nothing but damage must
 * eventually want health — which is the whole reason the two halves multiply.
 *
 * The second is that nothing here is a second implementation of the shop's
 * rules. Every refusal is `ItemShop.refusalFor`'s, so the cases prove the bot
 * inherits them rather than restating them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '@/testing';
import {
  BOT_ABILITY_BASELINE_DPS,
  DEFAULT_ABILITY_MIX,
  bestBotSwap,
  bodyOf,
  botShopTick,
  combatValue,
  itemValueFor,
  kitAbilityMix,
  nextBotPurchase,
  type BotBody,
} from '@/game/ai/BotShopper';
import { MAX_ABILITY_HASTE } from '@/game/gameObject/Stats';
import { grantItem } from '@/game/economy/ItemShop';
import type { QualifiedItem } from '@/content/PackRegistry';

const item = (id: string, cost: number, stats: QualifiedItem['stats']): QualifiedItem => ({
  id: `ref:${id}`,
  packId: 'ref',
  name: id,
  icon: 'item_boots',
  cost,
  stats,
});

/**
 * A shop wide enough that a valuation has somewhere to go wrong, priced on the
 * scale the shipped packs actually use — one stat, one component, ~300 gold.
 * Inventing a shelf where one item is quietly three times better than the rest
 * would make every case below a test of the fixture.
 */
const SWORD = item('sword', 300, { attackDamage: 6 });
const BOW = item('bow', 300, { attackSpeed: 0.25 });
const ARMOR = item('armor', 300, { armor: 18 });
const ROD = item('rod', 300, { abilityPower: 0.35 });
const BELT = item('belt', 300, { maxHealth: 25 });
const BOOTS = item('boots', 300, { speed: 0.35 });
const SHELF = [SWORD, BOW, ARMOR, ROD, BELT, BOOTS];

const HOST = { fountains: [{ teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 }] };

const body = (over: Partial<BotBody> = {}): BotBody => ({
  attackDamage: 14,
  attackSpeed: 1.1,
  onHitDamage: 0,
  critChance: 0,
  critDamage: 1.75,
  abilityPower: 0,
  abilityHaste: 0,
  omnivamp: 0,
  lifesteal: 0,
  spellVamp: 0,
  maxHealth: 100,
  armor: 0,
  magicResist: 0,
  speed: 3,
  ...over,
});

describe('what a body is worth', () => {
  it('rises with either half and with neither alone', () => {
    const base = combatValue(body());
    expect(combatValue(body({ attackDamage: 28 }))).toBeGreaterThan(base);
    expect(combatValue(body({ maxHealth: 200 }))).toBeGreaterThan(base);
    // A pure glass cannon and a pure wall are worth *something*, and the wall
    // is not worth zero for having no items — a bot that valued only offence
    // would sell its own health if it could.
    expect(combatValue(body({ attackDamage: 0, attackSpeed: 0 }))).toBeGreaterThan(0);
  });

  it('makes the fifth damage item worth less than the first health one', () => {
    // The reason offence and survival multiply rather than add. Under a sum,
    // a bot buys damage until the shop is empty; under a product the marginal
    // damage item is measured against the survival it is not buying.
    const lean = body();
    const stacked = body({ attackDamage: 14 + 4 * 40 });

    const damageGainWhenLean = combatValue(body({ attackDamage: 14 + 40 })) - combatValue(lean);
    const damageGainWhenStacked =
      combatValue(body({ attackDamage: 14 + 5 * 40 })) - combatValue(stacked);
    const healthGainWhenStacked =
      combatValue(body({ attackDamage: 14 + 4 * 40, maxHealth: 200 })) - combatValue(stacked);

    // Diminishing on its own terms...
    expect(damageGainWhenStacked / combatValue(stacked)).toBeLessThan(
      damageGainWhenLean / combatValue(lean)
    );
    // ...and overtaken by the other half.
    expect(healthGainWhenStacked).toBeGreaterThan(damageGainWhenStacked);
  });

  it('never pays for a stat past the ceiling the engine enforces', () => {
    // `Stat` clamps haste at `MAX_ABILITY_HASTE`, so a valuation that did not
    // would have a bot keep paying for points the engine throws away. The
    // fraction this replaced made the same mistake worse: past its cap
    // `1 / (1 - r)` goes negative, so a bot could decide that capped cooldowns
    // were worth *less* than none.
    const atCap = combatValue(body({ abilityHaste: MAX_ABILITY_HASTE }));
    expect(combatValue(body({ abilityHaste: MAX_ABILITY_HASTE * 2 }))).toBe(atCap);
    expect(atCap).toBeGreaterThan(combatValue(body()));
  });
});

describe('what a bot picks off the shelf', () => {
  let game: TestGame;
  let champion: Champion;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
  });
  afterEach(() => vi.unstubAllGlobals());

  const pick = () => nextBotPurchase(champion, HOST, { catalog: SHELF });

  /** A sheet, written the way a pack's `ChampionAttack`/`ChampionDefence` is. */
  const sheet = (damage: number, attacksPerSecond: number, health: number) => {
    champion.stats.attackDamage.baseValue = damage;
    champion.stats.attackSpeed.baseValue = attacksPerSecond;
    champion.stats.maxHealth.baseValue = health;
  };

  /**
   * The claim these two cases make together, and the only one worth making:
   * the *same shelf* is ranked differently by two sheets, with nobody
   * classifying either champion. There is no archetype in the shopper, so the
   * test cannot ask for one — it asks whether the ranking moved.
   */
  it('wants attack speed more than ability power on a body that swings hard', () => {
    sheet(60, 1.6, 300); // a built marksman
    expect(itemValueFor(champion, BOW)).toBeGreaterThan(itemValueFor(champion, ROD));
  });

  it('and the other way round on a body that barely swings at all', () => {
    // `BOT_ABILITY_BASELINE_DPS` is the same constant for both champions, which
    // is exactly why it flips: it is a far larger *share* of this one's output.
    sheet(5, 0.7, 135); // a mage
    expect(BOT_ABILITY_BASELINE_DPS).toBeGreaterThan(0);
    expect(itemValueFor(champion, ROD)).toBeGreaterThan(itemValueFor(champion, BOW));
    expect(itemValueFor(champion, ROD)).toBeGreaterThan(itemValueFor(champion, SWORD));
  });

  /**
   * The kit, hung on the champion the way `replaceSpells` leaves one: real
   * instances are a pack's business, and everything read here is structural.
   */
  const holdKit = (...descriptions: string[]) => {
    champion.spells = descriptions.map(
      description => ({ description, damageScalesWithAbilityPower: true }) as never
    );
  };

  it('buys the stat that scales the kit it is actually holding', () => {
    // The whole point, at the level a player sees. **One sheet and one
    // shelf**, so the kit is the only thing that differs between the two
    // halves — the existing cases above flip the ranking by changing the
    // *body*, and this one changes nothing but what the champion casts.
    //
    // The sheet is the file's own mage: a body that barely swings, so the
    // ability term is a large enough share of its output for a power stat to
    // be able to win at all. A physical kit on it is the deliberately odd
    // half, and it is the half that used to be broken.
    sheet(5, 0.7, 135);

    holdKit(
      '<span class="damage physical">30 sát thương</span>',
      '<span class="damage physical">20 sát thương</span>'
    );
    // Exactly zero, not merely less: `abilityMultiplier('PHYSICAL', …)` never
    // reads ability power, so a rod does nothing whatsoever for this kit. It
    // used to read as a multiplier on all of it.
    expect(itemValueFor(champion, ROD)).toBe(0);
    expect(itemValueFor(champion, SWORD)).toBeGreaterThan(0);
    expect(pick()).toBe(SWORD);

    holdKit(
      '<span class="damage magic">30 sát thương</span>',
      '<span class="damage magic">20 sát thương</span>'
    );
    expect(itemValueFor(champion, ROD)).toBeGreaterThan(itemValueFor(champion, SWORD));
    expect(pick()).toBe(ROD);
  });

  it('turns to durability once it has enough damage', () => {
    // Damage against durability on two bodies with the same health and very
    // different offence — the product's whole purpose, measured.
    sheet(14, 1.1, 300);
    const lean = itemValueFor(champion, BELT) / itemValueFor(champion, SWORD);
    sheet(300, 2, 300);
    const stacked = itemValueFor(champion, BELT) / itemValueFor(champion, SWORD);

    expect(stacked).toBeGreaterThan(lean);
  });

  it('does not buy the same item twice', () => {
    sheet(60, 1.6, 300);
    const first = pick()!;
    grantItem(champion, first);
    expect(pick()?.id).not.toBe(first.id);
  });

  it('will pay for movement, which nothing else in the formula values', () => {
    // Boots grant `speed` and nothing else. Without the mobility term they are
    // worth exactly zero to every bot forever, which is the single most
    // visible thing a shopping bot fails to do.
    expect(itemValueFor(champion, BOOTS)).toBeGreaterThan(0);
  });

  it('refuses a combine that would leave it worse off', () => {
    // The parts come off before the whole goes on. Valued the naive way — the
    // finished item's stats added to a body that still holds its components —
    // this reads as a gain and the bot pays 400 gold to lose 20 armour.
    const cloth = item('cloth', 300, { armor: 30 });
    const downgrade: QualifiedItem = {
      ...item('downgrade', 700, { armor: 40 }),
      buildsFrom: ['ref:cloth', 'ref:cloth'],
    };
    grantItem(champion, cloth);
    grantItem(champion, cloth);

    expect(itemValueFor(champion, downgrade)).toBeLessThan(0);
    expect(nextBotPurchase(champion, HOST, { catalog: [downgrade] })).toBeNull();
  });
});

describe('what a kit says it scales on', () => {
  /** A kit, written the way a pack writes one: a class per ability. */
  const kit = (...descriptions: string[]) =>
    descriptions.map(description => ({ description, damageScalesWithAbilityPower: true }));

  it('reads a physical kit as physical and a magic one as magic', () => {
    expect(kitAbilityMix({ spells: kit('<span class="damage physical">22 sát thương</span>') }))
      .toEqual({ physical: 1, magic: 0, trueDamage: 0, coverage: 1 });
    expect(kitAbilityMix({ spells: kit('<span class="damage magic">22 sát thương</span>') }))
      .toEqual({ physical: 0, magic: 1, trueDamage: 0, coverage: 1 });
  });

  it('counts an untyped span and a heal as magic, the way the engine does', () => {
    // Both are what `amplifiedDamageText` and `takeHeal` already do with them:
    // the default type is MAGIC, and a restored number has nothing to read off
    // attack damage. A pack that never labelled a type therefore keeps exactly
    // the valuation it had before this existed.
    expect(kitAbilityMix({ spells: kit('<span class="damage">22</span>') }).magic).toBe(1);
    expect(kitAbilityMix({ spells: kit('hồi <span class="heal">40 máu</span>') }).magic).toBe(1);
  });

  it('splits one ability that deals two types, and weighs abilities not spans', () => {
    // An execute: magic until it beheads, true when it does.
    const split = kitAbilityMix({
      spells: kit('<span class="damage magic">45</span> hoặc <span class="damage true">45</span>'),
    });
    expect(split.magic).toBeCloseTo(0.5);
    expect(split.trueDamage).toBeCloseTo(0.5);

    // And a damage-over-time that writes its tick *and* its total is still one
    // ability, not two — otherwise prose style outvotes the kit.
    const perTick = kitAbilityMix({
      spells: kit(
        '<span class="damage physical">3</span> mỗi nhịp (tổng <span class="damage physical">30</span>)',
        '<span class="damage magic">40</span>'
      ),
    });
    expect(perTick.physical).toBeCloseTo(0.5);
    expect(perTick.magic).toBeCloseTo(0.5);
  });

  it('reports how much of the kit anything amplifies at all', () => {
    // A dash, a stun and a shield-less taunt are abilities no power stat moves.
    const support = kitAbilityMix({
      spells: kit(
        '<span class="damage magic">30</span>',
        '<span class="buff">choáng 1 giây</span>',
        '<span class="buff">lướt 300</span>',
        '<span class="buff">khiêu khích</span>'
      ),
    });
    expect(support.coverage).toBeCloseTo(0.25);
    expect(support.magic).toBe(1);
  });

  it('ignores the basic attack and a held item, through the flag they opt out with', () => {
    // `damageScalesWithAbilityPower` is the same gate `effectiveDescription`
    // asks, so neither has to be recognised by name here.
    const mix = kitAbilityMix({
      spells: [
        { description: '<span class="damage physical">14</span>', damageScalesWithAbilityPower: false },
        { description: '<span class="damage magic">30</span>', damageScalesWithAbilityPower: true },
      ],
    });
    expect(mix).toEqual({ physical: 0, magic: 1, trueDamage: 0, coverage: 1 });
  });

  it('falls back to the old valuation for a champion with no kit to read', () => {
    // Not to a zeroed mix: "nothing to go on" must not become "scales with
    // nothing", or a bot would refuse ability power for a pack that tags none.
    expect(kitAbilityMix({})).toEqual(DEFAULT_ABILITY_MIX);
    expect(kitAbilityMix({ spells: [] })).toEqual(DEFAULT_ABILITY_MIX);
  });
});

describe('a build bought for the kit that is holding it', () => {
  const withMix = (over: Partial<BotBody>) =>
    body({ attackDamage: 20, baseAttackDamage: 20, attackSpeed: 1.1, ...over });

  const PHYSICAL = { physical: 1, magic: 0, trueDamage: 0, coverage: 1 };
  const MAGIC = { physical: 0, magic: 1, trueDamage: 0, coverage: 1 };

  it('pays a physical kit in attack damage and a magic one in ability power', () => {
    // The bug, as one case. Both bodies are identical but for the kit they
    // hold, and the same two items are worth opposite amounts to them.
    const physicalGainsFromAd =
      combatValue(withMix({ abilityMix: PHYSICAL, attackDamage: 60 })) -
      combatValue(withMix({ abilityMix: PHYSICAL }));
    const physicalGainsFromAp =
      combatValue(withMix({ abilityMix: PHYSICAL, abilityPower: 1 })) -
      combatValue(withMix({ abilityMix: PHYSICAL }));
    expect(physicalGainsFromAd).toBeGreaterThan(physicalGainsFromAp);

    const magicGainsFromAp =
      combatValue(withMix({ abilityMix: MAGIC, abilityPower: 1 })) -
      combatValue(withMix({ abilityMix: MAGIC }));
    expect(magicGainsFromAp).toBeGreaterThan(physicalGainsFromAp);
  });

  it('gives a physical kit nothing at all for ability power beyond its autos', () => {
    // `abilityMultiplier('PHYSICAL', …)` never reads `abilityPower`, so a rod
    // must move a pure-physical kit's ability term by exactly zero. Before
    // this, it multiplied the whole kit.
    const flat = withMix({ abilityMix: PHYSICAL });
    const withRod = withMix({ abilityMix: PHYSICAL, abilityPower: 2 });
    expect(combatValue(withRod)).toBe(combatValue(flat));
  });

  it('dilutes a power stat across a kit that is mostly control', () => {
    const carry = withMix({ abilityMix: MAGIC });
    const support = withMix({ abilityMix: { ...MAGIC, coverage: 0.25 } });
    const gain = (b: BotBody) =>
      combatValue({ ...b, abilityPower: 1 }) - combatValue(b);
    expect(gain(support)).toBeLessThan(gain(carry));
    // But still positive — a quarter of a kit is not none of it.
    expect(gain(support)).toBeGreaterThan(0);
  });

  it('still values haste for a kit nothing amplifies', () => {
    // A stun on a shorter cooldown is worth something even though no stat
    // makes it bigger, which is why haste sits outside the amplification.
    const control = withMix({ abilityMix: { physical: 0, magic: 1, trueDamage: 0, coverage: 0 } });
    expect(combatValue({ ...control, abilityHaste: 40 })).toBeGreaterThan(combatValue(control));
  });

  it('values a body that names no kit exactly as it did before kits were read', () => {
    // The additive guarantee. `DEFAULT_ABILITY_MIX` is all-magic, full
    // coverage — the hardcoded `1 + abilityPower` this replaced.
    const plain = body({ abilityPower: 1.5 });
    expect(combatValue(plain)).toBe(combatValue({ ...plain, abilityMix: DEFAULT_ABILITY_MIX }));
  });
});

describe('a bag that is full and wrong', () => {
  let game: TestGame;
  let champion: Champion;

  /** Six distinct swords, so a full bag is a full *attack* build. */
  const SWORDS = Array.from({ length: 6 }, (_, i) =>
    item(`sword${i}`, 300, { attackDamage: 6 })
  );
  const BIG_ROD = item('big_rod', 300, { abilityPower: 1.2 });
  const SHELF_WITH_ROD = [...SWORDS, BIG_ROD];

  const fillBag = () => {
    for (const sword of SWORDS) expect(grantItem(champion, sword)).toBe(true);
  };

  const holdKit = (...descriptions: string[]) => {
    champion.spells = descriptions.map(
      description => ({ description, damageScalesWithAbilityPower: true }) as never
    );
  };

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    champion.stats.attackDamage.baseValue = 5;
    champion.stats.attackSpeed.baseValue = 0.7;
    champion.stats.maxHealth.baseValue = 135;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sells one of six to buy the stat its new kit actually scales on', () => {
    // The reported case, end to end. A bot finishes an attack build, dies, and
    // `respawn()` re-rolls it into a caster **without emptying the bag** — so
    // it is a mage holding six swords, with the gold to fix it and, until now,
    // no way to: every candidate is refused `NO_SLOT` and `nextBotPurchase`
    // answers `null` for the rest of the match.
    fillBag();
    holdKit('<span class="damage magic">40 sát thương</span>');
    champion.wallet!.earn(10_000);

    expect(nextBotPurchase(champion, HOST, { catalog: SHELF_WITH_ROD })).toBeNull();

    const swap = bestBotSwap(champion, HOST, { catalog: SHELF_WITH_ROD });
    expect(swap?.buy).toBe(BIG_ROD);
    expect(SWORDS).toContain(swap?.sell);
  });

  it('goes through with it on a real tick, and the bag stays full', () => {
    fillBag();
    holdKit('<span class="damage magic">40 sát thương</span>');
    champion.wallet!.earn(10_000);

    expect(botShopTick(champion, HOST, { catalog: SHELF_WITH_ROD })).toBe(BIG_ROD);

    const bag = (champion.items ?? []).filter(Boolean);
    expect(bag).toHaveLength(6);
    expect(bag.map(held => held!.def.id)).toContain('ref:big_rod');
  });

  it('leaves a build that already fits alone', () => {
    // The same six swords on the kit they were bought for. Swapping one for a
    // rod would be a downgrade, and paying the refund to do it twice as much
    // of one — so the margin has to refuse it.
    fillBag();
    holdKit('<span class="damage physical">40 sát thương</span>');
    champion.wallet!.earn(10_000);

    expect(bestBotSwap(champion, HOST, { catalog: SHELF_WITH_ROD })).toBeNull();
  });

  it('will not sell for something it still cannot afford', () => {
    // The refund is 70% of 300, so 210 in an empty wallet does not buy a
    // 300-gold rod. A bot that sold anyway would be down a slot and the
    // difference, which is worse than the wrong build it started with.
    fillBag();
    holdKit('<span class="damage magic">40 sát thương</span>');
    // `grantItem` is the cheat door and charges nothing, so the bag is full
    // and the starting purse is untouched — spend it down to the broke case
    // this is actually about.
    champion.wallet!.spend(champion.wallet!.balance);
    expect(champion.wallet!.balance).toBeLessThan(300);

    expect(bestBotSwap(champion, HOST, { catalog: SHELF_WITH_ROD })).toBeNull();
  });

  it('does not swap back on the next tick', () => {
    // `BOT_SWAP_MARGIN` is what makes each swap one-way: nothing can raise
    // `combatValue` by a tenth in both directions, so two builds cannot
    // oscillate and burn 30% of the bag's value every two seconds.
    fillBag();
    holdKit('<span class="damage magic">40 sát thương</span>');
    champion.wallet!.earn(10_000);

    expect(botShopTick(champion, HOST, { catalog: SHELF_WITH_ROD })).toBe(BIG_ROD);
    const afterFirst = (champion.items ?? []).map(held => held?.def.id ?? null);

    botShopTick(champion, HOST, { catalog: SHELF_WITH_ROD });
    botShopTick(champion, HOST, { catalog: SHELF_WITH_ROD });

    // The rod is still there and nothing sold it back for a sword.
    expect((champion.items ?? []).map(held => held?.def.id ?? null)).toEqual(afterFirst);
  });
});

describe('the rules a bot plays by', () => {
  let game: TestGame;
  let champion: Champion;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cannot buy out in the lane, the same as anybody else', () => {
    champion.position.set(5_000, 0);
    expect(botShopTick(champion, HOST, { catalog: SHELF })).toBeNull();
    expect(champion.items?.[0]).toBeFalsy();
  });

  it('shops from the grave, because that rule is the shop’s too', () => {
    champion.position.set(5_000, 0);
    champion.takeDamage(99_999, new Champion({ game, teamId: 'red' }));
    expect(champion.isDead).toBe(true);

    expect(botShopTick(champion, HOST, { catalog: SHELF })).not.toBeNull();
  });

  it('never overdraws, and stops when the gold runs out', () => {
    const before = champion.wallet!.balance;
    let bought = 0;
    while (botShopTick(champion, HOST, { catalog: SHELF })) bought++;

    expect(bought).toBeGreaterThan(0);
    expect(champion.wallet!.balance).toBeGreaterThanOrEqual(0);
    expect(champion.wallet!.balance).toBeLessThan(before);
  });

  it('buys one thing per tick, not a whole build in a frame', () => {
    champion.wallet!.earn(10_000);
    botShopTick(champion, HOST, { catalog: SHELF });
    expect((champion.items ?? []).filter(Boolean)).toHaveLength(1);
  });

  it('stops when the bag is full rather than filling it with nothing', () => {
    champion.wallet!.earn(10_000);
    for (let i = 0; i < 8; i++) botShopTick(champion, HOST, { catalog: SHELF });

    const filled = (champion.items ?? []).filter(Boolean).length;
    expect(filled).toBe(Math.min(SHELF.length, champion.items!.length));
  });

  it('reads the body it actually has, buffs and items included', () => {
    // `bodyOf` is off `stats.*.value`, not off a preset, so a bot re-measures
    // against what the last purchase gave it — which is the whole reason a
    // tick buys one item.
    const before = bodyOf(champion).armor;
    grantItem(champion, ARMOR);
    expect(bodyOf(champion).armor).toBeGreaterThan(before);
  });
});

describe('difficulty', () => {
  let game: TestGame;
  let champion: Champion;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    champion = new Champion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(champion);
    indexObjects(game, [champion]);
    champion.stats.attackDamage.baseValue = 60;
    champion.stats.attackSpeed.baseValue = 1.6;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('buys the same best item every time when nobody asked for noise', () => {
    const first = nextBotPurchase(champion, HOST, { catalog: SHELF })?.id;
    expect(first).toBeDefined();
    for (let i = 0; i < 20; i++) {
      expect(nextBotPurchase(champion, HOST, { catalog: SHELF })?.id).toBe(first);
    }
  });

  it('gives an easy bot a build a good one would not have', () => {
    // The same `DifficultyProfile.noise` column `BotBrain.scoreSpell` uses,
    // applied the same symmetric way — so a tier's shopping and its casting
    // are graded by one number instead of two.
    const chosen = new Set<string>();
    let seed = 0;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 60; i++) {
      const def = nextBotPurchase(champion, HOST, { catalog: SHELF, difficulty: 'easy', rng });
      if (def) chosen.add(def.id);
    }

    expect(chosen.size).toBeGreaterThan(1);
  });
});

/**
 * The wiring, separately from the valuation.
 *
 * Everything above drives `botShopTick` directly, which is the right way to
 * test a decision and says nothing at all about whether a bot in a match ever
 * *reaches* it. That plumbing is three lines in `AIChampion.update` and every
 * one of them is a way for the feature to be silently absent: a cooldown that
 * never reaches zero, a host read that answers no fountains, a call that is
 * simply not there — which is precisely the state this file was written to
 * end, since the shop had two callers for its whole life and neither was a bot.
 *
 * `@/game/economy/itemCatalog` is mocked rather than a pack installed, because
 * the question is "does the bot get to the catalogue", not "what is in it".
 */
vi.mock('@/game/economy/itemCatalog', () => ({
  shopItems: () => [
    {
      id: 'ref:mocked',
      packId: 'ref',
      name: 'Mocked',
      icon: 'item_boots',
      cost: 300,
      stats: { attackDamage: 6 },
    },
  ],
  shopSpellIds: () => [],
  shopIconKeys: () => [],
}));

describe('a bot in a match', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reaches the shop from its own update, standing on its own fountain', async () => {
    const { default: AIChampion } = await import('@/game/gameObject/attackableUnits/AIChampion');
    const bot = new AIChampion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    (game as unknown as { fountains: unknown[] }).fountains = [
      { teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 },
    ];

    // Through `update`, not through `updateShopping`: the whole failure mode
    // this case exists for is a shopping tick nothing calls, and a test that
    // calls it itself cannot see that. The cooldown is zeroed rather than
    // waited out because its starting value is jittered on purpose — a test
    // that ticked until it elapsed would be waiting on a random number.
    bot._shopCooldown = 0;
    bot.update();

    expect(bot.items?.[0]?.def?.id).toBe('ref:mocked');
  });

  it('does not shop at all with "Tự mua đồ" switched off', async () => {
    // The Đội tab's fourth toggle (`AIChampion._autoBuy`), checked through
    // `update` for the same reason the case above is: the gate is in
    // `updateShopping`, and a test that called `updateShopping` directly would
    // still pass if the gate were moved somewhere `update` never reaches.
    const { default: AIChampion } = await import('@/game/gameObject/attackableUnits/AIChampion');
    const bot = new AIChampion({ game, position: createVector(0, 0), teamId: 'blue' });
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    (game as unknown as { fountains: unknown[] }).fountains = [
      { teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 },
    ];

    bot._autoBuy = false;
    bot._shopCooldown = 0;
    bot.update();
    expect((bot.items ?? []).filter(Boolean)).toHaveLength(0);

    // And back on again, from the same standing position — otherwise this
    // passes for a bot that could not have bought anything anyway.
    bot._autoBuy = true;
    bot._shopCooldown = 0;
    bot.update();
    expect(bot.items?.[0]?.def?.id).toBe('ref:mocked');
  });

  it('does not shop away from its platform, through the same path', async () => {
    const { default: AIChampion } = await import('@/game/gameObject/attackableUnits/AIChampion');
    const bot = new AIChampion({ game, position: createVector(9_000, 9_000), teamId: 'blue' });
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    (game as unknown as { fountains: unknown[] }).fountains = [
      { teamId: 'blue', position: { x: 0, y: 0 }, radius: 200 },
    ];

    bot._shopCooldown = 0;
    bot.update();

    expect((bot.items ?? []).filter(Boolean)).toHaveLength(0);
  });
});
