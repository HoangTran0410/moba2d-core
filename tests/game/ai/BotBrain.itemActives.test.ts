import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain, ITEM_SLOT } from '../../../src/game/ai/BotBrain';
import { SpellRole, ULTIMATE_SLOT, roles } from '../../../src/game/ai/SpellRole';
import type Spell from '../../../src/game/gameObject/Spell';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { LaneState } from '../../../src/game/ai/LaneObjectives';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A bot pressing the key its item brought.
 *
 * An item's active *is* a `Spell` — `game/items/Item.ts` argues that at length,
 * and it is why an item active gets press, hold-and-release and charging for
 * free. It is simply not in `Champion.spells`: it hangs off
 * `items[slot].active`, and `Game.itemInputController` resolves it live so the
 * key follows the slot when the bag is rearranged.
 *
 * Every scan in `BotBrain` read `owner.spells`, so a bot never pressed one. That
 * was invisible while bots could not shop and stopped being invisible the day
 * they could (`ai/BotShopper.ts`): a bot now spends 2400 gold on an item and,
 * before this, would stand there holding it — worse than the same item on a
 * player in *kind*, not in skill.
 */

const BLUE = 'team-blue';
const RED = 'team-red';

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 500 },
};

/**
 * The brain's whole contract with a spell is these members, so a stub carrying
 * them is a faithful stand-in — and each one needs its OWN class, because
 * `rolesOf` caches the inferred mask by constructor.
 */
const makeSpell = (aiRoles: number, over: Partial<{ castable: boolean; cost: number }> = {}) => {
  class Stub {
    static aiRoles = aiRoles;
    isCastableNow = over.castable ?? true;
    effectiveManaCost = over.cost ?? 0;
    manaCost = over.cost ?? 0;
    declaredRange: number | undefined = 500;
    castSpec = { targeting: 'DIRECTION' as const };
    press = vi.fn(() => true);
    hold = vi.fn();
    release = vi.fn();
  }
  return new Stub() as unknown as Spell & { press: ReturnType<typeof vi.fn> };
};

/** A bag holding one active in slot 2, the rest empty — the ordinary shape. */
const bagWith = (active: Spell | null) => [null, null, { active, passive: null }, null, null, null];

const view = (over: Partial<TeamView> = {}): TeamView => ({
  allies: [],
  enemies: [],
  focusTarget: null,
  rally: null,
  memory: new Map<Champion, SeenEnemy>(),
  lanes: new Map<string, LaneState>(),
  laneAssignments: new Map<Champion, string>(),
  enemyTurrets: [],
  ...over,
});

const fight = () => {
  const game: TestGame = createGame();
  const bot = new AIChampion({
    game,
    position: createVector(0, 0),
    teamId: BLUE,
    preset: PRESET,
  });
  const enemy = new Champion({ game, position: createVector(200, 0), teamId: RED, preset: PRESET });
  game.setPlayer(bot);
  indexObjects(game, [bot, enemy]);
  return { game, bot, enemy, brain: new BotBrain(bot) };
};

/** Replace the bag in place — `Champion.items` is `readonly`, its contents are not. */
const equip = (bot: AIChampion, active: Spell | null): void => {
  const slots = bagWith(active);
  for (let i = 0; i < slots.length; i++) (bot.items as unknown[])[i] = slots[i];
};

describe('a bot and the items it bought', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('presses an item active when its kit has nothing to press', () => {
    // The report, at its smallest: an empty kit, one item, an enemy in range.
    const { bot, enemy, brain } = fight();
    const active = makeSpell(roles(SpellRole.Damage));
    equip(bot, active);

    const choice = brain.chooseSpell(enemy, view());

    expect(choice?.spell).toBe(active);
    expect(choice?.slotIndex).toBe(ITEM_SLOT);
  });

  it('scores it against the kit rather than after it', () => {
    // Not a fallback: an item active competes on the same ladder every ability
    // does, so a bot holding a stronger button than its own W presses it.
    const { bot, enemy, brain } = fight();
    const poke = makeSpell(roles(SpellRole.Poke));
    const burst = makeSpell(roles(SpellRole.Burst, SpellRole.Damage));
    bot.spells[1] = poke;
    equip(bot, burst);

    expect(brain.chooseSpell(enemy, view())?.spell).toBe(burst);
  });

  it('does not treat it as an ultimate', () => {
    // `slotIndex` decides one thing — whether `rolesOf` adds `Ultimate` — and
    // an item active that inherited an ultimate's mask would be hoarded like
    // one and refused by the ghost cast for the same reason.
    const { bot, enemy, brain } = fight();
    const active = makeSpell(roles(SpellRole.Damage));
    equip(bot, active);

    const choice = brain.chooseSpell(enemy, view())!;
    expect(choice.slotIndex).not.toBe(ULTIMATE_SLOT);
    expect(choice.mask & SpellRole.Ultimate).toBe(0);
  });

  it('leaves an item on cooldown alone', () => {
    const { bot, enemy, brain } = fight();
    equip(bot, makeSpell(roles(SpellRole.Damage), { castable: false }));

    expect(brain.chooseSpell(enemy, view())).toBeNull();
  });

  it('survives a champion whose bag has not been built', () => {
    // A test double is a plain object and its `items` is `undefined` — the same
    // case `Champion.update` guards with `?? []`.
    const { bot, enemy, brain } = fight();
    (bot as unknown as { items: undefined }).items = undefined;

    expect(() => brain.chooseSpell(enemy, view())).not.toThrow();
  });

  it('keeps an item active out of wave clear', () => {
    // An ability comes back in ten seconds; an item active is bought with gold
    // and comes back in a minute. Spending one on a caster minion is a trade no
    // player makes, and the roles cannot express the difference — a pack
    // declares `aiRoles` on abilities, not on items.
    const { bot, enemy, brain } = fight();
    const active = makeSpell(roles(SpellRole.Damage, SpellRole.Zone));
    equip(bot, active);

    expect(brain.chooseSpell(enemy, view(), 'WAVE')).toBeNull();
    // …and the same spell in the kit is a fine thing to throw at a wave, so
    // this is the item-ness being refused and not the roles.
    bot.spells[1] = makeSpell(roles(SpellRole.Damage, SpellRole.Zone));
    expect(brain.chooseSpell(enemy, view(), 'WAVE')?.spell).toBe(bot.spells[1]);
  });

  it('keeps an item active out of the ghost cast', () => {
    // Throwing an area spell at a position half a second stale is a fair
    // gamble with a cooldown and not with a purchase.
    const { bot, brain } = fight();
    const active = makeSpell(roles(SpellRole.Zone));
    equip(bot, active);
    const seen = { champion: {} as Champion, at: { x: 100, y: 0 }, atMs: 0 } as SeenEnemy;

    expect(brain.chooseGhostSpell(seen, 1, { x: 100, y: 0 })).toBeNull();

    bot.spells[1] = makeSpell(roles(SpellRole.Zone));
    expect(brain.chooseGhostSpell(seen, 1, { x: 100, y: 0 })?.spell).toBe(bot.spells[1]);
  });
});
