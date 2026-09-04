import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIChampion, {
  type ChampionPresetFactory,
} from '../../../src/game/gameObject/attackableUnits/AIChampion';
import {
  DEFAULT_CHAMPION_ATTACK,
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import Spell from '../../../src/game/gameObject/Spell';
import type { AssetKey } from '../../../src/managers/AssetManager';
import { buyItem } from '../../../src/game/economy/ItemShop';
import type { QualifiedItem } from '../../../src/content/PackRegistry';
import { createGame, stubGameGlobals } from '../fixtures';

class RedSpell extends Spell {
  name = 'Red';
  targetingMode = 'SELF' as const;
  coolDown = 1000;
}
class BlueSpell extends Spell {
  name = 'Blue';
  targetingMode = 'SELF' as const;
  coolDown = 2000;
}

const RED: ChampionPresetData = {
  name: 'Red',
  spells: [RedSpell],
  attack: { damage: 11, attacksPerSecond: 1.1, range: 111 },
};
const BLUE: ChampionPresetData = {
  name: 'Blue',
  spells: [BlueSpell],
  attack: { damage: 22, attacksPerSecond: 2.2, range: 222 },
};

/**
 * `ChampionPresetFactory` declares an `avatar`, but these fixtures deliberately
 * have none: an avatar means an `AssetManager.get` on a key the manifest does
 * not carry, and this suite is about the name, the kit and the attack stats.
 */
const rollsTo =
  (preset: ChampionPresetData): ChampionPresetFactory =>
  () =>
    preset as ChampionPresetData & { avatar: AssetKey };

const makeBot = (presetFactory?: ChampionPresetFactory) => {
  const game = createGame();
  const bot = new AIChampion({ game, position: createVector(0, 0), preset: RED, presetFactory });
  game.setPlayer(bot);
  return bot;
};

describe('AIChampion.respawn with a new preset', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('restores the whole champion, not just its avatar and spells', () => {
    const bot = makeBot(rollsTo(BLUE));

    bot.respawn();

    expect(bot.spells.map(s => s.name)).toEqual(['Blue']);
    // The bug: these three and the name used to keep Red's values forever.
    expect(bot.name).toBe('Blue');
    expect(bot.stats.attackDamage.baseValue).toBe(22);
    expect(bot.stats.attackSpeed.baseValue).toBe(2.2);
    expect(bot.stats.attackRange.baseValue).toBe(222);
  });

  it('keeps the current champion when respawn rolls are switched off', () => {
    const bot = makeBot(rollsTo(BLUE));

    bot.setRespawnRollsNewPreset(false);
    bot.respawn();

    expect(bot.name).toBe('Red');
    expect(bot.spells.map(s => s.name)).toEqual(['Red']);
    expect(bot.stats.attackDamage.baseValue).toBe(11);
  });

  it('keeps the current champion when the owner switches re-rolling off', () => {
    // The Đội tab's "Tự đổi tướng khi chết". Same outcome as the pinned case
    // above and a different field on purpose — see `_autoReroll`.
    const bot = makeBot(rollsTo(BLUE));

    bot._autoReroll = false;
    bot.respawn();

    expect(bot.name).toBe('Red');
    expect(bot.spells.map(s => s.name)).toEqual(['Red']);
  });

  it('rolls from whatever setPresetFactory was last handed', () => {
    const bot = makeBot(rollsTo(BLUE));

    bot.setPresetFactory(rollsTo(RED));
    bot.respawn();

    expect(bot.name).toBe('Red');
    expect(bot.spells.map(s => s.name)).toEqual(['Red']);
  });

  it("still refills health, which is super.respawn()'s job", () => {
    const bot = makeBot(rollsTo(RED));
    bot.stats.health.baseValue = 1;

    bot.respawn();

    expect(bot.stats.health.baseValue).toBe(bot.stats.maxHealth.value);
    expect(DEFAULT_CHAMPION_ATTACK.damage).toBeGreaterThan(0);
  });
});

/**
 * What happens to the bag when the champion under it is replaced.
 *
 * The bag survives a re-roll — `respawn()` has never emptied it — so a bot
 * wakes up holding a build for a champion it is no longer playing. The only
 * thing that could fix that was `bestBotSwap`, one slot at a time at
 * `SELL_REFUND_FRACTION`, which meant every death cost 30% of whatever it was
 * carrying. Reported from a real match: the more the bot died, the more it
 * sold and re-bought, the poorer and weaker it got.
 *
 * These cases are about the wiring — who is asked, and when. What the rebuild
 * itself does with the gold is pinned in `ai/BotShopper.test.ts`.
 */
describe('AIChampion.respawn and the bag it wakes up with', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const BLADE: QualifiedItem = {
    id: 'ref:blade',
    packId: 'ref',
    name: 'blade',
    icon: 'item_boots',
    cost: 300,
    stats: { attackDamage: 6 },
  };

  /**
   * A bot standing on a platform it can trade at. `createGame` has no
   * fountains at all, and the rebuild asks the same location question a
   * purchase does, so without one this would pass for the wrong reason.
   */
  const shoppingBot = (presetFactory: ChampionPresetFactory) => {
    const bot = makeBot(presetFactory);
    (bot.game as unknown as { fountains: unknown[] }).fountains = [
      { teamId: bot.teamId, position: { x: 0, y: 0 }, radius: 200 },
    ];
    bot.wallet?.earn(10_000);
    expect(buyItem(bot, BLADE, { fountains: [] }, 'CHEAT')).toBe(true);
    return bot;
  };

  const bagOf = (bot: AIChampion) => (bot.items ?? []).filter(Boolean);
  /** What the bag would cost at the counter, which is what was paid for it. */
  const bagWorth = (bot: AIChampion) =>
    bagOf(bot).reduce((total, held) => total + (held!.def?.cost ?? 0), 0);

  it('hands a build back at cost when the champion changes', () => {
    const bot = shoppingBot(rollsTo(BLUE));
    const purse = bot.wallet!.balance;

    bot.respawn();

    // Gold plus goods, across the swap: the blade came back whole at 300, not
    // at the 210 a sale pays, and whatever the new champion bought with it was
    // bought at the shop's own prices.
    expect(bot.wallet!.balance + bagWorth(bot)).toBe(purse + BLADE.cost);
    // And the old build is not in the bag any more — `ref:blade` is this
    // file's own item and is on nobody's shelf, so nothing could re-buy it.
    expect(bagOf(bot).map(held => held!.def.id)).not.toContain(BLADE.id);
  });

  it('leaves the bag alone when the roll lands on the same champion', () => {
    // Handing a still-correct build back and buying it again would be free and
    // would still be churn — and the rebuild is a catalogue scan per purchase.
    const bot = shoppingBot(rollsTo(RED));
    const purse = bot.wallet!.balance;

    bot.respawn();

    expect(bagOf(bot)).toHaveLength(1);
    expect(bot.wallet!.balance).toBe(purse);
  });

  it('leaves the bag alone for an owner who froze it', () => {
    // "Tự mua đồ" off means leave this bag where I put it, and a re-roll must
    // not be the one thing that overrules that.
    const bot = shoppingBot(rollsTo(BLUE));
    bot._autoBuy = false;
    const purse = bot.wallet!.balance;

    bot.respawn();

    expect(bot.name).toBe('Blue');
    expect(bagOf(bot)).toHaveLength(1);
    expect(bot.wallet!.balance).toBe(purse);
  });
});
