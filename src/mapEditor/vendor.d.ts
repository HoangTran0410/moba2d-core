/**
 * The two libraries the editor page loads as plain `<script src>` tags, and
 * why they are not npm dependencies.
 *
 * Both are vendored under `public/map-editor/lib/` and served from there —
 * `decomp` cuts a concave polygon into the convex pieces the game needs (5KB),
 * `polygonClipping` does the reverse and puts them back together (28KB). They
 * stayed as script tags through the move to a Vite entry deliberately: they
 * are the one part of this page that has to keep working with no network and
 * no build, they have not changed in the life of this project, and pulling
 * them into the module graph would buy nothing but a lockfile entry.
 *
 * What the move *does* buy is this file. Under `<script>` tags these two were
 * simply undeclared identifiers that happened to exist at runtime; now they
 * are names with shapes, and a typo in one is a build failure rather than a
 * `ReferenceError` the first time somebody merges two shapes.
 */

/** `poly-decomp` — convex decomposition. Points are `[x, y]` pairs. */
declare const decomp: {
  makeCCW(polygon: number[][]): boolean;
  quickDecomp(polygon: number[][]): number[][][];
  removeCollinearPoints(polygon: number[][], thresholdAngle?: number): number;
};

/** `polygon-clipping` — boolean operations over rings of `[x, y]` pairs. */
declare const polygonClipping: {
  union(...polygons: number[][][][]): number[][][][];
  difference(...polygons: number[][][][]): number[][][][];
  intersection(...polygons: number[][][][]): number[][][][];
};
