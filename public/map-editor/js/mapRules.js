/* ============================ mapRules.js ==============================
   Luật hình học của map: lane có đi lọt không, lính có đứng được lên
   waypoint không.

   MỘT BẢN DUY NHẤT, HAI NƠI DÙNG. File này là bản cài đặt; phía TypeScript
   không viết lại nó mà nạp chính file này qua `src/seams/mapRules.ts` (dùng
   `node:vm`, đúng cách `tests/content/localMaps.test.ts` đã nạp cả editor từ
   lâu) rồi xuất ra dưới dạng có kiểu. Nhờ vậy:

     - bảng "Kiểm tra" trong editor,
     - `tests/maps/Lanes.test.ts` của pack,
     - và bất cứ cổng nào của core,

   đều hỏi cùng một hàm với cùng những con số. Hai bản cài đặt là cách mà
   editor báo xanh còn cổng đẩy lên báo đỏ — chuyện vừa xảy ra thật, với một
   lane đi xuyên tường 3px mà editor nói "0 lỗi".

   Vì sao là JavaScript thuần chứ không phải TypeScript: editor không có
   bundler, không có bước build, chỉ là mấy thẻ <script> nói chuyện với nhau
   qua biến toàn cục. Bên nạp được TypeScript thì cũng nạp được file này; bên
   không thì không. Nên bản gốc phải nằm ở phía hẹp hơn.

   KHÔNG import gì, và không đụng tới `E` hay bất kỳ trạng thái nào của
   editor. Vào là dữ liệu trần, ra là danh sách lỗi — đó là thứ khiến nó chạy
   được ở cả hai nơi.
   ===================================================================== */
