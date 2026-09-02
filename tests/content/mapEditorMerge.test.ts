import { describe, expect, it } from 'vitest';
import { Geom } from '@/mapEditor/geom';
import { installEditorVendorGlobals } from './editorVendor';
import { aramGeometry } from '../../packs/reference/aramGeometry';

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


type Point = [number, number];
type Ring = Point[];

// The two vendored libraries `Geom.decompose`/`Geom.union` reach for by bare
// name; the module itself is now an ordinary import. This whole block used to
// be a `vm` sandbox running the editor's classic scripts, because there was no
// other way to reach a file that was never a module.
installEditorVendorGlobals();

/**
 * How much of a `size`-square map the polygons cover, by sampling rather than
 * by any of the arithmetic `Geom` does.
 *
 * Deliberately the crudest possible independent answer — one point-in-polygon
 * test per cell centre, even-odd rule, no shared code with `Geom.union` and no
 * shared assumption. `referenceMap.test.ts` rasterises the same way for the
 * same reason.
 *
 * 10px cells: fine enough that the edge error is a fraction of a percent on a
 * 4000px map, coarse enough to run 160,000 samples rather than millions.
 */
const rasterisedArea = (polygons: readonly Ring[], size: number, cell = 10): number => {
  const cells = Math.floor(size / cell);
  const inside = (px: number, py: number, ring: Ring): boolean => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };

  let covered = 0;
  for (let cy = 0; cy < cells; cy++) {
    const y = (cy + 0.5) * cell;
    for (let cx = 0; cx < cells; cx++) {
      const x = (cx + 0.5) * cell;
      if (polygons.some(ring => inside(x, y, ring))) covered += 1;
    }
  }
  return covered * cell * cell;
};

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

  /**
   * A real map's whole wall layer, checked against a **rasterisation** rather
   * than against a number.
   *
   * The number was the point once: the map this used to run on was written out
   * by hand, twelve pieces summing to 851,840 with two 60x100 overlaps, and
   * that expectation was worked out on paper precisely so the check could not
   * agree with itself. A hand-drawn map has no such paper answer — and the
   * lesson survives the map only if the independent computation does. So the
   * expectation comes from a completely different algorithm: sample the map on
   * a grid, count the cells whose centre is inside any wall, and multiply by
   * the cell area. Point-in-polygon and edge cancellation share no code and no
   * assumption, which is what makes them worth comparing.
   *
   * It catches both failure directions, which is the whole job: a union that
   * loses geometry (the diagonal slash the hand-written predecessor produced)
   * comes out too small, and one that double-counts an overlap comes out too
   * big.
   *
   * The tolerance is rasterisation error along the edges — this map is mostly
   * long diagonals, and a cell straddling one is counted whole. 1% of 12
   * million square pixels is far tighter than either failure it is looking for.
   */
  it('merges a real map to its true covered area', () => {
    const walls = aramGeometry.terrain.wall.map(poly => poly.map(p => [p.x, p.y]) as Ring);
    const summed = walls.reduce((sum, p) => sum + Geom.area(p), 0);

    const merged = Geom.union(walls);
    const mergedArea = merged.reduce((sum, r) => sum + Geom.signedArea(r), 0);

    // Never more than the pieces added up: an overlap counted twice is the one
    // way this number can exceed that one.
    expect(mergedArea).toBeLessThanOrEqual(summed);
    expect(mergedArea / rasterisedArea(walls, 4_000)).toBeCloseTo(1, 2);
    expect(Geom.unionCovers(walls, merged)).toBe(true);
  });

  /**
   * And the property that map used to be the only witness to: two pieces that
   * *overlap* are counted once, not twice.
   *
   * Edge cancellation assumes disjoint pieces — an interior edge is one two
   * pieces traverse in opposite directions — and against a genuine overlap the
   * hand-written union this replaced produced a diagonal slash across the map.
   * The reference map's own walls no longer overlap anywhere (its pieces tile),
   * so this is written out rather than borrowed from it. Small and synthetic on
   * purpose: an arithmetic answer nobody has to trust a rasteriser for.
   */
  it('counts an overlap once rather than twice', () => {
    const band: Ring = [
      [0, 0],
      [400, 0],
      [400, 100],
      [0, 100],
    ];
    // Crosses the band's right-hand end, sharing a 100x100 square with it.
    const across: Ring = [
      [300, 0],
      [400, 0],
      [400, 300],
      [300, 300],
    ];

    const merged = Geom.union([band, across]);
    const mergedArea = merged.reduce((sum, r) => sum + Geom.signedArea(r), 0);

    expect(Geom.area(band) + Geom.area(across)).toBe(400 * 100 + 100 * 300);
    expect(mergedArea).toBe(400 * 100 + 100 * 300 - 100 * 100);
    expect(Geom.unionCovers([band, across], merged)).toBe(true);
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
