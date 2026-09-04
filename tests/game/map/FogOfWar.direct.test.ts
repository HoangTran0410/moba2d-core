import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FogOfWar, {
  clipPolygonToCircle,
  signedArea,
  SIGHT_CIRCLE_SEGMENTS,
} from '../../../src/game/gameObject/map/FogOfWar';
import { createGame, stubGameGlobals } from '../fixtures';

/**
 * The stressed tier's fog: the viewport minus the union of every sight
 * polygon, painted on the main canvas with no buffer under it.
 *
 * The bug these were rewritten for: this path used to build ONE path — the
 * viewport rectangle plus every hole wound the other way — and fill it
 * `nonzero`, on the argument that the rule leaves the union of the holes
 * clear however many overlap. A winding number is arithmetic, not a union:
 * two overlapping holes score `+1 - 1 - 1 = -1`, which is not zero, so the
 * overlap was **painted fogged**. On a phone (the only tier that runs this
 * path) that is a hard-edged dark wedge wherever two allies could both see —
 * a champion beside its own turret, anything near the fountain — which is how
 * it was reported: "draw chồng lên nhau rồi cắt nhau chỗ sáng chỗ tối".
 *
 * So the cases below are about the *region*, not the call sequence: they
 * replay the recorded clips through a winding-number evaluator and ask which
 * points end up fogged. `paintsOverlap` states the old construction's answer
 * beside the new one, so the bug cannot come back quietly.
 */
type Op = { op: string; args: unknown[] };
type Pt = { x: number; y: number };

const recorder = () => {
  const ops: Op[] = [];
  const ctx: Record<string, unknown> = { fillStyle: '' };
  for (const op of [
    'save',
    'restore',
    'beginPath',
    'rect',
    'moveTo',
    'lineTo',
    'closePath',
    'clip',
    'fill',
    'fillRect',
  ]) {
    ctx[op] = (...args: unknown[]) => void ops.push({ op, args });
  }
  return { ops, ctx };
};

/** Every clip issued, as the list of closed subpaths it was built from. */
const clipPaths = (ops: Op[]): Pt[][][] => {
  const paths: Pt[][][] = [];
  let current: Pt[][] = [];
  for (const { op, args } of ops) {
    const [a, b, c, d] = args as number[];
    if (op === 'beginPath') current = [];
    else if (op === 'rect') {
      current.push([
        { x: a, y: b },
        { x: a + c, y: b },
        { x: a + c, y: b + d },
        { x: a, y: b + d },
      ]);
    } else if (op === 'moveTo') current.push([{ x: a, y: b }]);
    else if (op === 'lineTo') current[current.length - 1].push({ x: a, y: b });
    else if (op === 'clip') paths.push(current);
  }
  return paths;
};

/** The holes, i.e. every clip subpath that is not the viewport rectangle. */
const holes = (ops: Op[]): Pt[][] => clipPaths(ops).map(path => path[path.length - 1]);

const isLeft = (a: Pt, b: Pt, p: Pt) => (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);

/** Winding number of `p` about one closed subpath — what `nonzero` reads. */
const winding = (poly: Pt[], p: Pt): number => {
  let turns = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.y <= p.y) {
      if (b.y > p.y && isLeft(a, b, p) > 0) turns++;
    } else if (b.y <= p.y && isLeft(a, b, p) < 0) turns--;
  }
  return turns;
};

