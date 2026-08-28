import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { provingGroundsGeometry } from '../../packs/reference/provingGroundsGeometry';

/**
 * `Geom.union` — the editor's "gộp polygon" command, tested as pure geometry.
 *
 * The command exists because a map that reaches the editor from a pack has no
 * `authoring` block: what it carries is `terrain`, and that is the *cut* form —
 * `TerrainField` and `Vision` are only correct on convex polygons, so a wall
 * deeper than it is wide ships as several convex boxes butted together.
 * Summoner's Rift is 329 of them for 74 actual walls. Editing that is editing
 * the decomposition rather than the map.
 *
 * The union is exact rather than tolerant, and that is a property of the data
 * rather than an assumption: every coordinate in the maps this runs on is an
 * integer, and the cut pieces share their interior edges vertex for vertex. So
 * an interior edge is one traversed by two pieces in opposite directions, and
 * cancelling those pairs leaves precisely the outline. No epsilon, no snapping
 * grid, nothing that could quietly weld two walls that merely pass close.
 *
 * These run the *real* `geom.js` in a `vm`, the same way `localMaps.test.ts`
 * runs the real editor: nothing in core can import that file, and no type
 * checker will ever compare the two halves.
 */

const EDITOR = resolve(__dirname, '../../public/map-editor');

type Point = [number, number];
type Ring = Point[];

interface EditorGeom {
  union(polys: Ring[]): Ring[];
  decompose(polygon: Ring): Ring[];
  area(pts: Ring): number;
  /** Positive for a counter-clockwise ring, negative for a clockwise one. */
  signedArea(pts: Ring): number;
}

/** The real `geom.js`, with the one global its decomposition helper expects. */
function loadGeom(): EditorGeom {
  const sandbox: Record<string, unknown> = { console, JSON, Math };
  sandbox.window = sandbox; // the bundled poly-decomp is a UMD build
  const context = vm.createContext(sandbox);
  for (const lib of ['lib/decomp.min.js', 'lib/polygon-clipping.min.js']) {
    vm.runInContext(readFileSync(resolve(EDITOR, lib), 'utf8'), context);
  }
  vm.runInContext(readFileSync(resolve(EDITOR, 'js/geom.js'), 'utf8'), context);
  // `geom.js` declares `const Geom`, and a top-level `const` is not a property
  // of the context's global the way a `var` would be — so hand it over
  // explicitly rather than reaching into the sandbox for a name that is not
  // there. In the browser the file's siblings see it as a script-scope global.
  return vm.runInContext('Geom', context) as EditorGeom;
}

const Geom = loadGeom();

/** A ring's corners as a set, so a comparison does not depend on where it starts. */
const corners = (ring: Ring): string[] => ring.map(p => p.join(',')).sort();

const square = (x: number, y: number, w: number, h = w): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** A concave 'C' — the shape `decompose` has to cut, and `union` to rebuild. */
const CONCAVE_C: Ring = [
  [0, 0],
  [600, 0],
  [600, 150],
  [150, 150],
  [150, 450],
  [600, 450],
  [600, 600],
  [0, 600],
];

describe('Geom.union', () => {
  it('welds two squares that share an edge into one rectangle', () => {
    const merged = Geom.union([square(0, 0, 100), square(100, 0, 100)]);

    expect(merged).toHaveLength(1);
    expect(corners(merged[0])).toEqual(['0,0', '0,100', '200,0', '200,100']);
  });

  it('leaves squares that only pass close to each other alone', () => {
    const merged = Geom.union([square(0, 0, 100), square(101, 0, 100)]);

    expect(merged).toHaveLength(2);
  });

  it('rebuilds a concave shape from the convex pieces it was cut into', () => {
    const pieces = Geom.decompose(CONCAVE_C);
    expect(pieces.length).toBeGreaterThan(1);

    const merged = Geom.union(pieces);

    expect(merged).toHaveLength(1);
    expect(corners(merged[0])).toEqual(corners(CONCAVE_C));
  });

  it('keeps the total area exactly, so nothing is lost or double-counted', () => {
    const pieces = Geom.decompose(CONCAVE_C);
    const before = pieces.reduce((sum, p) => sum + Math.abs(Geom.area(p)), 0);

    const after = Geom.union(pieces).reduce((sum, p) => sum + Geom.signedArea(p), 0);

    expect(after).toBe(before);
  });

  it('reports a courtyard as a second ring wound the other way', () => {
    // Four walls around an empty middle: the union has an outline and a hole,
    // and the hole must be distinguishable or the editor would fill it in.
    const merged = Geom.union([
      square(0, 0, 300, 100),
      square(0, 200, 300, 100),
      square(0, 100, 100),
      square(200, 100, 100),
    ]);

    const outer = merged.filter(r => Geom.signedArea(r) > 0);
    const holes = merged.filter(r => Geom.signedArea(r) < 0);
    expect(outer).toHaveLength(1);
    expect(holes).toHaveLength(1);
    expect(corners(holes[0])).toEqual(['100,100', '100,200', '200,100', '200,200']);
  });

  it('merges a real map to its true covered area', () => {
    // Proving Grounds is the topology that broke the hand-written union this
    // replaced: a boundary band around all four edges, plus a corridor wall
    // across the middle that **overlaps** it by 60x100 at each end. Edge
    // cancellation assumes disjoint pieces, and against overlap it produced a
    // diagonal slash across the map.
    //
    // The expected number is worked out by hand rather than measured from the
    // result: the twelve pieces sum to 851,840, and the only overlaps are
    // those two 60x100 rectangles, counted twice in that sum. A check that
    // computes its expectation by calling the thing it checks agrees with
    // itself however wrong it is.
    const walls = provingGroundsGeometry.terrain.wall.map(
      poly => poly.map(p => [p.x, p.y]) as Ring
    );
    const summed = walls.reduce((sum, p) => sum + Geom.area(p), 0);
    expect(summed).toBe(851_840);

    const merged = Geom.union(walls);

    expect(merged.reduce((sum, r) => sum + Geom.signedArea(r), 0)).toBe(851_840 - 2 * 60 * 100);
    expect(Geom.unionCovers(walls, merged)).toBe(true);
  });

  it('vouches for an answer that is right', () => {
    const pieces = Geom.decompose(CONCAVE_C);

    expect(Geom.unionCovers(pieces, Geom.union(pieces))).toBe(true);
  });

  it('splits two branches that meet at a single vertex into two rings', () => {
    // A pinch point: sharing one corner is not sharing an edge, so nothing
    // cancels and the two squares stay two outlines rather than becoming one
    // self-intersecting figure of eight.
    const merged = Geom.union([square(0, 0, 100), square(100, 100, 100)]);

    expect(merged).toHaveLength(2);
  });
});
