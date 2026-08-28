/* =========================================================================
   geom.js — toán hình học thuần, không đụng DOM, không đụng state.
   Tất cả đều viết theo kiểu "không cấp phát object" để chạy được mỗi frame
   và mỗi lần hit-test mà không tạo rác cho GC.
   ========================================================================= */

const Geom = (() => {
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  /**
   * Điểm nằm trong polygon? Ray casting (even-odd), xử lý đúng cả polygon lõm
   * — nên không cần convex-decomposition chỉ để hit-test như bản cũ nữa.
   * `ox, oy` là gốc của polygon (terrain.position) nên polygon giữ toạ độ local.
   */
  function pointInPolygon(x, y, pts, ox = 0, oy = 0) {
    let inside = false;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i][0] + ox, yi = pts[i][1] + oy;
      const xj = pts[j][0] + ox, yj = pts[j][1] + oy;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** AABB của polygon (toạ độ world). Ghi vào `out` để khỏi tạo array mới. */
  function bounds(pts, ox = 0, oy = 0, out = [0, 0, 0, 0]) {
    if (!pts || pts.length === 0) {
      out[0] = out[1] = ox;
      out[2] = out[3] = oy;
      return out;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0], y = pts[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    out[0] = minX + ox;
    out[1] = minY + oy;
    out[2] = maxX + ox;
    out[3] = maxY + oy;
    return out;
  }

  const rectsOverlap = (a, b) =>
    a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

  const rectContainsPoint = (r, x, y) =>
    x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

  const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

  /** Hai đoạn thẳng có cắt nhau không (bỏ qua trường hợp cộng tuyến). */
  function segSeg(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d1 = cross2(x4 - x3, y4 - y3, x1 - x3, y1 - y3);
    const d2 = cross2(x4 - x3, y4 - y3, x2 - x3, y2 - y3);
    const d3 = cross2(x2 - x1, y2 - y1, x3 - x1, y3 - y1);
    const d4 = cross2(x2 - x1, y2 - y1, x4 - x1, y4 - y1);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  /** Đoạn thẳng có chạm vào hình chữ nhật không (đầu mút nằm trong cũng tính). */
  function segHitsRect(x1, y1, x2, y2, r) {
    if (rectContainsPoint(r, x1, y1) || rectContainsPoint(r, x2, y2)) return true;
    if (Math.max(x1, x2) < r[0] || Math.min(x1, x2) > r[2] ||
      Math.max(y1, y2) < r[1] || Math.min(y1, y2) > r[3]) return false;
    return (
      segSeg(x1, y1, x2, y2, r[0], r[1], r[2], r[1]) ||
      segSeg(x1, y1, x2, y2, r[2], r[1], r[2], r[3]) ||
      segSeg(x1, y1, x2, y2, r[2], r[3], r[0], r[3]) ||
      segSeg(x1, y1, x2, y2, r[0], r[3], r[0], r[1])
    );
  }

  /**
   * Đường viền có chạm vào hình chữ nhật không: một đỉnh nằm trong vùng, hoặc
   * một cạnh cắt qua vùng.
   *
   * CỐ Ý không tính trường hợp vùng chọn nằm lọt trong ruột polygon. Nhờ vậy
   * quét chọn mấy hình nhỏ nằm trong phần lõm của một polygon lớn sẽ không
   * vơ luôn cả polygon lớn — hộp bao của nó trùm cả chỗ lõm, nên lọc bằng
   * AABB không thôi thì lần nào cũng dính.
   */
  function outlineHitsRect(pts, ox, oy, rect, closed) {
    const n = pts.length;
    if (!n) return false;
    for (const p of pts) if (rectContainsPoint(rect, p[0] + ox, p[1] + oy)) return true;
    if (n < 2) return false;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (segHitsRect(a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy, rect)) return true;
    }
    return false;
  }

  /** Trọng tâm đa giác (area centroid); fallback về trung bình đỉnh nếu suy biến. */
  function centroid(pts) {
    const n = pts.length;
    if (n === 0) return [0, 0];
    if (n < 3) {
      let sx = 0, sy = 0;
      for (const p of pts) { sx += p[0]; sy += p[1]; }
      return [sx / n, sy / n];
    }
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      a += cross;
      cx += (pts[j][0] + pts[i][0]) * cross;
      cy += (pts[j][1] + pts[i][1]) * cross;
    }
    if (Math.abs(a) < 1e-9) {
      let sx = 0, sy = 0;
      for (const p of pts) { sx += p[0]; sy += p[1]; }
      return [sx / n, sy / n];
    }
    a *= 0.5;
    return [cx / (6 * a), cy / (6 * a)];
  }

  /**
   * Trung bình cộng toạ độ các đỉnh — KHÁC với `centroid()` (trọng tâm theo
   * diện tích). Cạnh nào bị chia nhỏ thành nhiều đỉnh sẽ kéo điểm này về
   * phía nó; đổi lại nó đúng nghĩa "vị trí trung bình của mọi dot".
   */
  function meanPoint(pts) {
    const n = pts.length;
    if (!n) return [0, 0];
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p[0]; sy += p[1]; }
    return [sx / n, sy / n];
  }

  function area(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    }
    return Math.abs(a) * 0.5;
  }

  /** Bình phương khoảng cách từ điểm tới đoạn thẳng + vị trí t trên đoạn. */
  function segDistSq(px, py, ax, ay, bx, by, out) {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = clamp(t, 0, 1);
    const cx = ax + dx * t, cy = ay + dy * t;
    if (out) { out[0] = cx; out[1] = cy; out[2] = t; }
    const ex = px - cx, ey = py - cy;
    return ex * ex + ey * ey;
  }

  /**
   * Cạnh gần con trỏ nhất — dùng để chèn đỉnh mới đúng chỗ khi double-click
   * lên viền (bản cũ luôn `push()` vào cuối mảng nên polygon bị xoắn).
   * Trả { index, x, y, dist } với index = chèn vào trước đỉnh thứ index.
   */
  function nearestEdge(pts, x, y, ox = 0, oy = 0, open = false) {
    let best = null;
    const hit = [0, 0, 0];
    // `open` = đường gấp khúc (lane): bỏ cạnh khép kín nối đỉnh cuối về đỉnh đầu.
    for (let i = open ? 1 : 0, j = open ? 0 : pts.length - 1; i < pts.length; j = i++) {
      const d = segDistSq(
        x, y,
        pts[j][0] + ox, pts[j][1] + oy,
        pts[i][0] + ox, pts[i][1] + oy,
        hit
      );
      if (!best || d < best.dist) best = { index: i, x: hit[0], y: hit[1], dist: d };
    }
    if (best) best.dist = Math.sqrt(best.dist);
    return best;
  }

  /** Xoay các đỉnh quanh (cx, cy), góc tính bằng độ. Sửa tại chỗ. */
  function rotatePoints(pts, deg, cx = 0, cy = 0) {
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy;
      p[0] = cx + dx * cos - dy * sin;
      p[1] = cy + dx * sin + dy * cos;
    }
    return pts;
  }

  /**
   * Lật các đỉnh qua một trục. `axis` = 'h' lật ngang (soi gương qua đường
   * dọc x = c), 'v' lật dọc. Sửa tại chỗ.
   *
   * Lật làm ĐẢO chiều quấn của polygon; không sao, `decompose()` gọi
   * `makeCCW` trên bản sao trước khi cắt nên mảnh lồi xuất ra vẫn đúng chiều.
   */
  function flipPoints(pts, axis, c = 0) {
    const horizontal = axis === "h" || axis === "x";
    for (const p of pts) {
      if (horizontal) p[0] = 2 * c - p[0];
      else p[1] = 2 * c - p[1];
    }
    return pts;
  }

  function scalePoints(pts, k, cx = 0, cy = 0) {
    for (const p of pts) {
      p[0] = cx + (p[0] - cx) * k;
      p[1] = cy + (p[1] - cy) * k;
    }
    return pts;
  }

  const roundPoints = (pts) => {
    for (const p of pts) { p[0] = Math.round(p[0]); p[1] = Math.round(p[1]); }
    return pts;
  };

  /**
   * Cắt polygon (có thể lõm) thành các mảnh lồi — game cần dữ liệu lồi để
   * va chạm. poly-decomp sửa mảng tại chỗ nên luôn truyền vào một bản sao.
   */
  function decompose(polygon) {
    if (!polygon || polygon.length < 3) return [];
    try {
      const copy = polygon.map((p) => [p[0], p[1]]);
      if (typeof decomp === "undefined") return [copy];
      decomp.makeCCW(copy);
      const parts = decomp.quickDecomp(copy);
      return Array.isArray(parts) && parts.length ? parts : [copy];
    } catch (e) {
      console.warn("decomp lỗi, dùng nguyên polygon:", e);
      return [polygon.map((p) => [p[0], p[1]])];
    }
  }

  /** Đa giác đều n đỉnh, bán kính r, đỉnh đầu hướng lên cho đẹp mắt. */
  function regularPolygon(n, r) {
    const pts = [];
    const off = -Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
    for (let i = 0; i < n; i++) {
      const a = off + (i * TAU) / n;
      pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
    }
    return pts;
  }

  const snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);

  return {
    clamp, lerp, TAU,
    pointInPolygon, bounds, rectsOverlap, rectContainsPoint,
    centroid, meanPoint, area, segDistSq, nearestEdge,
    segSeg, segHitsRect, outlineHitsRect,
    rotatePoints, scalePoints, flipPoints, roundPoints,
    decompose, regularPolygon, snap,
  };
})();
