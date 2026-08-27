import { describe, expect, it } from 'vitest';
import {
  classifyMask,
  downsampleMask,
  traceContours,
  simplifyLoop,
  loopArea,
  tracePolygons,
  scaleLoops,
  geometrySnippet,
} from '../../tools/map-tracer/trace.mjs';

/**
 * The map tracer's algorithm half (`tools/map-tracer/trace.mjs`), proved on
 * hand-built masks whose answers are computed by hand — never by the code
 * under test. The browser page (`index.html`/`main.js`) is a thin shell over
 * these functions; everything that can be wrong in a way a test can see is
 * in here.
 *
 * Coordinates: a mask cell (x, y) spans corners (x, y)-(x+1, y+1), so a
 * filled rectangle of cells x:[2,5], y:[3,5] traces to the corner rectangle
 * (2,3)-(6,6). That off-by-one is exactly the kind of thing this file exists
 * to pin.
 */

/** A w×h mask with the given cells filled. */
const maskOf = (w: number, h: number, cells: [number, number][]): Uint8Array => {
  const mask = new Uint8Array(w * h);
  for (const [x, y] of cells) mask[y * w + x] = 1;
  return mask;
};

/** Every cell of the rectangle x:[x0,x1], y:[y0,y1], inclusive. */
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
  const cells: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push([x, y]);
  return cells;
};

/** Order-independent corner comparison: same cyclic sequence, any start, either direction. */
const sameLoop = (actual: { x: number; y: number }[], expected: [number, number][]): boolean => {
  if (actual.length !== expected.length) return false;
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const doubled = [...actual, ...actual].map(key).join(';');
  const forward = expected.map(([x, y]) => `${x},${y}`).join(';');
  const backward = [...expected]
    .reverse()
    .map(([x, y]) => `${x},${y}`)
    .join(';');
  return doubled.includes(forward) || doubled.includes(backward);
};

describe('classifyMask', () => {
  it('marks pixels within tolerance of any swatch, and nothing else', () => {
    // Four pixels: pure red, dark red, pure green, near-green.
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 200, 0, 0, 255, 0, 255, 0, 255, 10, 250, 10, 255,
    ]);
    const red = classifyMask(pixels, 4, [[255, 0, 0]], 60);
    expect(Array.from(red)).toEqual([1, 1, 0, 0]);
    const green = classifyMask(pixels, 4, [[0, 255, 0]], 20);
    expect(Array.from(green)).toEqual([0, 0, 1, 1]);
    const strict = classifyMask(pixels, 4, [[255, 0, 0]], 10);
    expect(Array.from(strict)).toEqual([1, 0, 0, 0]);
  });
});

describe('downsampleMask', () => {
  it('majority-votes each k×k block', () => {
    // 4×4 mask, k=2: top-left block 3/4 filled → 1, top-right 1/4 → 0,
    // bottom-left 2/4 → 1 (ties fill), bottom-right 0/4 → 0.
    const mask = maskOf(4, 4, [
      [0, 0],
      [1, 0],
      [0, 1],
      [2, 0],
      [0, 2],
      [1, 3],
    ]);
    const down = downsampleMask(mask, 4, 4, 2);
    expect(down.w).toBe(2);
    expect(down.h).toBe(2);
    expect(Array.from(down.mask)).toEqual([1, 0, 1, 0]);
  });
});

describe('traceContours + simplifyLoop', () => {
  it('traces a filled rectangle of cells to its four corners', () => {
    const mask = maskOf(10, 10, rect(2, 3, 5, 5));
    const loops = traceContours(mask, 10, 10);
    expect(loops).toHaveLength(1);
    const corners = simplifyLoop(loops[0], 0.5);
    expect(
      sameLoop(corners, [
        [2, 3],
        [6, 3],
        [6, 6],
        [2, 6],
      ]),
      `got ${JSON.stringify(corners)}`
    ).toBe(true);
  });

  it('keeps two separate blobs as two loops', () => {
    const mask = maskOf(12, 8, [...rect(1, 1, 3, 3), ...rect(7, 4, 9, 6)]);
    expect(traceContours(mask, 12, 8)).toHaveLength(2);
  });

  it('reports area by the shoelace rule', () => {
    const mask = maskOf(10, 10, rect(2, 3, 5, 5));
    const [loop] = traceContours(mask, 10, 10);
    // 4×3 cells.
    expect(Math.abs(loopArea(loop))).toBe(12);
  });

  it('traces a ring as an outer loop and an inner hole', () => {
    // 5×5 outline, hollow 3×3 middle.
    const ringCells = rect(2, 2, 6, 6).filter(([x, y]) => x === 2 || x === 6 || y === 2 || y === 6);
    const mask = maskOf(10, 10, ringCells);
    const loops = traceContours(mask, 10, 10);
    expect(loops).toHaveLength(2);
    const areas = loops.map(loop => Math.abs(loopArea(loop))).sort((a, b) => a - b);
    expect(areas).toEqual([9, 25]);
  });
});

describe('tracePolygons', () => {
  it('drops specks under minArea and holes, keeps the outer shapes', () => {
    const ringCells = rect(2, 2, 6, 6).filter(([x, y]) => x === 2 || x === 6 || y === 2 || y === 6);
    const mask = maskOf(12, 12, [...ringCells, [10, 10]]);
    const polygons = tracePolygons(mask, 12, 12, { epsilon: 0.5, minArea: 2, dropHoles: true });
    expect(polygons).toHaveLength(1);
    expect(
      sameLoop(polygons[0], [
        [2, 2],
        [7, 2],
        [7, 7],
        [2, 7],
      ]),
      `got ${JSON.stringify(polygons[0])}`
    ).toBe(true);
  });

  it('keeps holes when asked to', () => {
    const ringCells = rect(2, 2, 6, 6).filter(([x, y]) => x === 2 || x === 6 || y === 2 || y === 6);
    const mask = maskOf(10, 10, ringCells);
    expect(
      tracePolygons(mask, 10, 10, { epsilon: 0.5, minArea: 2, dropHoles: false })
    ).toHaveLength(2);
  });
});

describe('scaleLoops + geometrySnippet', () => {
  it('scales mask coordinates into map units and rounds', () => {
    const scaled = scaleLoops([[{ x: 1, y: 2 }]], 10.4);
    expect(scaled[0][0]).toEqual({ x: 10, y: 21 });
  });

  it('renders the MapGeometry terrain literal a pack file can paste', () => {
    const snippet = geometrySnippet({
      wall: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
          { x: 0, y: 50 },
        ],
      ],
      bush: [],
      water: [],
    });
    expect(snippet).toContain('wall: [');
    expect(snippet).toContain('{ x: 100, y: 50 }');
    expect(snippet).toContain('bush: []');
    expect(snippet).toContain('water: []');
  });
});