const inPath = (path: Pt[][], p: Pt): boolean =>
  path.reduce((sum, sub) => sum + winding(sub, p), 0) !== 0;

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

  /** A square hole of `half` a side about (cx, cy), wound the way `cw` asks. */
  const square = (cx: number, cy: number, half: number, cw = true): Pt[] => {
    const corners = [
      { x: cx - half, y: cy - half },
      { x: cx + half, y: cy - half },
      { x: cx + half, y: cy + half },
      { x: cx - half, y: cy + half },
    ];
    return cw ? corners : corners.slice().reverse();
  };

  /**
   * `radius` is deliberately far larger than the polygons in most cases: the
   * circle cut has its own case below, and a fixture that was being trimmed
   * would make every region assertion a test of the trimming.
   */
  const fogWith = (sights: { sightPoly: Pt[]; at: Pt; radius?: number }[], quality = 'low') => {
    const game = createGame() as unknown as Record<string, unknown>;
    game.renderQuality = quality;
    game.renderStressed = false;
    game.camera = {
      getBoundingBox: () => ({ x: 0, y: 0, w: W, h: H }),
      worldToScreen: (x: number, y: number) => ({ x, y }),
      currentScale: 1,
    };
    const fog = new FogOfWar(game);
    fog.calculateSight = () =>
      sights.map(({ sightPoly, at, radius = 10_000 }) => ({
        sightPoly,
        radius,
        ring: 0,
        object: { position: at },
      })) as never;
    return fog;
  };

  /** Whether the fog would be painted at `p`, given every clip that was issued. */
  const fogAt = (p: Pt): boolean => clipPaths(ops).every(path => inPath(path, p));

  describe('two allies standing together', () => {
    const A = { sightPoly: square(200, 200, 60), at: { x: 200, y: 200 } };
    const B = { sightPoly: square(300, 200, 60, false), at: { x: 300, y: 200 } };
    const OVERLAP = { x: 250, y: 200 };
    const ONLY_A = { x: 160, y: 200 };
    const NEITHER = { x: 700, y: 350 };

    it('leaves the overlap clear, which is the whole bug', () => {
      fogWith([A, B]).draw();

      expect(fogAt(OVERLAP)).toBe(false);
      expect(fogAt(ONLY_A)).toBe(false);
      expect(fogAt(NEITHER)).toBe(true);
    });

    it('is a region the old single-fill construction got wrong', () => {
      // Not a test of the fix — a statement of what it replaced, so the reason
      // for the clip stack survives the next person reading `drawDirect`.
      fogWith([A, B]).draw();
      const rect = [
        { x: 0, y: 0 },
        { x: W, y: 0 },
        { x: W, y: H },
        { x: 0, y: H },
      ];
      const oneBigPath = [rect, ...holes(ops)];

      expect(inPath(oneBigPath, OVERLAP)).toBe(true); // painted — the bug
      expect(inPath(oneBigPath, ONLY_A)).toBe(false); // and why it hid for so long
    });

    it('cuts each hole in its own clip, and paints the fog exactly once', () => {
      fogWith([A, B]).draw();

      expect(ops.filter(o => o.op === 'clip')).toEqual([
        { op: 'clip', args: ['nonzero'] },
        { op: 'clip', args: ['nonzero'] },
      ]);
      // One rectangle per clip — each is "the viewport minus this one hole",
      // which is the only shape the winding rule states correctly.
      expect(ops.filter(o => o.op === 'rect')).toHaveLength(2);
      expect(ops.filter(o => o.op === 'fillRect')).toHaveLength(1);
      expect(ops.filter(o => o.op === 'fill')).toHaveLength(0);
    });

    it('winds every hole against the rectangle, whichever way the sweep handed it over', () => {
      expect(Math.sign(signedArea(A.sightPoly))).not.toBe(Math.sign(signedArea(B.sightPoly)));
      fogWith([A, B]).draw();

      const rectSign = Math.sign(
        signedArea([
          { x: 0, y: 0 },
          { x: W, y: 0 },
          { x: W, y: H },
          { x: 0, y: H },
        ])
      );
      for (const hole of holes(ops)) expect(Math.sign(signedArea(hole))).toBe(-rectSign);
    });
  });

  it('never cuts past the radius the soft path would have faded at', () => {
    // `computeSightPoly` sweeps against a square box, so its corners sit at
    // 1.41 x radius. The soft path's gradient is transparent out there; this
    // path has no gradient and would cut the square out at full strength.
    const at = { x: 400, y: 200 };
    fogWith([{ sightPoly: square(400, 200, 100), at, radius: 100 }]).draw();

    for (const hole of holes(ops)) {
      for (const p of hole) {
        expect(Math.hypot(p.x - at.x, p.y - at.y)).toBeLessThanOrEqual(100.001);
      }
      // And it is still a disc, not the inscribed diamond a bare clamp gives.
      expect(hole.length).toBeGreaterThan(8);
    }
  });

  it('puts holes that do not touch each other in one clip', () => {
    // The grouping, and the reason the fix is not a per-revealer cost: the
    // winding rule states the viewport minus N holes correctly as long as no
    // point is inside two of them, which is the ordinary frame — revealers
    // spread down a lane. Three disjoint holes, one clip, one fill.
    const spread = [100, 350, 600].map(x => ({
      sightPoly: square(x, 200, 40),
      at: { x, y: 200 },
    }));
    fogWith(spread).draw();

    expect(ops.filter(o => o.op === 'clip')).toHaveLength(1);
    expect(ops.filter(o => o.op === 'rect')).toHaveLength(1);
    expect(ops.filter(o => o.op === 'moveTo')).toHaveLength(3);
    for (const x of [100, 350, 600]) expect(fogAt({ x, y: 200 })).toBe(false);
    expect(fogAt({ x: 225, y: 200 })).toBe(true);
  });

  it('skips a revealer with nothing on screen rather than clipping for nothing', () => {
    fogWith([
      { sightPoly: square(200, 200, 60), at: { x: 200, y: 200 } },
      { sightPoly: square(-4_000, -4_000, 60), at: { x: -4_000, y: -4_000 } },
    ]).draw();

    expect(ops.filter(o => o.op === 'clip')).toHaveLength(1);
  });

  it('paints nothing at all under the reveal-map cheat, on either tier', () => {
    // "Hiện bản đồ" used to lift the veil off the minimap and leave the screen
    // it is a map of fogged — `Game.minimapBlips` honoured it, the main view
    // had never heard of it.
    for (const quality of ['low', 'high']) {
      ops.length = 0;
      const fog = fogWith([{ sightPoly: square(200, 200, 60), at: { x: 200, y: 200 } }], quality);
      (fog as unknown as { game: Record<string, unknown> }).game.director = { revealMap: true };

      fog.draw();

      expect(ops.filter(o => o.op === 'clip')).toHaveLength(0);
      expect(ops.filter(o => o.op === 'fill')).toHaveLength(0);
      expect(ops.filter(o => o.op === 'fillRect')).toHaveLength(0);
    }
  });

  it('still paints once the cheat is switched back off', () => {
    // Read per frame, not latched: the picture has to follow the switch.
    const fog = fogWith([{ sightPoly: square(200, 200, 60), at: { x: 200, y: 200 } }]);
    const game = (fog as unknown as { game: Record<string, unknown> }).game;
    game.director = { revealMap: true };
    fog.draw();
    expect(ops.filter(o => o.op === 'fillRect')).toHaveLength(0);

    (game.director as { revealMap: boolean }).revealMap = false;
    fog.draw();
    expect(ops.filter(o => o.op === 'fillRect')).toHaveLength(1);
  });

  it('is the soft, buffered path while nothing is stressed', () => {
    const fog = fogWith([{ sightPoly: square(100, 100, 10), at: { x: 100, y: 100 } }], 'auto');
    expect(fog.hardEdged()).toBe(false);
    (fog as unknown as { game: Record<string, unknown> }).game.renderStressed = true;
    expect(fog.hardEdged()).toBe(true);
    (fog as unknown as { game: Record<string, unknown> }).game.renderQuality = 'high';
    expect(fog.hardEdged()).toBe(false);
  });
});

