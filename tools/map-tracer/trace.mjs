/**
 * The map tracer's algorithm half: image pixels → binary masks → boundary
 * loops → simplified polygons → a `MapGeometry` terrain literal.
 *
 * Pure functions over plain arrays, no DOM and no dependencies, so the same
 * module runs in the browser page beside it (`index.html` imports it as an
 * ES module) and under vitest (`tests/tools/mapTracer.test.ts`, where every
 * answer is computed by hand rather than by this code).
 *
 * ## Coordinates
 *
 * A mask cell (x, y) spans the unit square with corners (x, y)-(x+1, y+1),
 * so polygons come back in *corner* coordinates: a filled cell rectangle
 * x:[2,5], y:[3,5] traces to the polygon (2,3)-(6,6). `scaleLoops` is what
 * turns those into map units.
 *
 * ## Winding
 *
 * Boundary edges are emitted with the filled region on the *left* of the
 * walk, which makes every outer boundary wind one way and every hole wind
 * the other — `loopArea`'s sign is how `tracePolygons` tells them apart
 * without a nesting test, and what lets `bridgeHoles`' keyhole cuts read
 * correctly under the nonzero fill rule as well as the even-odd one.
 */

/**
 * One mask cell per pixel: 1 where the pixel sits within `tolerance`
 * (Euclidean RGB distance) of any swatch, 0 elsewhere. `pixels` is RGBA,
 * stride 4 — exactly what `CanvasRenderingContext2D.getImageData` hands out.
 */
export function classifyMask(pixels, count, swatches, tolerance) {
  const mask = new Uint8Array(count);
  const limit = tolerance * tolerance;
  for (let i = 0; i < count; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    for (const [sr, sg, sb] of swatches) {
      const dr = r - sr;
      const dg = g - sg;
      const db = b - sb;
      if (dr * dr + dg * dg + db * db <= limit) {
        mask[i] = 1;
        break;
      }
    }
  }
  return mask;
}

/**
 * Majority vote over k×k blocks — the anti-aliasing pass. Ties fill, because
 * for a *wall* mask the conservative error is the blocked one: a champion
 * refused a sliver of walkable paint is a pathfinding detour, a champion
 * walking through a sliver of wall is a broken map.
 */
export function downsampleMask(mask, w, h, k) {
  const outW = Math.ceil(w / k);
  const outH = Math.ceil(h / k);
  const out = new Uint8Array(outW * outH);
  for (let by = 0; by < outH; by++) {
    for (let bx = 0; bx < outW; bx++) {
      let filled = 0;
      let total = 0;
      for (let y = by * k; y < Math.min(h, (by + 1) * k); y++) {
        for (let x = bx * k; x < Math.min(w, (bx + 1) * k); x++) {
          total++;
          filled += mask[y * w + x];
        }
      }
      out[by * outW + bx] = filled * 2 >= total && filled > 0 ? 1 : 0;
    }
  }
  return { mask: out, w: outW, h: outH };
}

/**
 * The 4-connected component of the mask containing the seed cell — every
 * other filled cell drops. This is how a *walkable* classification survives
 * a decorated source image: the map border art shares colors with the floor
 * (grays, blues), but only the floor is connected to a point the player can
 * stand on, so classify the walkable colors, keep the component under the
 * map's centre, and invert the result into the wall mask.
 */
export function componentFrom(mask, w, h, seedX, seedY) {
  const out = new Uint8Array(mask.length);
  const seed = seedY * w + seedX;
  if (!mask[seed]) return out;
  const queue = [seed];
  out[seed] = 1;
  while (queue.length > 0) {
    const index = queue.pop();
    const x = index % w;
    const y = (index - x) / w;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const next = ny * w + nx;
      if (mask[next] && !out[next]) {
        out[next] = 1;
        queue.push(next);
      }
    }
  }
  return out;
}

/** Filled where `mask` is empty — the wall side of a walkable classification. */
export function invertMask(mask) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

/**
 * Every boundary loop of the mask, as corner-coordinate polygons with
 * collinear runs already merged. Filled-on-the-left directed edges, chained
 * end to start; at a saddle corner (two outgoing edges) the sharpest left
 * turn is taken, which keeps two diagonally-touching regions two loops
 * instead of a figure eight.
 */