(function () {
  "use strict";

  /**
   * Khoảng hở tối thiểu giữa tim lane và tường, tính bằng px world.
   *
   * Thân lính rộng nhất là 34px, nên dưới ~20px là đã có phần thân nằm trong
   * tường. 40 là con số đó cộng biên, vì lính còn rời lane để đuổi thứ nó vừa
   * nhắm.
   */
  const MIN_LANE_WALL_CLEARANCE = 40;

  /**
   * Tâm lính không thể tới gần tâm trụ hơn khoảng này: bán kính thân trụ
   * (`DEFAULT_TURRET_PRESET.size` 92, tức 46) cộng bán kính thân lính rộng
   * nhất (34 chia đôi là 17). Trụ là vật bất động trong `UnitCollisionSystem`,
   * nên đây là sàn cứng chứ không phải sở thích.
   */
  const TURRET_BLOCKED_RADIUS = 46 + 17;

  /**
   * Waypoint gần trụ hơn mức này thì lính không bao giờ tới nơi: nó bị chặn ở
   * `TURRET_BLOCKED_RADIUS`, mà `Minion.WAYPOINT_TOLERANCE` chỉ có 40 — nên nó
   * không bao giờ ghi nhận "đã tới", không tăng `waypointIndex`, và cọ vào trụ
   * cho tới hết trận. Không phải giả thuyết: đó đúng là thứ mấy lane đầu tiên
   * đã làm, khi waypoint chính là toạ độ trụ.
   */
  const MIN_WAYPOINT_TURRET_CLEARANCE = TURRET_BLOCKED_RADIUS + 5;

  /**
   * Câu hỏi đó hỏi cho cả quãng đi, không riêng các waypoint. Hai waypoint đều
   * hở trụ mà đoạn nối giữa chúng lại cắt ngang qua trụ là chuyện thường — và
   * đó chính là báo cáo "lính bám vào trụ rồi đi vòng", thứ mà một phép kiểm
   * chỉ đọc waypoint không bao giờ thấy.
   *
   * 100 chứ không phải bán kính chặn: đây là một *lane*, không phải một khe,
   * và một wave là sáu thân đẩy nhau sang ngang.
   */
  const MIN_SEGMENT_TURRET_CLEARANCE = 100;

  /** Bước lấy mẫu dọc một đoạn lane. Đủ dày để không bỏ sót một khe hẹp. */
  const CLEARANCE_STEP = 12;

  /** Bình phương khoảng cách từ điểm tới đoạn thẳng. */
  function segDistSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - (ax + dx * t);
    const ey = py - (ay + dy * t);
    return ex * ex + ey * ey;
  }

  /** Ray casting. `pts` là mảng `[x, y]` theo toạ độ world. */
  function pointInPolygon(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0];
      const yi = pts[i][1];
      const xj = pts[j][0];
      const yj = pts[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** AABB của một polygon world, nới ra `pad`. */
  function bounds(pts, pad) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return [minX - pad, minY - pad, maxX + pad, maxY + pad];
  }

  /**
   * Khoảng cách từ một điểm tới tường gần nhất; **âm** khi điểm nằm trong
   * tường.
   *
   * Chặn trên bằng `ceiling` để phép loại theo AABB bỏ qua được gần hết số
   * polygon — Summoner's Rift có 329 bức tường, và mấy phép kiểm bên dưới chỉ
   * quan tâm "có hở đủ không" chứ không cần con số chính xác khi đã hở thoải
   * mái.
   */
  function wallClearance(x, y, walls, ceiling) {
    let best = ceiling;
    for (const wall of walls) {
      const box = wall.box;
      if (x < box[0] - best || x > box[2] + best || y < box[1] - best || y > box[3] + best) continue;

      const pts = wall.points;
      let d = Infinity;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const one = segDistSq(x, y, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
        if (one < d) d = one;
      }
      d = Math.sqrt(d);
      if (pointInPolygon(x, y, pts)) d = -d;
      if (d < best) best = d;
    }
    return best;
  }

  /** Gói mỗi bức tường lại cùng AABB của nó, một lần cho cả lượt kiểm. */
  function prepareWalls(walls) {
    const out = [];
    for (const pts of walls) {
      if (!pts || pts.length < 3) continue;
      out.push({ points: pts, box: bounds(pts, 0) });
    }
    return out;
  }

  /**
   * Ba luật, trên dữ liệu trần.
   *
   * @param {{ lanes: {id: string, points: [number,number][]}[],
   *           walls: [number,number][][],
   *           turrets: [number, number][] }} map
   *   `lanes[].points`, `walls[][]` và `turrets[]` đều là toạ độ world tuyệt
   *   đối. Bên gọi tự cộng offset — editor giữ polygon theo toạ độ tương đối,
   *   pack thì không, và đây là chỗ duy nhất khác nhau giữa hai bên.
   * @returns {{ text: string, at: [number, number] }[]}
   */
  function laneIssues(map) {
    const out = [];
    const walls = prepareWalls(map.walls || []);
    const turrets = map.turrets || [];

    for (const lane of map.lanes || []) {
      const pts = lane.points || [];
      if (pts.length < 2) continue;
      const id = lane.id || "?";

      for (let i = 0; i < pts.length; i++) {
        for (const turret of turrets) {
          const gap = Math.hypot(pts[i][0] - turret[0], pts[i][1] - turret[1]);
          if (gap >= MIN_WAYPOINT_TURRET_CLEARANCE) continue;
          out.push({
            text:
              `Lane “${id}” waypoint ${i} chỉ cách tâm trụ ${Math.round(gap)}px — ` +
              `thân lính bị chặn ở ${TURRET_BLOCKED_RADIUS}px nên nó không bao giờ tới nơi ` +
              `và sẽ cọ vào trụ tới hết trận (cần ≥ ${MIN_WAYPOINT_TURRET_CLEARANCE}px).`,
            at: [pts[i][0], pts[i][1]],
          });
        }
      }

      for (let i = 0; i + 1 < pts.length; i++) {
        const ax = pts[i][0];
        const ay = pts[i][1];
        const bx = pts[i + 1][0];
        const by = pts[i + 1][1];
        const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / CLEARANCE_STEP));

        let worst = Infinity;
        let worstAt = null;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          const gap = wallClearance(x, y, walls, MIN_LANE_WALL_CLEARANCE);
          if (gap < worst) {
            worst = gap;
            worstAt = [x, y];
          }
        }
        if (worst < MIN_LANE_WALL_CLEARANCE && worstAt) {
          out.push({
            text:
              `Lane “${id}” đoạn ${i} chỉ hở tường ${Math.round(worst)}px` +
              (worst < 0 ? " (đang đi XUYÊN tường)" : "") +
              ` — cần ≥ ${MIN_LANE_WALL_CLEARANCE}px cho thân lính.`,
            at: worstAt,
          });
        }

        for (const turret of turrets) {
          const gap = Math.sqrt(segDistSq(turret[0], turret[1], ax, ay, bx, by));
          if (gap >= MIN_SEGMENT_TURRET_CLEARANCE) continue;
          out.push({
            text:
              `Lane “${id}” đoạn ${i} đi sát tâm trụ ${Math.round(gap)}px — ` +
              `cả wave sẽ bám vào trụ rồi đi vòng (cần ≥ ${MIN_SEGMENT_TURRET_CLEARANCE}px).`,
            at: [turret[0], turret[1]],
          });
        }
      }
    }

    return out;
  }

  const MapRules = {
    MIN_LANE_WALL_CLEARANCE,
    TURRET_BLOCKED_RADIUS,
    MIN_WAYPOINT_TURRET_CLEARANCE,
    MIN_SEGMENT_TURRET_CLEARANCE,
    wallClearance,
    prepareWalls,
    laneIssues,
  };

  // Biến toàn cục cho editor; `globalThis` để bên `vm` của Node lấy được cùng
  // một đối tượng mà không cần `window`.
  globalThis.MapRules = MapRules;
})();