/**
 * The cut itself. Its whole job is that the boundary it hands back never
 * leaves the circle and never loses the part of the polygon that was inside
 * it — a wall's shadow has to survive, or the fog stops agreeing with
 * `combat/Vision.ts` about what can be seen.
 */
describe('clipPolygonToCircle', () => {
  const ring = (
    cx: number,
    cy: number,
    r: number,
    n: number,
    cw = true
  ): { x: number; y: number }[] => {
    const points = Array.from({ length: n }, (_, i) => ({
      x: cx + r * Math.cos((i * 2 * Math.PI) / n),
      y: cy + r * Math.sin((i * 2 * Math.PI) / n),
    }));
    return cw ? points : points.reverse();
  };

  it('leaves a polygon that already fits alone', () => {
    const inside = ring(0, 0, 10, 5);
    expect(clipPolygonToCircle(inside, 0, 0, 100)).toEqual(inside);
  });

  it('answers the whole disc for a polygon the circle sits inside', () => {
    const out = clipPolygonToCircle(ring(0, 0, 500, 6), 0, 0, 100);
    expect(out).toHaveLength(SIGHT_CIRCLE_SEGMENTS);
    for (const p of out) expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 6);
  });

  it('keeps every point inside, whichever way the polygon is wound', () => {
    for (const cw of [true, false]) {
      const out = clipPolygonToCircle(ring(0, 0, 300, 4, cw), 0, 0, 100);
      expect(out.length).toBeGreaterThan(8);
      for (const p of out) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(100.001);
      // The rim runs the way the polygon does, or the hole folds over itself.
      expect(Math.sign(signedArea(out))).toBe(cw ? 1 : -1);
    }
  });

  it('keeps the part of a wall shadow that was inside the circle', () => {
    // A square box with a bite taken out of one side, the way a wall leaves
    // one. The bite is well inside the circle and has to survive the cut.
    const bitten = [
      { x: -200, y: -200 },
      { x: 200, y: -200 },
      { x: 200, y: 200 },
      { x: 20, y: 200 },
      { x: 20, y: 20 },
      { x: -20, y: 20 },
      { x: -20, y: 200 },
      { x: -200, y: 200 },
    ];
    const out = clipPolygonToCircle(bitten, 0, 0, 100);

    for (const p of out) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(100.001);
    expect(out).toContainEqual({ x: 20, y: 20 });
    expect(out).toContainEqual({ x: -20, y: 20 });
  });

  it('refuses a degenerate call rather than inventing a shape', () => {
    expect(clipPolygonToCircle([{ x: 0, y: 0 }], 0, 0, 10)).toEqual([]);
    expect(clipPolygonToCircle(ring(0, 0, 10, 4), 0, 0, 0)).toEqual([]);
  });
});
