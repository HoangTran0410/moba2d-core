import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import { createGame, stubGameGlobals } from '../fixtures';

/**
 * **The fountain gives up its widest disc when the machine is behind.**
 *
 * Profiled on a crowded board at 10x CPU throttle, `Fountain.draw` was 0.40ms
 * of a 6.0ms frame — the most expensive single body on screen — for an object
 * that stands still and cannot be attacked. The obvious fix was tried first and
 * measured **exactly neutral**: baking the whole platform into buffers came out
 * at 0.396ms against 0.398ms, because what the platform costs is fill, not
 * shape, and a blit fills the same pixels the discs did. Four large translucent
 * circles alpha-blended over each other cost what four large translucent
 * circles cost.
 *
 * So the only lever left is drawing fewer of them, and the one to drop is the
 * outermost: the widest, the faintest (alpha 26 of 255), and the one nobody is
 * studying while their frame rate is falling over.
 */

const fountainOn = (game: unknown, radius: number) =>
  new Fountain({
    game: game as never,
    preset: { name: 'Bệ Đá Cổ', x: 500, y: 500, r: radius, teamId: 'blue' } as never,
  });

describe('the fountain under a frame budget', () => {
  let spies: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    spies = stubGameGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Every diameter `circle()` was asked for this frame. */
  const diameters = () => spies.circle.mock.calls.map(call => call[2] as number);

  it('paints its full glow while the machine is keeping up', () => {
    const game = createGame();
    fountainOn(game, 150).draw();

    // The outer glow is a touch over twice the radius — it breathes around 2r.
    expect(Math.max(...diameters())).toBeGreaterThan(150 * 1.9);
  });

  it('drops the widest, faintest disc once the machine is behind', () => {
    const game = createGame() as unknown as { renderStressed: boolean };
    game.renderStressed = true;
    fountainOn(game, 150).draw();

    const widest = Math.max(...diameters());
    // The glow is gone; the platform itself, which is what the thing *is*, is
    // still there at 1.7r.
    expect(widest).toBeLessThan(150 * 1.9);
    expect(widest).toBeCloseTo(150 * 1.7, 5);
  });

  /**
   * A headless context has no renderer to be behind, and must not silently
   * lose art because it forgot to say so.
   */
  it('draws everything for a context that never mentions the frame rate', () => {
    const game = createGame() as unknown as Record<string, unknown>;
    delete game.renderStressed;
    fountainOn(game, 150).draw();

    expect(Math.max(...diameters())).toBeGreaterThan(150 * 1.9);
  });
});
