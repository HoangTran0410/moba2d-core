import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FogOfWar, { signedArea } from '../../../src/game/gameObject/map/FogOfWar';
import { createGame, stubGameGlobals } from '../fixtures';

/**
 * The stressed tier's fog: one nonzero-winding fill on the main canvas, the
 * viewport minus every sight polygon. What these pin — and what change would
 * turn each red:
 *
 * - the path is one rect plus one subpath per polygon and ONE fill (draw the
 *   polygons as separate fills and the count fails);
 * - every hole is wound against the rectangle whatever the sweep handed over
 *   (drop the orientation check and the mixed-orientation case fails — with
 *   nonzero, a hole wound like the rect would ADD to the fog, not cut it);
 * - the rule is nonzero, not even-odd (two overlapping holes would otherwise
 *   fog their overlap again);
 * - the soft path is untouched while nothing is stressed.
 */
type Op = { op: string; args: unknown[] };

const recorder = () => {
  const ops: Op[] = [];
  const ctx: Record<string, unknown> = { fillStyle: '' };
  for (const op of ['save', 'restore', 'beginPath', 'rect', 'moveTo', 'lineTo', 'closePath', 'fill']) {
    ctx[op] = (...args: unknown[]) => void ops.push({ op, args });
  }
  return { ops, ctx };
};

/** The subpaths after `rect`, as point lists. */
const holes = (ops: Op[]): { x: number; y: number }[][] => {
  const out: { x: number; y: number }[][] = [];
  for (const { op, args } of ops) {
    if (op === 'moveTo') out.push([{ x: args[0] as number, y: args[1] as number }]);
    else if (op === 'lineTo') out[out.length - 1].push({ x: args[0] as number, y: args[1] as number });
  }
  return out;
};

describe('FogOfWar.drawDirect', () => {
  const W = 800;
  const H = 400;
  let ops: Op[];

  beforeEach(() => {
    stubGameGlobals();
    vi.stubGlobal('width', W);
    vi.stubGlobal('height', H);
    vi.stubGlobal('windowWidth', W);
    vi.stubGlobal('windowHeight', H);
    const rec = recorder();
    ops = rec.ops;
    vi.stubGlobal('drawingContext', rec.ctx);
    vi.stubGlobal('createGraphics', () => ({
      pixelDensity: () => {},
      drawingContext: rec.ctx,
      width: W,
      height: H,
      resetMatrix() {},
      erase() {},
      noErase() {},
      noStroke() {},
      push() {},
      pop() {},
      translate() {},
      beginShape() {},
      vertex() {},
      endShape() {},
      CLOSE: 'close',
      resizeCanvas() {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const fogWith = (polys: { x: number; y: number }[][], quality = 'low') => {
    const game = createGame() as unknown as Record<string, unknown>;
    game.renderQuality = quality;
    game.renderStressed = false;
    game.camera = {
      getBoundingBox: () => ({ x: 0, y: 0, w: W, h: H }),
      worldToScreen: (x: number, y: number) => ({ x, y }),
      currentScale: 1,
    };
    const fog = new FogOfWar(game);
    fog.calculateSight = () => polys.map(sightPoly => ({ sightPoly })) as never;
    return fog;
  };

  it('cuts every polygon out of one rectangle with a single nonzero fill', () => {
    const fog = fogWith([
      [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }],
      [{ x: 300, y: 100 }, { x: 300, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 100 }],
    ]);
    fog.draw();
    expect(ops.filter(o => o.op === 'rect')).toHaveLength(1);
    expect(ops.filter(o => o.op === 'fill')).toEqual([{ op: 'fill', args: ['nonzero'] }]);
    expect(ops.filter(o => o.op === 'moveTo')).toHaveLength(2);
    expect(ops.filter(o => o.op === 'closePath')).toHaveLength(2);
  });

  it('winds every hole against the rectangle, whichever way the sweep handed it over', () => {
    const cw = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }];
    const ccw = [{ x: 300, y: 100 }, { x: 300, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 100 }];
    expect(Math.sign(signedArea(cw))).not.toBe(Math.sign(signedArea(ccw)));
    const fog = fogWith([cw, ccw]);
    fog.draw();
    const rectSign = Math.sign(
      signedArea([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }])
    );
    for (const hole of holes(ops)) {
      expect(Math.sign(signedArea(hole))).toBe(-rectSign);
    }
  });

  it('is the soft, buffered path while nothing is stressed', () => {
    const fog = fogWith([[{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]], 'auto');
    expect(fog.hardEdged()).toBe(false);
    (fog as unknown as { game: Record<string, unknown> }).game.renderStressed = true;
    expect(fog.hardEdged()).toBe(true);
    (fog as unknown as { game: Record<string, unknown> }).game.renderQuality = 'high';
    expect(fog.hardEdged()).toBe(false);
  });
});
