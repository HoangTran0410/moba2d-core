import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Turret, { TurretBolt } from '@/game/gameObject/structures/Turret';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import TeamId from '@/game/enums/TeamId';
import { STALLED_CHASE_MS } from '@/game/gameObject/MissileSpellObject';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A bolt has to reach as far as the thing that fired it can shoot.
 *
 * ## The report
 *
 * "t edit cho tầm bắn trụ to bằng bản đồ luôn, trụ có bắn đc, nhưng đạn của
 * trụ đi tới 1 khoảng cách lớn nào đó là tự mất". The turret acquired its
 * target and fired; the bolt vanished in mid air roughly halfway there.
 *
 * ## Why it happened, and why it was four bugs
 *
 * Every homing bolt in this engine carried a fuse — it re-aims each frame, so
 * a target faster than the bolt is otherwise a chase with no end — and every
 * one of them wrote that fuse as a *duration*: `_life = 4000` on the turret's,
 * `3000` on a champion's, `2000` on a minion's, `3000` on a camp's.
 *
 * A duration times a speed is a range. 4000ms at 13px a frame is 3120px, and
 * that number appears nowhere near `attackRange`, is not derived from it, and
 * does not move when a map tunes it. So the fuse was a second, invisible range
 * cap under the real one, and every map that raised a range past it got a
 * weapon that fires and does not arrive.
 *
 * ## And why the first fix was still the same bug
 *
 * Making the budget a *distance* — a multiple of the shot — fixed the range
 * and kept the shape: budget the shot and you have capped the **chase**. A
 * turret firing at somebody 400px away who then ran gave up 2000px into the
 * pursuit, which is the second report: "đạn vẫn biến mất sau 1 quảng dài di
 * chuyển".
 *
 * The rule these cases now pin is the one that was asked for, and it names no
 * distance at all: a bolt ends when it arrives, or when its target dies and it
 * has finished the flight to where that target last stood. It gives up only on
 * a target that is *outrunning* it — not a third rule, but the case where
 * "when it arrives" can never come.
 */

let game: TestGame;

const MAP = 6_400;