export function traceContours(mask, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  /** start corner key -> [{ex, ey, dx, dy}] */
  const edges = new Map();
  const addEdge = (sx, sy, ex, ey) => {
    const key = `${sx},${sy}`;
    const list = edges.get(key) ?? [];
    list.push({ sx, sy, ex, ey, dx: Math.sign(ex - sx), dy: Math.sign(ey - sy) });
    edges.set(key, list);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) addEdge(x + 1, y, x, y); // top side, walking -x
      if (!at(x, y + 1)) addEdge(x, y + 1, x + 1, y + 1); // bottom side, walking +x
      if (!at(x - 1, y)) addEdge(x, y, x, y + 1); // left side, walking +y
      if (!at(x + 1, y)) addEdge(x + 1, y + 1, x + 1, y); // right side, walking -y
    }
  }

  const takeFrom = (key, inDx, inDy) => {
    const list = edges.get(key);
    if (!list || list.length === 0) return null;
    let pick = 0;
    if (list.length > 1 && (inDx !== 0 || inDy !== 0)) {
      // Left of (dx, dy) in screen coordinates is (dy, -dx).
      const rank = edge => {
        if (edge.dx === inDy && edge.dy === -inDx) return 0; // left turn
        if (edge.dx === inDx && edge.dy === inDy) return 1; // straight
        return 2; // right turn
      };
      for (let i = 1; i < list.length; i++) if (rank(list[i]) < rank(list[pick])) pick = i;
    }
    const edge = list.splice(pick, 1)[0];
    if (list.length === 0) edges.delete(key);
    return edge;
  };

  const loops = [];
  while (edges.size > 0) {
    const firstKey = edges.keys().next().value;
    let edge = takeFrom(firstKey, 0, 0);
    const points = [{ x: edge.sx, y: edge.sy }];
    while (true) {
      const last = points[points.length - 1];
      // Merge collinear runs as we walk: a straight wall of N cells is one
      // segment, not N.
      if (
        points.length >= 2 &&
        Math.sign(edge.sx - points[points.length - 2].x) === edge.dx &&
        Math.sign(edge.sy - points[points.length - 2].y) === edge.dy &&
        (last.x - points[points.length - 2].x) * edge.dy ===
          (last.y - points[points.length - 2].y) * edge.dx
      ) {
        last.x = edge.ex;
        last.y = edge.ey;
      } else {
        points.push({ x: edge.ex, y: edge.ey });
      }
      const key = `${edge.ex},${edge.ey}`;
      const next = takeFrom(key, edge.dx, edge.dy);
      if (!next) break;
      edge = next;
    }
    // The walk ends back at the start corner; drop the duplicated closing
    // point, and re-check the seam for collinearity (a straight run through
    // the arbitrary starting corner arrives as two segments).
    points.pop();
    if (points.length >= 3) {
      const a = points[points.length - 1];
      const b = points[0];
      const c = points[1];
      if ((b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x)) points.shift();
    }
    loops.push(points);
  }
  return loops;
}

/** Shoelace signed area. With this module's winding, outer loops are negative and holes positive. */
export function loopArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

const perpendicularDistance = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx);
  return cross / Math.sqrt(lengthSq);
};

const douglasPeucker = (points, epsilon) => {
  if (points.length <= 2) return points.slice();
  let worst = 0;
  let worstIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > worst) {
      worst = d;
      worstIndex = i;
    }
  }
  if (worst <= epsilon) return [first, last];
  const left = douglasPeucker(points.slice(0, worstIndex + 1), epsilon);
  const right = douglasPeucker(points.slice(worstIndex), epsilon);
  return [...left.slice(0, -1), ...right];
};

/**
 * Douglas-Peucker for a closed loop: anchored at the two mutually farthest
 * of (first point, farthest-from-first), simplified per half, rejoined. The
 * anchors guarantee the loop cannot collapse to a line whatever epsilon is.
 */
export function simplifyLoop(points, epsilon) {
  if (points.length <= 4) return points.slice();
  const start = points[0];
  let farIndex = 1;
  let farDist = -1;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - start.x, points[i].y - start.y);
    if (d > farDist) {
      farDist = d;
      farIndex = i;
    }
  }
  const half1 = douglasPeucker(points.slice(0, farIndex + 1), epsilon);
  const half2 = douglasPeucker([...points.slice(farIndex), start], epsilon);
  return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

