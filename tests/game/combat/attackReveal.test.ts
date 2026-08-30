import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { DEFAULT_ATTACK_REVEAL_MS } from '@/game/combat/AttackReveal';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * What lights a unit up, and what does not.
 *
 * `Vision.test.ts` holds the *reading* side — a revealed unit is seen out of a
 * bush and through a wall. This is the writing side, which is where the rule's
 * one real subtlety lives: League reveals for **unit-targeted** actions only,
 * so a skillshot fired out of a brush gives nothing away. That is not an
 * oversight in League — it is why firing one from brush is a thing to do — and
 * it is the half most likely to be "fixed" by somebody who reads the reported
 * bug as "attacking should reveal".
 */

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const champion = (teamId: string, x: number): Champion => {
  const unit = new Champion({ game, teamId });
  unit.position.set(x, 0);
  unit.destination.set(x, 0);
  try {
    game.player;
  } catch {
    game.setPlayer(unit);
  }
  return unit;
};

describe('what reveals an attacker', () => {
  it('starts every unit unrevealed', () => {
    expect(champion('red', 0).isRevealed).toBe(false);
  });

  /**
   * The swing, not the landing. A ranged attacker whose reveal waited for the
   * bolt to arrive would stay invisible for the whole of its flight — exactly
   * the stretch in which the victim is trying to work out where the arrow came
   * from — so `BasicAttackController.launch` is the seam, beside the
   * `ON_ATTACK` it already emits.
   */
  it('is committing to a basic attack', () => {
    const attacker = champion('red', 0);
    const victim = champion('blue', 60);
    indexObjects(game, [attacker, victim]);

    attacker.basicAttack.launch(victim, 200);

    expect(attacker.isRevealed).toBe(true);
  });

  it('lasts League’s two seconds of match time, then stops', () => {
    const attacker = champion('red', 0);
    const victim = champion('blue', 60);
    indexObjects(game, [attacker, victim]);

    attacker.basicAttack.launch(victim, 200);

    (game as unknown as { matchTimeMs: number }).matchTimeMs = DEFAULT_ATTACK_REVEAL_MS - 1;
    expect(attacker.isRevealed).toBe(true);

    (game as unknown as { matchTimeMs: number }).matchTimeMs = DEFAULT_ATTACK_REVEAL_MS + 1;
    expect(attacker.isRevealed).toBe(false);
  });

  /**
   * Being *hit* out of the fog tells you a direction, not a position, and that
   * is the whole tension of a bush. So the reveal hangs on the attacker's own
   * action and never on the victim's `takeDamage` — a victim who lit up their
   * attacker by bleeding would make brush worthless.
   */
  it('is not taking damage', () => {
    const attacker = champion('red', 0);
    const victim = champion('blue', 60);
    indexObjects(game, [attacker, victim]);

    victim.takeDamage(10, attacker, 'PHYSICAL', 'test');

    expect(victim.isRevealed, 'the victim gave nothing away by being hit').toBe(false);
  });
});

/**
 * A map's own answer to "how much is a brush worth here".
 *
 * Both ends are real maps, which is why this is configurable at all: 0 turns
 * brush into stealth you can fight out of, a long one turns a single swing into
 * a commitment. `MapTuning.vision`.
 */
describe('what a map can say about it', () => {
  const withVision = (vision: Record<string, number>) => {
    (game as unknown as { mapTuning: unknown }).mapTuning = { vision };
  };

  it('takes core’s two seconds when the map says nothing', () => {
    const attacker = champion('red', 0);
    attacker.revealForAttack();

    (game as unknown as { matchTimeMs: number }).matchTimeMs = DEFAULT_ATTACK_REVEAL_MS - 1;
    expect(attacker.isRevealed).toBe(true);
    (game as unknown as { matchTimeMs: number }).matchTimeMs = DEFAULT_ATTACK_REVEAL_MS + 1;
    expect(attacker.isRevealed).toBe(false);
  });

  it('holds the reveal as long as the map asks', () => {
    withVision({ attackRevealMs: 6_000 });
    const attacker = champion('red', 0);
    attacker.revealForAttack();

    (game as unknown as { matchTimeMs: number }).matchTimeMs = 5_000;
    expect(attacker.isRevealed).toBe(true);
  });

  /**
   * Zero is off, not "expires immediately", and the difference is worth the
   * explicit branch: a duration of 0 written as `now + 0` leaves
   * `_revealedUntilMs` equal to `matchTimeMs`, and `>` would say false — but a
   * paused match, where the clock does not move, would then hang on the exact
   * boundary. Refusing to write the field at all has no boundary.
   */
  it('never reveals at all on a map that sets it to zero', () => {
    withVision({ attackRevealMs: 0 });
    const attacker = champion('red', 0);

    attacker.revealForAttack();

    expect(attacker.isRevealed).toBe(false);
  });

  it('reads the map live, so the number is the match’s and not the object’s', () => {
    // Built before the map said anything — a value captured in the constructor
    // would be core's for the life of this unit.
    const attacker = champion('red', 0);
    withVision({ attackRevealMs: 0 });

    attacker.revealForAttack();

    expect(attacker.isRevealed).toBe(false);
  });
});

describe('the source scan that keeps the two seams honest', () => {
  const read = (path: string): string =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../..', path), 'utf8');

  /**
   * A cast reveals on a **resolved target**, never on "a spell was cast". The
   * distinction is the skillshot exemption, it is one word wide, and nothing
   * about the game visibly changes if somebody widens it — the bush simply
   * stops working and nobody knows why for a month.
   */
  it('hangs the cast reveal on a target, not on casting', () => {
    const spell = read('src/game/gameObject/Spell.ts');
    expect(spell).toContain('if (this._castContext?.target) this.owner?.revealForAttack();');
  });

  it('reveals from the attack launch, where ON_ATTACK already fires', () => {
    const controller = read('src/game/combat/BasicAttackController.ts');
    const launch = controller.slice(controller.indexOf('launch(target: AttackableUnit'));
    expect(launch.slice(0, launch.indexOf('\n  }'))).toContain('this.owner.revealForAttack()');
  });
});
