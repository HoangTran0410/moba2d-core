import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, {
  MONSTER_IDLE_REGEN_SECONDS,
  MONSTER_LEASH_REGEN_SECONDS,
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

/**
 * And how fast it heals once it *is* healing — the other half of the same
 * report, arriving from a real match a long time after the hold landed.
 *
 * The hold above answers "when does a camp start forgetting a fight". These
 * answer "how long does forgetting take", and the old answer was **one
 * second**: the rate was written as a per-frame amount (`health / 60`) because
 * `Stats.update` adds `healthRegen` to the pool once per frame with no
 * `deltaTime`, and sixty frames is a second. A drake that had chased somebody
 * across the river turned around and refilled a full bar between two blinks.
 *
 * The same line made the rate depend on the *monitor*: identical camps healed
 * in 0.42s at 144Hz and 2s at 30Hz. `update` scales by `deltaTime` now, which
 * is what the second case measures and what lets the first one be written in
 * seconds at all.
 */
describe('how fast a camp puts its bar back', () => {
  /** Ticks `ms` of match time at a given frame length. */
  const runAt = (camp: Monster, ms: number, frameMs: number) => {
    vi.stubGlobal('deltaTime', frameMs);
    for (let elapsed = 0; elapsed < ms; elapsed += frameMs) camp.update();
  };

  it('takes the seconds the constant says, not a fixed number of frames', () => {
    const camp = makeCamp({ temperament: 'passive' });
    const raider = new Champion({ game, teamId: 'other' });
    indexObjects(game, [camp, raider]);
    camp.takeDamage(camp.stats.maxHealth.value - 1, raider);

    // Past the hold, then one second of healing. Under the old rate this alone
    // was a full bar; under the new one it is an eighth of it.
    runAt(camp, MONSTER_REGEN_DELAY_MS + 1_000, FRAME_MS);

    const healed = camp.stats.health.value - 1;
    const expected = camp.stats.maxHealth.value / MONSTER_IDLE_REGEN_SECONDS;
    expect(healed).toBeGreaterThan(expected * 0.7);
    expect(healed).toBeLessThan(expected * 1.3);
  });

  it('heals the same amount per second whatever the frame rate is', () => {
    // Nothing about a jungle camp should be faster on a better monitor.
    const heal = (frameMs: number) => {
      const camp = makeCamp({ temperament: 'passive' });
      const raider = new Champion({ game, teamId: 'other' });
      indexObjects(game, [camp, raider]);
      camp.takeDamage(camp.stats.maxHealth.value - 1, raider);
      runAt(camp, MONSTER_REGEN_DELAY_MS + 1_000, frameMs);
      return camp.stats.health.value;
    };

    const slow = heal(32);
    const fast = heal(7);

    expect(fast).toBeGreaterThan(slow * 0.85);
    expect(fast).toBeLessThan(slow * 1.15);
  });

  it('still resets fast enough that walking away is not chip damage', () => {
    // The rule the old number existed for, and the reason these are seconds
    // rather than tens of them: a camp a player can whittle down over several
    // passes is a camp taken for free.
    expect(MONSTER_IDLE_REGEN_SECONDS).toBeLessThanOrEqual(15);
    // And the walk home is the faster of the two — a camp visibly giving up
    // should be back to full by the time it is standing on its own spot.
    expect(MONSTER_LEASH_REGEN_SECONDS).toBeLessThan(MONSTER_IDLE_REGEN_SECONDS);
  });
});
