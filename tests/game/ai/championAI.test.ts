import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, { type ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { BotBrain, SCORE_DAMAGE } from '../../../src/game/ai/BotBrain';
import { championAISource, ChampionOpinion, type ChampionAI } from '../../../src/game/ai/ChampionAI';
import { SpellRole, roles } from '../../../src/game/ai/SpellRole';
import type Spell from '../../../src/game/gameObject/Spell';
import type { SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { LaneState } from '../../../src/game/ai/LaneObjectives';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * The champion-opinion layer (`ChampionAI`): four questions the brain asks a
 * pack-written champion before it decides, each answerable with `undefined`
 * for "no opinion". What these pin, and what change would turn each red:
 *
 * - no registered opinion ⇒ the brain's own answers, exactly (hook plumbing
 *   that alters a score or posture on its own would fail the fallback);
 * - an opinion replaces the answer, and `undefined` leaves it (drop the
 *   `?? posture` fallback and the `undefined` case fails);
 * - the score opinion is taken BEFORE noise (move the hook after the noise
 *   line and the noise test fails);
 * - the lookup follows `championId` when a bot re-rolls, and the notebook is
 *   emptied (cache the AI on the constructor and the respawn test fails);
 * - a throwing opinion disables itself and never reaches the brain twice.
 */
const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';
const RED = 'team-red';

const spawnBot = (game: TestGame, championId?: string) => {
  const bot = new AIChampion({
    game,
    position: createVector(0, 0),
    teamId: BLUE,
    preset: { ...PRESET, championId },
    difficulty: 'hard',
  });
  return bot;
};
const spawnEnemy = (game: TestGame, x: number) =>
  new Champion({ game, position: createVector(x, 0), teamId: RED, preset: PRESET });

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

const damageSpell = (range = 500): Spell =>
  ({
    isCastableNow: true,
    manaCost: 0,
    declaredRange: range,
    castSpec: { targeting: 'DIRECTION', activation: 'INSTANT' },
    constructor: { aiRoles: roles(SpellRole.Damage) },
  }) as unknown as Spell;

describe('ChampionAI', () => {
  let registry: Record<string, ChampionAI>;
  const originalLookup = championAISource.lookup;

  beforeEach(() => {
    stubGameGlobals();
    registry = {};
    championAISource.lookup = id => registry[id];
  });
  afterEach(() => {
    championAISource.lookup = originalLookup;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('changes nothing for a champion nobody has an opinion about', () => {
    const game = createGame();
    const plain = spawnBot(game);
    const named = spawnBot(game, 'pack:Nobody');
    const enemy = spawnEnemy(game, 200);
    game.setPlayer(plain);
    indexObjects(game, [plain, named, enemy]);
    const v = view({ enemies: [enemy] });

    const a = new BotBrain(plain);
    const b = new BotBrain(named);
    a.rng = () => 0.5;
    b.rng = () => 0.5;
    expect(a.evaluatePosture(v, 1000)).toBe(b.evaluatePosture(v, 1000));
    const mask = roles(SpellRole.Damage);
    expect(a.scoreSpell(damageSpell(), 1, mask, enemy, v)).toBe(SCORE_DAMAGE);
    expect(b.scoreSpell(damageSpell(), 1, mask, enemy, v)).toBe(SCORE_DAMAGE);
  });

  it('lets the champion replace the posture, and leaves it when it says nothing', () => {
    const game = createGame();
    const bot = spawnBot(game, 'pack:Hero');
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    const brain = new BotBrain(bot);
    let answer: 'ROAM' | 'PUSH' | undefined = 'PUSH';
    registry['pack:Hero'] = { posture: () => answer };

    expect(brain.evaluatePosture(view(), 1000)).toBe('PUSH');
    expect(brain.posture).toBe('PUSH');
    answer = undefined;
    expect(brain.evaluatePosture(view(), 1250)).toBe('ROAM');
  });

  it('takes the spell opinion before the difficulty noise, so the knob still applies', () => {
    const game = createGame();
    const bot = spawnBot(game, 'pack:Hero');
    const enemy = spawnEnemy(game, 200);
    game.setPlayer(bot);
    indexObjects(game, [bot, enemy]);
    const brain = new BotBrain(bot);
    brain.rng = () => 1; // multiplier 1 + noise
    const noise = brain.profile.noise;
    const seen: number[] = [];
    registry['pack:Hero'] = {
      scoreSpell: (_c, s) => {
        seen.push(s.baseScore);
        return 40;
      },
    };

    const score = brain.scoreSpell(damageSpell(), 1, roles(SpellRole.Damage), enemy, view({ enemies: [enemy] }));
    expect(seen).toEqual([SCORE_DAMAGE]);
    expect(score).toBeCloseTo(40 * (1 + noise), 6);
  });

  it('hands the opinion its own scratch state, and drops it when the champion changes', () => {
    const game = createGame();
    const bot = spawnBot(game, 'pack:Hero');
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    const brain = new BotBrain(bot);
    const seenIds: string[] = [];
    const states: Record<string, unknown>[] = [];
    const remember: ChampionAI = {
      posture: c => {
        states.push(c.state);
        c.state.count = ((c.state.count as number) ?? 0) + 1;
        return undefined;
      },
    };
    registry['pack:Hero'] = remember;
    registry['pack:Other'] = { posture: () => (seenIds.push('other'), undefined) };

    brain.evaluatePosture(view(), 1000);
    brain.evaluatePosture(view(), 1250);
    expect(states[0]).toBe(states[1]);
    expect(states[1].count).toBe(2);

    // The bot re-rolls into another champion: a fresh lookup, and a fresh notebook.
    bot.applyPreset({ ...PRESET, championId: 'pack:Other' });
    brain.evaluatePosture(view(), 1500);
    expect(seenIds).toEqual(['other']);
    bot.applyPreset({ ...PRESET, championId: 'pack:Hero' });
    brain.evaluatePosture(view(), 1750);
    expect(states[2]).not.toBe(states[1]);
    expect(states[2].count).toBe(1);
  });

  it('empties the notebook on a new life', () => {
    const game = createGame();
    const bot = spawnBot(game, 'pack:Hero');
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    const brain = new BotBrain(bot);
    // Keep the champion across the death: a re-roll is the *other* reason the
    // notebook empties, and is the previous test's business.
    bot.setRespawnRollsNewPreset(false);
    const states: Record<string, unknown>[] = [];
    registry['pack:Hero'] = { posture: c => (states.push(c.state), undefined) };

    brain.update(1000, 16);
    bot.die({ reviveAfter: 1000 });
    brain.update(1300, 16);
    bot.respawn();
    brain.update(1600, 16);
    expect(states).toHaveLength(2);
    expect(states[0]).not.toBe(states[1]);
  });

  it('switches a throwing opinion off after one warning, and the bot keeps playing', () => {
    const game = createGame();
    const bot = spawnBot(game, 'pack:Hero');
    game.setPlayer(bot);
    indexObjects(game, [bot]);
    const brain = new BotBrain(bot);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    registry['pack:Hero'] = {
      posture: () => {
        calls++;
        throw new Error('boom');
      },
    };

    expect(brain.evaluatePosture(view(), 1000)).toBe('ROAM');
    expect(brain.evaluatePosture(view(), 1250)).toBe('ROAM');
    expect(calls).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores an opinion that is not a usable answer', () => {
    const opinion = new ChampionOpinion(() => ({
      scoreSpell: () => Number.NaN,
      aim: () => ({ x: Number.NaN, y: 0 }),
    }));
    opinion.refresh('pack:Hero');
    const context = {} as never;
    const situation = {} as never;
    expect(opinion.scoreSpell(context, situation)).toBeUndefined();
    expect(opinion.aim(context, situation)).toBeUndefined();
    expect(opinion.active).toBe(true);
  });
});
