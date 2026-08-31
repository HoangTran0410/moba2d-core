import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { BasicAttackSwing, MELEE_WINDUP_MS } from '@/game/combat/BasicAttack';
import { MinionSwing } from '@/game/gameObject/attackableUnits/Minion';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * What a melee basic attack looks like, and who it says it hit.
 *
 * Two faults, both reported off the same picture. It was a filled wedge from
 * the attacker's body out to its full reach — the shape this game uses for
 * **area** effects, so a single-target basic attack read as an ability that
 * hits everything standing in it. And nothing in the drawing named a victim:
 * the whole thing lived in the attacker's rotated frame, so a swing at one
 * champion in a crowd was the same picture as a swing at the crowd.
 *
 * A champion's swing and a minion's were also two hand-written copies that had
 * drifted — one carried a bright leading edge and the other did not. Both go
 * through `vfx/MeleeSwing.ts` now.
 *
 * Counting calls is the only thing a headless test can hold, and a count is
 * exactly what drifts when somebody edits one copy. A camp's claw is
 * deliberately outside this family; see `monsterAttacks.ts`.
 */

let game: TestGame;
let spies: Record<string, ReturnType<typeof vi.fn>>;

const paint = (draw: () => void) => {
  for (const spy of Object.values(spies)) spy.mockClear();
  draw();
  return {
    vertices: spies.vertex.mock.calls.length,
    arcs: spies.arc.mock.calls.length,
    circles: spies.circle.mock.calls.length,
    shapes: spies.beginShape.mock.calls.length,
  };
};

beforeEach(() => {
  spies = stubGameGlobals();
  game = createGame();
  game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
});
afterEach(() => vi.unstubAllGlobals());

const pair = (age: number) => {
  const attacker = new Champion({ game, teamId: 'blue' });
  const victim = new Champion({ game, teamId: 'red' });
  victim.position.set(80, 0);

  const swing = new BasicAttackSwing(attacker, victim);
  swing.reach = 90;
  swing.age = age;

  const minionSwing = new MinionSwing(attacker, victim);
  minionSwing.reach = 90;
  minionSwing.age = age;

  return {
    champion: paint(() => swing.draw()),
    minion: paint(() => minionSwing.draw()),
  };
};

describe('the melee swing is one picture', () => {
  it('paints the same wind-up for a champion and a minion', () => {
    const { champion, minion } = pair(MELEE_WINDUP_MS / 2);
    expect(champion).toEqual(minion);
  });

  it('and the same strike', () => {
    const { champion, minion } = pair(MELEE_WINDUP_MS + 40);
    expect(champion).toEqual(minion);
  });
});

describe('the melee swing is a blade, not a cone', () => {
  /**
   * The wedge was `beginShape`/`vertex`/`endShape` — a filled polygon from the
   * body outwards. A crescent is two stroked arcs, a band and its leading edge,
   * and the difference is that a band has an outside. Naming both halves rather
   * than trusting the equality above: a drawing that painted nothing at all
   * would satisfy "the same as each other".
   */
  it('strokes a band and a leading edge, and fills no wedge', () => {
    const { champion } = pair(MELEE_WINDUP_MS + 40);

    expect(champion.arcs, 'the swing has no blade and no leading edge').toBe(2);
    expect(champion.shapes, 'the swing is still a filled wedge').toBe(0);
    expect(champion.vertices).toBe(0);
  });
});

describe('the melee swing says who it hit', () => {
  const landOn = (victimX: number) => {
    const attacker = new Champion({ game, teamId: 'blue' });
    const victim = new Champion({ game, teamId: 'red' });
    victim.position.set(victimX, 0);

    const swing = new BasicAttackSwing(attacker, victim);
    swing.reach = 90;
    swing.damage = 5;

    vi.stubGlobal('deltaTime', MELEE_WINDUP_MS);
    swing.update();
    vi.stubGlobal('deltaTime', 16);

    return { swing, victim, painted: paint(() => swing.draw()) };
  };

  /** Circles painted anywhere near the victim rather than on the attacker. */
  const marksAt = (x: number) =>
    spies.circle.mock.calls.filter(call => Math.abs(Number(call[0]) - x) < 30).length;

  it('marks the body that took it, out where that body is standing', () => {
    const { swing, victim } = landOn(80);

    expect(swing.landed, 'the swing never connected, so there is nothing to mark').toBe(true);
    expect(victim.stats.health.value).toBeLessThan(100);
    expect(marksAt(80), 'nothing was painted on the victim').toBeGreaterThan(0);
  });

  /**
   * A mark on a body that took nothing is the picture lying about the damage,
   * which is the one thing a hit indicator may never do.
   */
  it('and marks nothing at all when the swing whiffed', () => {
    const { swing, victim } = landOn(900);

    expect(swing.landed).toBe(false);
    expect(victim.stats.health.value).toBe(100);
    expect(marksAt(900)).toBe(0);
  });
});
