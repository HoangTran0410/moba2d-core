import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, { type MonsterPresetData } from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A camp somebody shoved.
 *
 * `updateIdle` has always walked a camp home when it ends up **outside its
 * leash circle**, which was written for a hook dragging one out of its pit.
 * The circle is the wrong test for a *displacement*: the pits this engine's
 * maps ship are 200 and 250 units wide, and a knockback throws about 260 — so
 * a body shoved from anywhere but the exact centre lands inside its own circle,
 * `isOutsideCamp()` answers false, and a camp with no `wanderSpeed` (which is
 * most of them) stands wherever it was dumped for the rest of the match. It
 * reads exactly like a broken monster: pushed out of the pit, no state change,
 * no walk back, no aggro.
 *
 * So the rule is about *what happened to it* rather than where it ended up:
 * something else moved this body, therefore it goes back to its point. Bodies
 * jostling each other in a shared pit never call `markDisplaced`, which is what
 * keeps the three wolves from shuffling home forever — the regression the
 * leash-circle comment was guarding against.
 */

const PIT = { x: 1_000, y: 1_000, r: 250 };
let game: TestGame;

const makeCamp = (overrides: Partial<MonsterPresetData> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: null,
      camp: { ...PIT },
      speed: 3,
      size: 40,
      attackRange: 50,
      reviveTime: 100,
      health: 100,
      aggroRange: 200,
      // Movable on purpose. A camp with no legs is `isImmovable` by default and
      // `update()` pins it to its point every frame — it *cannot* be stranded,
      // and a suite built on one would be asserting the wrong body's rules.
      anchored: false,
      ...overrides,
    },
  });

/** Shoves `camp` to a point, the way a knockback does — via somebody else's Dash. */
const shoveTo = (camp: Monster, x: number, y: number) => {
  const shover = new Champion({ game, teamId: 'blue' });
  const knock = new Dash(400, shover, camp);
  (knock as unknown as { dashDestination: { x: number; y: number } }).dashDestination = { x, y };
  camp.addBuff(knock);
};

const tick = (camp: Monster, frames: number) => {
  for (let f = 0; f < frames; f++) camp.update();
};

const distanceHome = (camp: Monster) =>
  Math.hypot(camp.position.x - PIT.x, camp.position.y - PIT.y);

beforeEach(() => {
  stubGameGlobals();
  vi.stubGlobal('deltaTime', 16);
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('a camp that was shoved', () => {
  it('walks back to its point even when the shove left it inside its own pit', () => {
    const camp = makeCamp();
    indexObjects(game, [camp]);

    // 160 out, in a pit whose leash circle is 250 — `isOutsideCamp()` is false
    // the whole time, which is the entire bug.
    shoveTo(camp, PIT.x + 160, PIT.y);

    // The furthest it got, not the distance at some arbitrary frame: with the
    // rule in place it is already walking back by frame 40, and a probe read
    // then would be measuring the fix rather than the shove.
    let furthest = 0;
    let everOutside = false;
    for (let f = 0; f < 40; f++) {
      camp.update();
      furthest = Math.max(furthest, distanceHome(camp));
      everOutside ||= camp.isOutsideCamp();
    }
    expect(furthest, 'the shove never moved it, so nothing below is tested').toBeGreaterThan(100);
    expect(everOutside, 'the probe left the circle, which is the case that already worked').toBe(
      false
    );

    tick(camp, 400);

    expect(distanceHome(camp)).toBeLessThanOrEqual(Math.max(20, camp.stats.size.value / 2));
  });

  it('still walks back from outside the circle, which always worked', () => {
    const camp = makeCamp();
    indexObjects(game, [camp]);

    shoveTo(camp, PIT.x + 400, PIT.y);
    tick(camp, 440);

    expect(distanceHome(camp)).toBeLessThanOrEqual(Math.max(20, camp.stats.size.value / 2));
  });

  /**
   * The rule must not reach into a fight. A camp knocked back *while chasing*
   * is being kited, not stranded — walking home from that would make a
   * knockback the way to reset any camp mid-fight, and would undo the
   * give-up leash that decides when a chase really ends (`updateAttack`).
   */
  it('does not abandon a chase because the shove marked it displaced', () => {
    const camp = makeCamp();
    const prey = new Champion({ game, teamId: 'blue' });
    prey.position.set(PIT.x + 120, PIT.y);
    indexObjects(game, [camp, prey]);

    camp.takeDamage(5, prey, 'PHYSICAL');
    expect(camp.phase).toBe('ATTACK');

    shoveTo(camp, PIT.x + 160, PIT.y);
    tick(camp, 60);

    expect(camp.phase, 'the shove sent it home mid-fight').toBe('ATTACK');
  });
});
