import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, { type ChampionPresetData } from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Monster, { type MonsterPresetData } from '../../../src/game/gameObject/attackableUnits/Monster';
import {
  blackboardFor,
  fightOdds,
  JUNGLER_MIN_BOTS,
  OBJECTIVE_DANGER_PX,
  OBJECTIVE_MAX_TTK_MS,
  OBJECTIVE_RISK_SHARE,
  pickObjective,
  worthFighting,
  type CampState,
} from '../../../src/game/ai/TeamBlackboard';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * The jungle half of the blackboard: camps grouped inside the one object
 * pass, the team's call to an `epic`, and the spare bot that lives in the
 * jungle. Everything here is read through `viewFor`, the way the brain reads it.
 */
const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};
const BLUE = 'team-blue';
const RED = 'team-red';
const sees = () => true;

const campPreset = (
  camp: { x: number; y: number; r: number },
  tier: 'camp' | 'epic' = 'camp',
  at: { x: number; y: number } = camp
): MonsterPresetData => ({
  name: tier === 'epic' ? 'Boss' : 'Camp',
  avatar: null,
  camp,
  home: { x: at.x, y: at.y },
  speed: 0,
  size: 40,
  attackRange: 100,
  reviveTime: 5_000,
  health: 100,
  tier,
});

const spawnBot = (game: TestGame, x: number, teamId = BLUE) =>
  new AIChampion({ game, position: createVector(x, 0), teamId, preset: PRESET, difficulty: 'normal' });
const spawnEnemy = (game: TestGame, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId: RED, preset: PRESET });

