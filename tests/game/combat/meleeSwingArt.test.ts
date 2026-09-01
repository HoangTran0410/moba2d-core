import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { BasicAttackSwing, MELEE_WINDUP_MS } from '@/game/combat/BasicAttack';
import { MinionSwing } from '@/game/gameObject/attackableUnits/Minion';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * A champion's melee swing and a minion's are the same act, so they are the
 * same picture.
 *
 * They were two hand-written copies of one drawing — same wind-up glow, same
 * filled fan, same fade — and they had drifted where nobody would look: the
 * minion's strike carried a bright leading arc on its outer rim and the
 * champion's did not, so the same swing read as two effects depending on who
 * threw it. Reported as the melee attack art being inconsistent.
 *
 * Both go through `vfx/MeleeSwing.ts` now. This counts the calls rather than
 * inspecting a picture, which is the only thing a headless test can hold — but
 * a count is exactly what drifts when somebody edits one copy.
 *
 * A camp's claw is deliberately **not** in this family; see `monsterAttacks.ts`
 * for why three stroked arcs are its own answer.
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
afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('and the same strike, leading edge included', () => {
    const { champion, minion } = pair(MELEE_WINDUP_MS + 40);

    expect(champion).toEqual(minion);
    // Named rather than left to the equality above: the arc is the half that
    // had gone missing from one of them, and an equality that happened to be
    // `0 === 0` would report this as agreement.
    expect(champion.arcs, 'the swing has no leading edge').toBe(1);
    expect(champion.shapes).toBe(1);
  });
});