const pointInLoop = (px, py, loop) => {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * An outer loop with its holes folded in as one simple polygon, via the
 * keyhole cut font glyphs use: walk the outer to its closest vertex to the
 * hole, walk the whole hole (wound the opposite way, which `traceContours`
 * already guarantees), and walk back along a zero-width bridge. Both the
 * even-odd rule (`pointInPolygon`, `NavGrid`'s rasteriser) and the nonzero
 * rule (canvas `fill()`) then agree the hole's inside is outside.
 *
 * This exists because a hole cannot be its own polygon in a `MapGeometry`:
 * core blocks a point inside *any* wall polygon, so a separately-emitted
 * hole changes nothing and a dropped one walls the courtyard it described.
 */
export function bridgeHoles(outer, holes) {
  let merged = outer.slice();
  for (const hole of holes) {
    let bestOuter = 0;
    let bestHole = 0;
    let best = Infinity;
    for (let i = 0; i < merged.length; i++) {
      for (let j = 0; j < hole.length; j++) {
        const d =
          (merged[i].x - hole[j].x) * (merged[i].x - hole[j].x) +
          (merged[i].y - hole[j].y) * (merged[i].y - hole[j].y);
        if (d < best) {
          best = d;
          bestOuter = i;
          bestHole = j;
        }
      }
    }
    const rotated = [...hole.slice(bestHole), ...hole.slice(0, bestHole)];
    merged = [
      ...merged.slice(0, bestOuter + 1),
      ...rotated,
      rotated[0],
      ...merged.slice(bestOuter),
    ];
  }
  return merged;
}

/**
 * The whole pipeline below classification: loops, hole handling, the speck
 * filter (in cell² — area is measured before simplification, on the exact
 * traced outline), then simplification.
 *
 * Holes above `minArea` are bridged into their innermost containing outer
 * loop (see `bridgeHoles`); holes below it are filled — a pit too small to
 * stand in is noise. Pass `dropHoles: true` to discard them all instead,
 * for masks where every walkable region touches the map edge's own hole.
 */
export function tracePolygons(mask, w, h, { epsilon = 1.5, minArea = 8, dropHoles = false } = {}) {
  const loops = traceContours(mask, w, h);
  const outers = [];
  const holes = [];
  for (const loop of loops) {
    const area = loopArea(loop);
    if (Math.abs(area) < minArea) continue;
    const simplified = simplifyLoop(loop, epsilon);
    if (area <= 0) outers.push({ loop: simplified, area: -area });
    else if (!dropHoles) holes.push(simplified);
  }
  // Innermost containment: among outers containing the hole, the smallest.
  const holesFor = new Map();
  for (const hole of holes) {
    let owner = null;
    for (let i = 0; i < outers.length; i++) {
      if (!pointInLoop(hole[0].x, hole[0].y, outers[i].loop)) continue;
      if (owner === null || outers[i].area < outers[owner].area) owner = i;
    }
    if (owner !== null) {
      if (!holesFor.has(owner)) holesFor.set(owner, []);
      holesFor.get(owner).push(hole);
    }
  }
  return outers.map(({ loop }, i) => (holesFor.has(i) ? bridgeHoles(loop, holesFor.get(i)) : loop));
}

/** Mask/corner coordinates into map units. */
export function scaleLoops(loops, factor, round = true) {
  return loops.map(loop =>
    loop.map(p => ({
      x: round ? Math.round(p.x * factor) : p.x * factor,
      y: round ? Math.round(p.y * factor) : p.y * factor,
    }))
  );
}

const loopLiteral = (loop, indent) => {
  const pad = ' '.repeat(indent);
  const points = loop.map(p => `${pad}  { x: ${p.x}, y: ${p.y} },`).join('\n');
  return `${pad}[\n${points}\n${pad}],`;
};

/**
 * The `terrain` literal of a `MapGeometry`, ready to paste into a pack's
 * `<name>Geometry.ts` — same layout Prettier settles on for the hand-written
 * ones, so pasting it does not re-format the file around it.
 */
export function geometrySnippet({ wall = [], bush = [], water = [] }) {
  const section = loops =>
    loops.length === 0 ? '[]' : `[\n${loops.map(loop => loopLiteral(loop, 6)).join('\n')}\n    ]`;
  return [
    '  terrain: {',
    `    wall: ${section(wall)},`,
    `    bush: ${section(bush)},`,
    `    water: ${section(water)},`,
    '  },',
  ].join('\n');
}