describe('camps on the blackboard', () => {
  let game: TestGame;
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('groups every body by the slot it shares, the standing apart from the fallen', () => {
    const wolves = { x: 1000, y: 1000, r: 100 };
    const pit = { x: 3000, y: 3000, r: 250 };
    const a = new Monster({ game, preset: campPreset(wolves, 'camp', { x: 980, y: 1000 }) });
    const b = new Monster({ game, preset: campPreset(wolves, 'camp', { x: 1020, y: 1000 }) });
    const boss = new Monster({ game, preset: campPreset(pit, 'epic') });
    const bot = spawnBot(game, 0);
    game.setPlayer(bot);
    indexObjects(game, [a, b, boss, bot]);
    b.die({ reviveAfter: 5_000 });

    const camps = blackboardFor(game, 0, sees).viewFor(BLUE).camps!;
    expect(camps).toHaveLength(2);
    const wolfCamp = camps.find(c => c.camp === wolves)!;
    expect(wolfCamp.total).toBe(2);
    expect(wolfCamp.alive).toEqual([a]);
    // A body still stands, so nobody is waiting on the timer.
    expect(wolfCamp.respawnInMs).toBe(0);
    expect(camps.find(c => c.camp === pit)!.tier).toBe('epic');
  });

  it('reports how long a cleared camp stays cleared', () => {
    const wolves = { x: 1000, y: 1000, r: 100 };
    const a = new Monster({ game, preset: campPreset(wolves) });
    const b = new Monster({ game, preset: campPreset(wolves) });
    const bot = spawnBot(game, 0);
    game.setPlayer(bot);
    indexObjects(game, [a, b, bot]);
    a.die({ reviveAfter: 5_000 });
    b.die({ reviveAfter: 3_000 });

    const [camp] = blackboardFor(game, 0, sees).viewFor(BLUE).camps!;
    expect(camp.alive).toEqual([]);
    expect(camp.respawnInMs).toBe(3_000);
  });

  it('calls the team to a standing epic when nobody has been seen there', () => {
    const pit = { x: 3000, y: 3000, r: 250 };
    const boss = new Monster({ game, preset: campPreset(pit, 'epic') });
    const bot = spawnBot(game, 0);
    game.setPlayer(bot);
    indexObjects(game, [boss, bot]);

    const view = blackboardFor(game, 0, sees).viewFor(BLUE);
    expect(view.objective?.monster).toBe(boss);
    expect(view.objective?.camp.camp).toBe(pit);
  });

  it('stays home when the enemies seen at the pit match the bodies fit to go', () => {
    const pit = { x: 3000, y: 3000, r: 250 };
    const boss = new Monster({ game, preset: campPreset(pit, 'epic') });
    const bot = spawnBot(game, 0);
    const lurker = spawnEnemy(game, pit.x + OBJECTIVE_DANGER_PX - 50, pit.y);
    game.setPlayer(bot);
    indexObjects(game, [boss, bot, lurker]);

    // One of us, one of them at the pit: no call.
    expect(blackboardFor(game, 0, sees).viewFor(BLUE).objective).toBeNull();

    // Two of us: the numbers are right, and the call goes out.
    const second = spawnBot(game, 100);
    indexObjects(game, [boss, bot, second, lurker]);
    const board = blackboardFor(game, 1_000, sees);
    board.refreshIfStale(game, 1_000, sees);
    expect(board.viewFor(BLUE).objective?.monster).toBe(boss);
  });

  it('never calls a hurt team, and never calls anyone to farm', () => {
    const pit = { x: 3000, y: 3000, r: 250 };
    const boss = new Monster({ game, preset: campPreset(pit, 'epic') });
    const wolves = new Monster({ game, preset: campPreset({ x: 500, y: 500, r: 100 }) });
    const bot = spawnBot(game, 0);
    bot.stats.maxHealth.baseValue = 100;
    bot.stats.health.baseValue = 30;
    game.setPlayer(bot);
    indexObjects(game, [boss, wolves, bot]);
    expect(blackboardFor(game, 0, sees).viewFor(BLUE).objective).toBeNull();

    const camps: CampState[] = [
      { camp: wolves.camp, tier: 'camp', alive: [wolves], total: 1, respawnInMs: 0 },
    ];
    const fit = spawnBot(game, 0);
    expect(pickObjective(camps, [fit], new Map(), 0)).toBeNull();
  });

  it('lượng sức mình: does not call a team that cannot finish the boss, or would be shredded', () => {
    const pit = { x: 3000, y: 3000, r: 250 };
    const bot = spawnBot(game, 0);
    game.setPlayer(bot);
    // Ten damage at one swing a second against a thousand health: a hundred
    // seconds of fighting. Nobody calls that.
    const wall = new Monster({ game, preset: { ...campPreset(pit, 'epic'), health: 1000, damage: 1 } });
    indexObjects(game, [wall, bot]);
    expect(blackboardFor(game, 0, sees).viewFor(BLUE).objective).toBeNull();
    const odds = fightOdds([bot], [wall]);
    expect(odds.ttkMs).toBeGreaterThan(OBJECTIVE_MAX_TTK_MS);

    // Killable in time, but it hits for the bot's whole pool before it falls.
    const shredder = new Monster({
      game,
      preset: { ...campPreset(pit, 'epic'), health: 100, damage: 200, attackInterval: 1000 },
    });
    const other = createGame();
    const bot2 = spawnBot(other, 0);
    other.setPlayer(bot2);
    indexObjects(other, [shredder, bot2]);
    const shredOdds = fightOdds([bot2], [shredder]);
    expect(shredOdds.ttkMs).toBeLessThanOrEqual(OBJECTIVE_MAX_TTK_MS);
    expect(shredOdds.costShare).toBeGreaterThan(OBJECTIVE_RISK_SHARE);
    expect(worthFighting(shredOdds, OBJECTIVE_MAX_TTK_MS, OBJECTIVE_RISK_SHARE)).toBe(false);

    // Items move the answer: a hundred damage a swing and the same boss is a call.
    bot.stats.attackDamage.baseValue = 100;
    const board = blackboardFor(game, 1_000, sees);
    board.refreshIfStale(game, 1_000, sees);
    expect(board.viewFor(BLUE).objective?.monster).toBe(wall);
  });

  it('spares the last bot for the jungle once a team has enough of them', () => {
    const bots = Array.from({ length: JUNGLER_MIN_BOTS }, (_, i) => spawnBot(game, i * 50));
    game.setPlayer(bots[0]);
    indexObjects(game, bots);
    const view = blackboardFor(game, 0, sees).viewFor(BLUE);
    expect(view.jungler).toBe(bots[JUNGLER_MIN_BOTS - 1]);
    expect(view.laneAssignments.has(bots[JUNGLER_MIN_BOTS - 1])).toBe(false);
    expect(view.laneAssignments.size).toBe(JUNGLER_MIN_BOTS - 1);
  });

  it('keeps three bots on three lanes with nobody in the jungle', () => {
    const bots = Array.from({ length: JUNGLER_MIN_BOTS - 1 }, (_, i) => spawnBot(game, i * 50));
    game.setPlayer(bots[0]);
    indexObjects(game, bots);
    const view = blackboardFor(game, 0, sees).viewFor(BLUE);
    expect(view.jungler).toBeNull();
    expect(view.laneAssignments.size).toBe(JUNGLER_MIN_BOTS - 1);
  });
});
