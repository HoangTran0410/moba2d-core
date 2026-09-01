import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import { createGame, stubGameGlobals } from '../fixtures';

/**
 * **The platform is a platform, and its edge is where the healing stops.**
 *
 * It used to be four translucent discs, a stroked ring, eight separate `arc()`
 * paths turning one way, a six-sided sigil turning the other and up to
 * twenty-six rising motes — and it profiled as the most expensive single body
 * on a crowded board. Baking all of it into buffers was tried first and
 * measured *identical* (0.396ms against 0.398ms), because what it costs is
 * fill and a blit fills the same pixels.
 *
 * So the art changed instead, and these cases hold the two halves of that
 * change apart: the widest thing on screen is no longer a disc, and the fact
 * that disc was carrying — where the fountain reaches — did not go with it.
 */

const fountainAt = (radius: number) =>
  new Fountain({
    game: createGame() as never,
    preset: { name: 'Bệ Đá Cổ', x: 500, y: 500, r: radius, teamId: 'blue' } as never,
  });

const RADIUS = 150;

describe('the fountain’s art', () => {
  let spies: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    spies = stubGameGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Every diameter `circle()` was asked for, in the order it was asked. */
  const circles = () => spies.circle.mock.calls.map(call => call[2] as number);

  it('still shows where the restoring reaches', () => {
    fountainAt(RADIUS).draw();
    // `radius` is where a body is restored; `circle` takes a diameter.
    expect(circles()).toContain(RADIUS * 2);
  });

  it('draws that reach as a rim, not as the largest fill on the map', () => {
    fountainAt(RADIUS).draw();

    const rimAt = spies.circle.mock.invocationCallOrder[circles().indexOf(RADIUS * 2)];
    const noFillAt = spies.noFill.mock.invocationCallOrder[0];
    const lastFillAt = spies.fill.mock.invocationCallOrder.at(-1)!;

    expect(noFillAt, 'the widest circle is still filled').toBeLessThan(rimAt);
    expect(lastFillAt, 'a fill was set after the rim went unfilled').toBeLessThan(noFillAt);
  });

  it('fills nothing wider than the pad itself', () => {
    fountainAt(RADIUS).draw();
    // Asserted before it is used as a cut-off: without this the filter below
    // compares against `undefined`, matches nothing, and the case passes
    // vacuously on exactly the frame where every circle is filled again.
    expect(spies.noFill).toHaveBeenCalled();

    const noFillAt = spies.noFill.mock.invocationCallOrder[0];
    const filled = circles().filter(
      (_diameter, index) => spies.circle.mock.invocationCallOrder[index] < noFillAt
    );
    expect(filled.length).toBeGreaterThan(0);
    expect(Math.max(...filled)).toBeLessThanOrEqual(RADIUS * 1.5);
  });

  /**
   * The rune ring was eight `arc()` calls. `drawShopReach` still uses arcs, but
   * only while a champion is close enough for the reach to be news — nobody is
   * near this one.
   */
  it('traces no arcs while nothing is walking home', () => {
    fountainAt(RADIUS).draw();
    expect(spies.arc).not.toHaveBeenCalled();
  });

  /**
   * Nothing turns, breathes or drifts any more, so two frames of a fountain
   * nobody is standing on must be the same picture — which is also what makes
   * the whole body skippable by anything that later wants to cache it.
   */
  it('draws the same picture on every frame', () => {
    const fountain = fountainAt(RADIUS);

    fountain.draw();
    const first = circles();
    spies.circle.mockClear();

    vi.stubGlobal('deltaTime', 250);
    for (let tick = 0; tick < 40; tick++) fountain.update();
    fountain.draw();

    expect(circles()).toEqual(first);
  });
});