beforeEach(() => {
  stubGameGlobals();
  game = createGame(MAP);
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A turret that can see the whole map, which is the reported setup. */
const mapWideTurret = (): Turret => {
  const turret = new Turret({ game, position: createVector(0, 0), teamId: TeamId.BLUE });
  turret.attackRange = MAP;
  return turret;
};

/**
 * The bolt `fireAt` just queued. `addObject` parks new objects in
 * `_objectToBeAdd` until the manager's next tick, so reading `objects` here
 * finds nothing — the same lookup four other suites in this repo already do.
 */
const firedBolt = (turret: Turret, target: Champion): TurretBolt => {
  turret.fireAt(target);
  const bolt = game.objectManager._objectToBeAdd.find(o => o instanceof TurretBolt);
  expect(bolt, 'the turret fired nothing').toBeTruthy();
  game.objectManager._objectToBeAdd.length = 0;
  return bolt as TurretBolt;
};

/** Fly a bolt until it lands or fizzles, and say which. Never loops forever. */
const fly = (bolt: TurretBolt, maxFrames = 20_000): { frames: number; arrived: boolean } => {
  for (let frames = 1; frames <= maxFrames; frames++) {
    const wasThere = bolt.position.dist(bolt.destination);
    bolt.update();
    if (bolt.toRemove) {
      return { frames, arrived: wasThere <= bolt.speed * 2 };
    }
  }
  throw new Error('the bolt never stopped');
};

describe('a homing bolt', () => {
  it('reaches a target at the far end of a map-wide attack range', () => {
    const turret = mapWideTurret();
    const victim = new Champion({ game, teamId: TeamId.RED, position: createVector(4_000, 0) });
    indexObjects(game, [turret, victim]);
    const before = victim.stats.health.value;

    const bolt = firedBolt(turret, victim);

    const flight = fly(bolt);
    expect(flight.arrived, `bolt died ${bolt.position.dist(victim.position)}px short`).toBe(true);
    expect(victim.stats.health.value).toBeLessThan(before);
  });

  /**
   * The half the first fix got wrong, and the report that found it.
   *
   * A target running away is not a reason to give up — it is the whole of
   * what homing is for. This runner is barely slower than the bolt, so the
   * gap closes at a crawl and the pursuit covers kilometres before it can
   * possibly land: exactly the shape both fuses killed, and the shape of the
   * report. The loop stops short of the catch on purpose — what is under test
   * is that the bolt is still in the air 10km in, not that it eventually
   * hits.
   */
  it('keeps chasing a runner it is gaining on, however far that takes it', () => {
    const turret = mapWideTurret();
    const runner = new Champion({ game, teamId: TeamId.RED, position: createVector(400, 0) });
    indexObjects(game, [turret, runner]);
    const bolt = firedBolt(turret, runner);

    let flown = 0;
    for (let frame = 0; frame < 800 && !bolt.toRemove; frame++) {
      const from = bolt.position.copy();
      // 97% of the bolt's speed: it *is* being caught, just very slowly.
      runner.position.x += bolt.speed * 0.97;
      bolt.update();
      flown += from.dist(bolt.position);
    }

    expect(flown, 'the chase never got long enough to test anything').toBeGreaterThan(5_000);
    expect(bolt.toRemove, `gave up after ${Math.round(flown)}px of a chase it was winning`).toBe(
      false
    );
  });

  /**
   * The end that does the real work. Every chase in a real match finishes
   * here: the target dies, `destination` stops being updated, and the bolt
   * flies out the rest of its shot and lands on the point rather than on
   * anybody. Without this the "never gives up" rule above would be a leak.
   */
  it('finishes its flight and stops when the target dies mid-air', () => {
    const turret = mapWideTurret();
    const victim = new Champion({ game, teamId: TeamId.RED, position: createVector(3_000, 0) });
    indexObjects(game, [turret, victim]);
    const bolt = firedBolt(turret, victim);

    for (let frame = 0; frame < 30; frame++) bolt.update();
    expect(bolt.toRemove, 'it should still be in the air here').toBe(false);

    victim.stats.health.baseValue = 0;
    victim.die?.({ attacker: undefined } as never);
    expect(victim.isDead, 'the victim did not actually die').toBe(true);

    let frames = 0;
    while (!bolt.toRemove && frames < 20_000) {
      bolt.update();
      frames++;
    }
    expect(bolt.toRemove).toBe(true);
    // It landed where the victim last stood, rather than being deleted where
    // it happened to be when the death landed.
    expect(bolt.position.dist(createVector(3_000, 0))).toBeLessThan(bolt.speed * 2);
  });

  /**
   * The only case that still ends a chase, and it ends it because the chase
   * cannot be won: the target is faster than the bolt, so the gap grows every
   * frame and "when it arrives" is unreachable. `STALLED_CHASE_MS` of not
   * gaining a pixel, not a distance — a bolt 20km into a flight it is winning
   * is untouched by this.
   */
  it('gives up only on a target that is outrunning it', () => {
    const turret = mapWideTurret();
    const runner = new Champion({ game, teamId: TeamId.RED, position: createVector(600, 0) });
    indexObjects(game, [turret, runner]);
    const bolt = firedBolt(turret, runner);

    let frames = 0;
    while (!bolt.toRemove && frames < 20_000) {
      runner.position.x += bolt.speed * 1.5;
      bolt.update();
      frames++;
    }

    expect(bolt.toRemove, 'the bolt chased forever').toBe(true);
    // Three seconds of losing ground, at the 16ms `deltaTime` the fixture
    // stubs — and not one frame of the approach before it.
    expect(frames * 16).toBeGreaterThanOrEqual(STALLED_CHASE_MS);
    expect(frames * 16).toBeLessThan(STALLED_CHASE_MS * 2);
  });
});
