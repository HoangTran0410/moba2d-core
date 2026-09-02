import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, { type ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Monster, { type MonsterPresetData } from '../../../src/game/gameObject/attackableUnits/Monster';
import { BotBrain, CAMP_DETOUR_PX, JUNGLE_ROUTE_PX, OBJECTIVE_CALL_PX } from '../../../src/game/ai/BotBrain';
import { profileFor } from '../../../src/game/ai/Difficulty';
import type { CampState, SeenEnemy, TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { LaneState } from '../../../src/game/ai/LaneObjectives';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { driveTicks } from './botTrajectory';

/**
 * The two PvE postures. FARM sits under PUSH: a bot with nothing to push and
 * a camp in reach clears it, the jungler's reach being the whole jungle and a
 * laner's a detour. OBJECTIVE sits over PUSH: the team's call to an `epic`
 * beats a wave, but never a champion in front of the bot — every FIGHT rule
 * is above it. Both feed `findObjectiveTarget`, the one PvE seam.
 */
const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';

const campPreset = (camp: { x: number; y: number; r: number }, tier: 'camp' | 'epic' = 'camp'): MonsterPresetData => ({
  name: tier,
  avatar: null,
  camp,
  speed: 0,
  size: 40,
  attackRange: 100,
  reviveTime: 5_000,
  health: 100,
  tier,
});

const spawnBot = (game: TestGame, difficulty: 'easy' | 'normal' | 'hard' = 'normal') =>
  new AIChampion({ game, position: createVector(0, 0), teamId: BLUE, preset: PRESET, difficulty });

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

const campAt = (game: TestGame, x: number, tier: 'camp' | 'epic' = 'camp') => {
  const slot = { x, y: 0, r: 100 };
  const body = new Monster({ game, preset: campPreset(slot, tier) });
  const state: CampState = { camp: slot, tier, alive: [body], total: 1, respawnInMs: 0 };
  return { body, state };
};

describe('FARM', () => {
  let game: TestGame;
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('clears a camp within a detour when there is nothing to push', () => {
    const bot = spawnBot(game);
    // Inside the detour *and* inside the tier's aggro range, so the same tick
    // that chooses FARM also has something to swing at.
    const camp = campAt(game, 300);
    game.setPlayer(bot);
    indexObjects(game, [bot, camp.body]);
    const brain = new BotBrain(bot);
    brain.sees = () => true;

    expect(brain.evaluatePosture(view({ camps: [camp.state] }), 0)).toBe('FARM');
    expect(brain.findObjectiveTarget(view({ camps: [camp.state] }))).toBe(camp.body);
  });

  it('does not leave lane for a camp past the detour — unless it is the jungler', () => {
    const bot = spawnBot(game);
    const camp = campAt(game, CAMP_DETOUR_PX + 200);
    game.setPlayer(bot);
    indexObjects(game, [bot, camp.body]);
    const brain = new BotBrain(bot);

    expect(brain.evaluatePosture(view({ camps: [camp.state] }), 0)).toBe('ROAM');
    expect(brain.evaluatePosture(view({ camps: [camp.state], jungler: bot }), 250)).toBe('FARM');
  });

  it("stays off the far side of the map even as the jungler", () => {
    const bot = spawnBot(game);
    const camp = campAt(game, JUNGLE_ROUTE_PX + 100);
    game.setPlayer(bot);
    indexObjects(game, [bot, camp.body]);
    expect(new BotBrain(bot).evaluatePosture(view({ camps: [camp.state], jungler: bot }), 0)).toBe('ROAM');
  });

  it('never solo-farms an epic, and ignores a cleared camp', () => {
    const bot = spawnBot(game);
    const epic = campAt(game, 300, 'epic');
    const cleared = campAt(game, 300);
    game.setPlayer(bot);
    indexObjects(game, [bot, epic.body, cleared.body]);
    const emptied: CampState = { ...cleared.state, alive: [] };
    expect(new BotBrain(bot).evaluatePosture(view({ camps: [epic.state, emptied] }), 0)).toBe('ROAM');
  });

  it('is an easy bot’s blind spot, by the tier table', () => {
    expect(profileFor('easy').farmsJungle).toBe(false);
    expect(profileFor('normal').farmsJungle).toBe(true);
    expect(profileFor('hard').contestsObjectives).toBe(true);
    const bot = spawnBot(game, 'easy');
    const camp = campAt(game, 300);
    game.setPlayer(bot);
    indexObjects(game, [bot, camp.body]);
    expect(new BotBrain(bot).evaluatePosture(view({ camps: [camp.state] }), 0)).toBe('ROAM');
  });

  it('walks to the camp and does not pace at it', () => {
    const bot = spawnBot(game);
    const camp = campAt(game, CAMP_DETOUR_PX - 100);
    game.setPlayer(bot);
    indexObjects(game, [bot, camp.body]);
    const brain = new BotBrain(bot);
    brain.sees = () => true;

    const trace = driveTicks(brain, bot, view({ camps: [camp.state] }), 30);
    expect(trace.countOf('FARM')).toBe(30);
    expect(trace.nearestApproachTo(camp.state.camp)).toBeLessThan(120);
    expect(trace.reversalsAround(camp.state.camp, 5)).toBeLessThanOrEqual(1);
  });

  it('swings only once inside the tier’s aggro range', () => {
    const bot = spawnBot(game);
    const camp = campAt(game, CAMP_DETOUR_PX - 100);
    game.setPlayer(bot);
    indexObjects(game, [bot, camp.body]);
    const brain = new BotBrain(bot);
    brain.sees = () => true;
    const v = view({ camps: [camp.state] });
    brain.evaluatePosture(v, 0);
    bot.position.set(camp.state.camp.x - brain.profile.aggroRange - 50, 0);
    expect(brain.findObjectiveTarget(v)).toBeNull();
    bot.position.set(camp.state.camp.x - brain.profile.aggroRange + 50, 0);
    expect(brain.findObjectiveTarget(v)).toBe(camp.body);
  });
});

describe('OBJECTIVE', () => {
  let game: TestGame;
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('answers the team’s call from within reach, and outranks the lane', () => {
    const bot = spawnBot(game);
    const pit = campAt(game, OBJECTIVE_CALL_PX - 200, 'epic');
    game.setPlayer(bot);
    indexObjects(game, [bot, pit.body]);
    const brain = new BotBrain(bot);
    brain.sees = () => true;
    const call = { camp: pit.state, monster: pit.body };

    expect(brain.evaluatePosture(view({ camps: [pit.state], objective: call }), 0)).toBe('OBJECTIVE');
    const trace = driveTicks(brain, bot, view({ camps: [pit.state], objective: call }), 60);
    expect(trace.countOf('OBJECTIVE')).toBe(60);
    expect(trace.nearestApproachTo(pit.state.camp)).toBeLessThan(150);
  });

  it('is too far to answer past the call radius, and never answers at easy', () => {
    const far = spawnBot(game);
    const pit = campAt(game, OBJECTIVE_CALL_PX + 200, 'epic');
    game.setPlayer(far);
    indexObjects(game, [far, pit.body]);
    const call = { camp: pit.state, monster: pit.body };
    expect(new BotBrain(far).evaluatePosture(view({ objective: call }), 0)).toBe('ROAM');

    const easy = spawnBot(game, 'easy');
    easy.position.set(pit.state.camp.x - 500, 0);
    expect(new BotBrain(easy).evaluatePosture(view({ objective: call }), 0)).toBe('ROAM');
  });

  it('drops the call the moment the boss is down', () => {
    const bot = spawnBot(game);
    const pit = campAt(game, 800, 'epic');
    game.setPlayer(bot);
    indexObjects(game, [bot, pit.body]);
    const call = { camp: pit.state, monster: pit.body };
    pit.body.die({ reviveAfter: 60_000 });
    expect(new BotBrain(bot).evaluatePosture(view({ objective: call }), 0)).toBe('ROAM');
  });
});
