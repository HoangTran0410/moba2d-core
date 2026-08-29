import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, {
  MONSTER_REGEN_DELAY_MS,
} from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { createGame, indexObjects, stubGameGlobals, TEST_AVATAR_KEY, type TestGame } from '../fixtures';

/**
 * How fast a camp forgets a fight — two bugs that only look like one.
 *
 * Regen is applied per frame with no `deltaTime` (`Stats.update` adds
 * `healthRegen.value` straight onto `health.baseValue`), and the walking-home
 * rate is `health / 60`. A full bar in sixty frames: one second. So every
 * camp in the game reset almost instantly the moment a fight paused, and a
 * **rooted** boss was worse still — `updateAttack` used to call
 * `goBackToCamp()` the frame its target stepped outside reach, so backing off
 * for a moment was a complete heal with no leash involved at all.
 *
 * Both are pinned here, because fixing either alone leaves the report intact.
 */

const CAMP = { x: 1_000, y: 1_000, r: 300 };
const FRAME_MS = 16;

let game: TestGame;

const makeCamp = (overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: TEST_AVATAR_KEY,
      camp: { ...CAMP },
      speed: 2,
      size: 80,
      attackRange: 50,
      reviveTime: 100_000,
      health: 600,
      damage: 5,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

const framesFor = (ms: number) => Math.ceil(ms / FRAME_MS) + 1;
const run = (camp: Monster, frames: number) => {
  for (let frame = 0; frame < frames; frame += 1) camp.update();
};

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('a camp that was just hurt', () => {
  /**
   * `passive`, so the camp stays in IDLE — the phase that *does* regen.
   *
   * An aggressive camp answers a hit by entering ATTACK, where the rate is
   * already zero, so every case below would pass whether or not the hold
   * existed: the test would be asserting on state the code under test never
   * produced. Isolating the phase is what makes these about the hold.
   */
  const hurtCamp = () => makeCamp({ temperament: 'passive' });
  it('heals nothing at all while the hold is running', () => {
    const camp = hurtCamp();
    const raider = new Champion({ game, teamId: 'other' });
    indexObjects(game, [camp, raider]);
    camp.takeDamage(200, raider);
    const hurt = camp.stats.health.value;

    run(camp, framesFor(MONSTER_REGEN_DELAY_MS - 200));

    expect(camp.stats.health.value).toBe(hurt);
  });

  it('and starts healing once it is over', () => {
    const camp = hurtCamp();
    const raider = new Champion({ game, teamId: 'other' });
    indexObjects(game, [camp, raider]);
    camp.takeDamage(200, raider);
    const hurt = camp.stats.health.value;

    run(camp, framesFor(MONSTER_REGEN_DELAY_MS) + 20);

    expect(camp.stats.health.value).toBeGreaterThan(hurt);
  });

  it('starts the hold again on every blow, not only the first', () => {
    // Otherwise a long fight would have the camp healing through its second
    // half, which is the same bug wearing a timer.
    const camp = hurtCamp();
    const raider = new Champion({ game, teamId: 'other' });
    indexObjects(game, [camp, raider]);

    camp.takeDamage(200, raider);
    run(camp, framesFor(MONSTER_REGEN_DELAY_MS - 400));
    camp.takeDamage(50, raider);
    const hurt = camp.stats.health.value;
    run(camp, framesFor(MONSTER_REGEN_DELAY_MS - 400));

    expect(camp.stats.health.value).toBe(hurt);
  });

  it('lets a map turn the hold off and have the old behaviour back', () => {
    const camp = makeCamp({ regenDelayMs: 0, temperament: 'passive' });
    const raider = new Champion({ game, teamId: 'other' });
    indexObjects(game, [camp, raider]);
    camp.takeDamage(200, raider);
    const hurt = camp.stats.health.value;

    run(camp, 30);

    expect(camp.stats.health.value).toBeGreaterThan(hurt);
  });
});

describe('a rooted camp whose target steps out of reach', () => {
  /** Baron-shaped: no legs, long reach, a pit it cannot leave. */
  const makeBoss = () => makeCamp({ speed: 0, attackRange: 300, camp: { ...CAMP, r: 100 } });

  it('keeps hold of them instead of going home on the spot', () => {
    const boss = makeBoss();
    const raider = new Champion({ game, teamId: 'other' });
    raider.position.set(CAMP.x + 100, CAMP.y);
    indexObjects(game, [boss, raider]);
    boss.aggroOn(raider);

    // Out of reach, well inside the leash.
    raider.position.set(CAMP.x + 500, CAMP.y);
    boss.updateAttack();

    expect(boss.phase).toBe(Monster.PHASES.ATTACK);
    expect(boss.targetLock).toBe(raider);
  });

  it('so stepping back does not hand them a full bar', () => {
    // The report, end to end: hit a rooted boss, walk out of range, watch it
    // heal to full before you can walk back in.
    const boss = makeBoss();
    const raider = new Champion({ game, teamId: 'other' });
    raider.position.set(CAMP.x + 100, CAMP.y);
    indexObjects(game, [boss, raider]);
    boss.takeDamage(300, raider);
    const hurt = boss.stats.health.value;

    raider.position.set(CAMP.x + 500, CAMP.y);
    run(boss, 90);

    expect(boss.stats.health.value).toBe(hurt);
  });

  it('but still lets go once they are past the leash for long enough', () => {
    // The rooted camp is not a permanent grudge: the give-up timer ends the
    // fight the same way it does for a camp with legs.
    const boss = makeBoss();
    const raider = new Champion({ game, teamId: 'other' });
    raider.position.set(CAMP.x + 100, CAMP.y);
    indexObjects(game, [boss, raider]);
    boss.aggroOn(raider);

    raider.position.set(CAMP.x + 20_000, CAMP.y);
    run(boss, framesFor(boss.giveUpDelayMs) + 5);

    expect(boss.phase).not.toBe(Monster.PHASES.ATTACK);
    expect(boss.targetLock).toBeNull();
  });
});
