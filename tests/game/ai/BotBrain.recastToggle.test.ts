import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, { type ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain } from '../../../src/game/ai/BotBrain';
import { SpellRole, roles } from '../../../src/game/ai/SpellRole';
import type Spell from '../../../src/game/gameObject/Spell';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const PRESET: ChampionPresetData = { name: 'T', spells: [], attack: { damage: 10, attacksPerSecond: 1, range: 100 } };
const FRAME_MS = 16;

/** A transform: press to enter, press again to leave early. */
const makeToggle = (declaresItEndsEarly: boolean) => {
  class Stub {
    static aiRoles = roles(SpellRole.Buff, SpellRole.Burst);
    static aiRecastEndsEarly = declaresItEndsEarly || undefined;
    effectiveManaCost = 100;
    manaCost = 100;
    declaredRange: number | undefined = undefined;
    state = 'READY';
    presses = 0;
    formUp = false;
    get isCastableNow() { return this.state === 'READY'; }
    castSpec = {
      activation: 'RECAST' as const,
      targeting: 'SELF' as const,
      active: { maxDurationMs: 15_000, recasts: 1 },
    };
    press = vi.fn(function (this: Stub) {
      this.presses += 1;
      if (this.formUp) { this.formUp = false; this.state = 'COOLDOWN'; }
      else { this.formUp = true; this.state = 'ACTIVE'; }
      return true;
    });
    hold = vi.fn();
    release = vi.fn();
  }
  return new Stub() as unknown as Spell & { presses: number; formUp: boolean };
};

const setup = () => {
  const game: TestGame = createGame();
  const bot = new AIChampion({ game, position: createVector(0, 0), teamId: 'blue', preset: PRESET, difficulty: 'normal' });
  const enemy = new Champion({ game, position: createVector(200, 0), teamId: 'red', preset: PRESET });
  game.setPlayer(bot);
  indexObjects(game, [bot, enemy]);
  bot.stats.mana.baseValue = 500;
  bot.stats.maxMana.baseValue = 500;
  (game as unknown as { createSpellContext: () => unknown }).createSpellContext = () => ({ cursorWorld: { x: 0, y: 0 } });
  const brain = new BotBrain(bot);
  brain.rng = () => 0.5;
  return { bot, brain };
};

const run = (brain: BotBrain, ms: number, from = 1_000): void => {
  for (let now = from, end = from + ms; now < end; now += FRAME_MS) brain.update(now, FRAME_MS);
};

/**
 * A recast that *ends* an ability, rather than completing one.
 *
 * `BotBrain.cast` schedules a follow-through for every `RECAST` activation —
 * the right thing when the recast is the payload, and exactly wrong when it
 * is the player putting a transform down. `recastDelayMs` defaults to 0, so
 * the second press landed on the next think tick.
 *
 * Reported twice from real matches, the second time after the ability had
 * already been re-tagged and re-scored: "vẫn ko thấy nó dùng R". The score
 * was never the problem the second time. The bot chose the ultimate, paid a
 * hundred chakra for it, and toggled it off one frame later — so from outside
 * the transform simply never happened.
 */
describe('a recast that ends the ability instead of finishing it', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const stats = (toggle: unknown) => toggle as { presses: number; formUp: boolean };

  it('is pressed once and left up, when the ability says the recast ends it', () => {
    const { bot, brain } = setup();
    const toggle = makeToggle(true);
    bot.replaceSpells([toggle, toggle, toggle, toggle] as unknown as Spell[]);

    run(brain, 3_000);

    expect(stats(toggle).presses).toBe(1);
    expect(stats(toggle).formUp).toBe(true);
  });

  it('still spends the recast when the ability does not say so', () => {
    // The licence is the declaration. Every recast ability that ships today
    // says nothing, and every one of them must keep its follow-through —
    // a detonation that never detonates is the opposite regression.
    const { bot, brain } = setup();
    const toggle = makeToggle(false);
    bot.replaceSpells([toggle, toggle, toggle, toggle] as unknown as Spell[]);

    run(brain, 3_000);

    expect(stats(toggle).presses).toBeGreaterThan(1);
  });
});
