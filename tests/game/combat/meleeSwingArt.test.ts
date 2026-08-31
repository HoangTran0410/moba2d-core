import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { BasicAttackSwing, MELEE_SWING_TOTAL_MS, MELEE_WINDUP_MS } from '@/game/combat/BasicAttack';
import { MinionSwing } from '@/game/gameObject/attackableUnits/Minion';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

/**
 * What a melee basic attack looks like, and who it says it hit.
 *
 * Three reports off one picture, all of them the same complaint in the end:
 * the swing painted **space**, and painted space in this game means an area
 * effect. First it was a filled wedge out to the attacker's full reach — read
 * as an ability hitting everyone inside it. Then a crescent sweeping through
 * that reach — which against a target standing close swung out *past* it and
 * read as damage carrying on to whatever was behind. And throughout, nothing
 * in the drawing named a victim at all: it all lived in the attacker's rotated
 * frame, so a swing at one champion in a crowd was the same picture as a swing
 * at the crowd.
 *
 * Now neither half reaches: a flick on the attacker, a crescent on the victim,
 * and nothing between them. The two assertions worth having are exactly those
 * two facts, and both are numbers a headless test can hold.
 *
 * A champion's swing and a minion's were also two hand-written copies that had
 * drifted. Both go through `vfx/MeleeSwing.ts` now, and counting calls is what
 * catches the next edit to one of them.
 *
 * A camp's claw is deliberately outside this family; see `monsterAttacks.ts`.
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

describe('the melee swing paints no space between the two bodies', () => {
  /** The widest thing drawn in the attacker's own frame, as a radius. */
  const attackerPaintRadius = () => {
    const radii = spies.arc.mock.calls
      // Attacker-frame art is drawn at the origin; the victim's crescent is
      // drawn at world coordinates and is not this question.
      .filter(call => Number(call[0]) === 0 && Number(call[1]) === 0)
      .map(call => Number(call[2]) / 2);
    const dots = spies.circle.mock.calls.map(
      call => Math.abs(Number(call[0])) + Number(call[2]) / 2
    );
    return Math.max(0, ...radii, ...dots);
  };

  /**
   * The assertion the last two attempts would each have failed. A filled wedge
   * reached `bodyRadius + reach`; the sweeping crescent reached
   * `bodyRadius + reach * 0.95`. Both cross the gap to the victim and keep
   * going, which is what "damage swept out behind them" was describing.
   */
  it('keeps the strike on the attacker, nowhere near the victim', () => {
    const attacker = new Champion({ game, teamId: 'blue' });
    const victim = new Champion({ game, teamId: 'red' });
    victim.position.set(80, 0);
    const swing = new BasicAttackSwing(attacker, victim);
    swing.reach = 90;

    // The furthest frame of the strike, where any sweep is at full extension.
    swing.age = MELEE_SWING_TOTAL_MS - 1;
    paint(() => swing.draw());

    const bodyRadius = attacker.stats.size.value / 2;
    expect(attackerPaintRadius(), 'the swing reaches out past its own body').toBeLessThanOrEqual(
      bodyRadius * 1.6
    );
    expect(attackerPaintRadius(), 'the swing reaches the victim').toBeLessThan(80);
  });

  it('and fills no wedge at all', () => {
    const { champion } = pair(MELEE_WINDUP_MS + 40);
    expect(champion.shapes, 'the swing is still a filled wedge').toBe(0);
    expect(champion.vertices).toBe(0);
  });
});

/**
 * The other half of the rule, and the reason it needs its own test.
 *
 * Bounding the reach fixed "it looks like an area effect" and immediately
 * caused "đm giờ khó thấy quá" — the swing became a thin scratch nobody could
 * find on a `background(30)` map. The two are not in tension and it matters
 * that the code says so: **weight is free, reach is not.** A stroke can be as
 * heavy and as bright as it likes without ever suggesting it hit anything else;
 * only extent does that.
 *
 * So the ceiling above has a floor down here, and a change that thins either
 * effect back into invisibility has to argue with this.
 */
describe('the melee swing is bold enough to see', () => {
  const heaviestStroke = () =>
    Math.max(0, ...spies.strokeWeight.mock.calls.map(call => Number(call[0])));

  it('strokes the flick thick relative to the body that threw it', () => {
    const attacker = new Champion({ game, teamId: 'blue' });
    const victim = new Champion({ game, teamId: 'red' });
    victim.position.set(80, 0);
    const swing = new BasicAttackSwing(attacker, victim);
    swing.reach = 90;
    swing.age = MELEE_WINDUP_MS + 10;

    paint(() => swing.draw());

    expect(heaviestStroke()).toBeGreaterThanOrEqual((attacker.stats.size.value / 2) * 0.3);
  });

  it('and the mark on the victim thicker still', () => {
    const attacker = new Champion({ game, teamId: 'blue' });
    const victim = new Champion({ game, teamId: 'red' });
    victim.position.set(80, 0);
    const swing = new BasicAttackSwing(attacker, victim);
    swing.reach = 90;
    swing.damage = 5;

    vi.stubGlobal('deltaTime', MELEE_WINDUP_MS);
    swing.update();
    vi.stubGlobal('deltaTime', 16);
    paint(() => swing.draw());

    expect(swing.landed).toBe(true);
    expect(heaviestStroke()).toBeGreaterThanOrEqual((victim.stats.size.value / 2) * 0.3);
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

  /**
   * Anything painted out where the victim is standing, rather than on the
   * attacker. Arcs and lines, because that is what the crescent is made of —
   * counted by their first coordinate, which for both is where they start.
   */
  const marksAt = (x: number) =>
    [...spies.arc.mock.calls, ...spies.line.mock.calls].filter(
      call => Math.abs(Number(call[0]) - x) < 30
    ).length;

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
