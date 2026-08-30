/**
 * One answer for a roster, and it has to be the roster's own answer.
 *
 * `canTeamSee(observers, target)` exists to replace
 * `observers.some(o => canSee(o, target))` in `TeamBlackboard.refreshMemory`,
 * where the pair-at-a-time form was the most expensive thing in the AI layer:
 * `canSee`'s borrowed-eye scan walks every ward, minion and turret lighting a
 * circle for the observer's **team**, runs a line-of-sight test against each,
 * and depends on nothing else about the observer. A five-champion roster ran
 * it five times for one answer, twice a second, for both teams.
 *
 * That makes this an optimisation of a *fog rule*, which is the most dangerous
 * kind of optimisation this codebase has: an answer that is wrong by one eye
 * is an enemy a bot hunts through a wall, or one it walks past in the open, and
 * nothing throws either way. So the test is not a list of cases somebody
 * thought of — it is the equivalence itself, driven over a grid of worlds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { canSee, canTeamSee, type Seeable } from '../../../src/game/combat/Vision';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Vertices = { x: number; y: number }[];

const slab = (x: number, y: number, w: number, h: number): Vertices => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const terrain = (obstacles: { type: string; vertices: Vertices }[]) => {
  (game as unknown as { terrainMap: unknown }).terrainMap = {
    getObstaclesInArea: (_area: unknown, types: string[] = []) =>
      obstacles.filter(o => !types.length || types.includes(o.type)),
  };
};

const champion = (teamId: string, x: number, y = 0, sight = 500): Champion => {
  const unit = new Champion({ game, teamId });
  unit.position.set(x, y);
  unit.destination.set(x, y);
  unit.stats.visionRadius.baseValue = sight;
  try {
    game.player;
  } catch {
    game.setPlayer(unit);
  }
  return unit;
};

/** The definition `canTeamSee` has to match, written out once. */
const pairwise = (observers: Champion[], target: Champion): boolean =>
  observers.some(o => canSee(o as unknown as Seeable, target as unknown as Seeable));

describe('canTeamSee is canSee, asked once for the whole roster', () => {
  /**
   * Every combination that changes which branch of `canSee` answers: the
   * target behind a wall or not, in a bush or not, on the observers' own team
   * or not, with or without a third ally standing somewhere that can borrow
   * sight to it. Sixteen worlds, and the assertion in each is that the two
   * functions agree — not that either says any particular thing.
   */
  it('agrees with the pairwise form across walls, bushes, teams and borrowed eyes', () => {
    for (const walled of [false, true]) {
      for (const inBush of [false, true]) {
        for (const sameTeam of [false, true]) {
          for (const withSpotter of [false, true]) {
            game = createGame();
            terrain(
              walled
                ? [{ type: 'wall', vertices: slab(200, -400, 60, 800) }]
                : inBush
                  ? [{ type: 'bush', vertices: slab(350, -80, 160, 160) }]
                  : []
            );

            const a = champion('blue', 0, 0);
            const b = champion('blue', 0, 120);
            const target = champion(sameTeam ? 'blue' : 'red', 420, 0);
            target.isInsideBush = inBush;

            // The spotter stands past the wall, next to the target — the only
            // thing that can see it when the wall is up — and is deliberately
            // **not** in the roster. That is the shape the caller has: the
            // observers are the team's champions, while the eyes are every
            // ward, minion and turret on the team as well. An eye that is also
            // an observer is covered by the own-view loop and so cannot catch
            // a scan that was dropped entirely; this one can.
            const spotter = withSpotter ? champion('blue', 400, 90) : null;
            const roster = [a, b];
            indexObjects(game, [...roster, target, ...(spotter ? [spotter] : [])]);

            const label = `walled=${walled} bush=${inBush} ally=${sameTeam} spotter=${withSpotter}`;
            expect(
              canTeamSee(roster as unknown as Seeable[], target as unknown as Seeable),
              label
            ).toBe(pairwise(roster, target));
          }
        }
      }
    }
  });

  it('agrees when the roster is empty, which is a team with nobody alive', () => {
    const target = champion('red', 100, 0);
    indexObjects(game, [target]);
    expect(canTeamSee([], target as unknown as Seeable)).toBe(pairwise([], target));
  });

  it('agrees when only one observer of several can see', () => {
    terrain([{ type: 'wall', vertices: slab(200, -60, 60, 120) }]);
    const blocked = champion('blue', 0, 0);
    const clear = champion('blue', 0, 400);
    const target = champion('red', 420, 0);
    indexObjects(game, [blocked, clear, target]);

    const roster = [blocked, clear];
    expect(canTeamSee(roster as unknown as Seeable[], target as unknown as Seeable)).toBe(
      pairwise(roster, target)
    );
  });

  /**
   * The borrowed eye, alone and load-bearing.
   *
   * Written out as its own case because the grid above can only prove the scan
   * *agrees*, and a scan that has been deleted agrees with nothing being seen.
   * Here the only thing with a view of the target is an eye nobody is asking
   * through: drop the scan and this is a target the team cannot see.
   */
  it('finds a target only a borrowed eye can see', () => {
    terrain([{ type: 'wall', vertices: slab(200, -400, 60, 800) }]);
    const asker = champion('blue', 0, 0);
    const eye = champion('blue', 400, 60);
    const target = champion('red', 420, 0);
    indexObjects(game, [asker, eye, target]);

    const roster = [asker];
    expect(pairwise(roster, target), 'the fixture no longer needs the eye at all').toBe(true);
    expect(canTeamSee(roster as unknown as Seeable[], target as unknown as Seeable)).toBe(true);
  });

  /**
   * The one that would catch the wrong hoist in the other direction. An
   * observer is itself on the eye list — champions grant sight — and
   * `canTeamSee` skips every observer during the borrowed scan on the grounds
   * that the loop above already gave each of them the *unbounded* view a
   * borrowed eye does not get. That is only sound because a borrowed eye's
   * answer is a strict subset of its own view; if the range gate were ever
   * dropped from `borrowedEyeSees`, this is what breaks.
   */
  it('does not lose an observer that was only ever visible as a borrowed eye', () => {
    const near = champion('blue', 0, 0, 0);
    const far = champion('blue', 400, 0, 500);
    const target = champion('red', 460, 0);
    indexObjects(game, [near, far, target]);

    const roster = [near, far];
    expect(canTeamSee(roster as unknown as Seeable[], target as unknown as Seeable)).toBe(
      pairwise(roster, target)
    );
  });
});
