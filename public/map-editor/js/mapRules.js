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

/** Bán kính thân trụ mặc định: `DEFAULT_TURRET_PRESET.size` là 92. */
  const TURRET_BODY_RADIUS = 46;

  /** Bán kính thân lính rộng nhất: xe pháo `size` 38, cận chiến 34. */
  const MINION_BODY_RADIUS = 19;

  /**
   * Tâm lính không thể tới gần tâm trụ hơn khoảng này: bán kính thân trụ cộng
   * bán kính thân lính. Trụ là vật bất động trong `UnitCollisionSystem`, nên
   * đây là sàn cứng chứ không phải sở thích.
   *
   * Hai vế tách rời chứ không phải một số 63 gõ sẵn, vì editor cần vế thứ hai
   * để vẽ vòng chặn quanh một cái trụ có `size` riêng — map được phép chỉnh
   * `turrets.size`, và lúc đó 46 không còn đúng nữa.
   */
  const TURRET_BLOCKED_RADIUS = TURRET_BODY_RADIUS + MINION_BODY_RADIUS;

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
    // `[x, y]` hay `{x, y, faction}` đều nhận: editor giữ slot là đối tượng,
    // còn phép kiểm bên pack cầm cặp toạ độ trần. Một cái `undefined` lọt vào
    // đây thì mọi khoảng cách thành NaN, mọi so sánh thành false, và hàm này
    // im lặng báo map sạch — nên chuẩn hoá một lần ở cửa vào.
    const turrets = pointsOf(map.turrets);

    for (const lane of map.lanes || []) {
      const pts = lane.points || [];
      if (pts.length < 2) continue;
      const id = lane.id || "?";

      for (let i = 0; i < pts.length; i++) {
        for (const turret of turrets) {
          const gap = Math.hypot(pts[i][0] - turret.x, pts[i][1] - turret.y);
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
          const gap = Math.sqrt(segDistSq(turret.x, turret.y, ax, ay, bx, by));
          if (gap >= MIN_SEGMENT_TURRET_CLEARANCE) continue;
          out.push({
            text:
              `Lane “${id}” đoạn ${i} đi sát tâm trụ ${Math.round(gap)}px — ` +
              `cả wave sẽ bám vào trụ rồi đi vòng (cần ≥ ${MIN_SEGMENT_TURRET_CLEARANCE}px).`,
            at: [turret.x, turret.y],
          });
        }
      }
    }

    return out;
  }

  /* ------------------------------------------------------------------ luật
     cấu trúc: lane nối hai nhà, trụ nằm trên lane, điểm gom lính đứng được,
     bãi quái có cặp thì đối xứng.

     Mấy luật này trước đây nằm trong `tests/maps/Lanes.test.ts` và
     `tests/maps/summonersRift.test.ts` của pack, dưới dạng **bảng toạ độ gõ
     tay**: "trụ top của xanh là ba điểm này", "lane bắt đầu đúng tại
     (400, 6075)", "hàng trụ có đúng 11 cái". Một bảng như thế không phải là
     luật, nó là ảnh chụp map tại một thời điểm — kéo một cái trụ trong editor
     là chín phép kiểm đỏ, và không cái nào nói được điều gì sai, chỉ nói map
     đã khác lúc chụp.

     Nên chúng được viết lại thành câu hỏi về *quan hệ*, không về toạ độ, rồi
     đặt cạnh mấy luật hình học ở trên để editor hỏi được cùng một hàm. Không
     còn con số nào phải sửa khi map đổi.
     ------------------------------------------------------------------------ */

  /**
   * Lane phải đi qua trong khoảng này của cái trụ nó bảo vệ.
   *
   * Đo tới *đường*, không tới waypoint gần nhất: một đoạn thẳng chạy qua ba
   * cái trụ thì không có đỉnh nào của riêng nó, và hỏi các đỉnh sẽ nói lane
   * trượt cái trụ đầu tiên 410px trong khi con lính đi qua ở 196px.
   */
  const LANE_COVERS_TURRET = 280;

  /**
   * Bán kính "vẫn còn là trong nhà" quanh một điểm hồi sinh.
   *
   * Cả ba lane rời nhà qua cùng một cửa, nên trong khoảng này câu hỏi "trụ
   * này của lane nào" không có câu trả lời — và cũng không cần có: trụ nhà
   * không thuộc lane nào cả.
   */
  const BASE_RADIUS = 900;

  /** `{x, y}` hoặc `[x, y]` đều nhận — editor và pack cầm hai kiểu khác nhau. */
  function pointOf(p) {
    if (!p) return null;
    if (Array.isArray(p)) return { x: p[0], y: p[1] };
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    return null;
  }

  function pointsOf(list) {
    const out = [];
    for (const p of list || []) {
      const q = pointOf(p);
      if (q) out.push(q);
    }
    return out;
  }

  /** Điểm trên đường gấp khúc gần `p` nhất: khoảng cách, và đi được bao xa. */
  function nearestOnPath(pts, p) {
    let distance = Infinity;
    let along = 0;
    let travelled = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0];
      const ay = pts[i][1];
      const spanX = pts[i + 1][0] - ax;
      const spanY = pts[i + 1][1] - ay;
      const spanSq = spanX * spanX + spanY * spanY;
      const length = Math.sqrt(spanSq);
      let t = spanSq > 0 ? ((p.x - ax) * spanX + (p.y - ay) * spanY) / spanSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(p.x - (ax + spanX * t), p.y - (ay + spanY * t));
      if (d < distance) {
        distance = d;
        along = travelled + length * t;
      }
      travelled += length;
    }
    return { distance, along };
  }

  const nearestSpawn = (spawns, p) => {
    let best = null;
    let bd = Infinity;
    for (const s of spawns) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { spawn: best, distance: bd } : null;
  };

  const at = (p) => [Math.round(p.x), Math.round(p.y)];

  /**
   * Luật cấu trúc, trên dữ liệu trần. Phần nào của map không được truyền vào
   * thì luật của phần đó im lặng — editor gọi với đầy đủ, một phép kiểm chỉ
   * quan tâm lane thì gọi với mỗi lane.
   *
   * @param {{ size?: number,
   *           lanes?: {id: string, points: [number,number][]}[],
   *           walls?: [number,number][][],
   *           turrets?: ({x:number,y:number,faction?:string}|[number,number])[],
   *           spawns?: {x:number,y:number,faction?:string}[],
   *           musters?: {x:number,y:number,faction?:string,lane?:string,scatter?:number}[],
   *           neutrals?: {x:number,y:number,r?:number,role?:string}[] }} map
   * @returns {{ text: string, at: [number, number] }[]}
   */
  function structureIssues(map) {
    const out = [];
    const lanes = (map.lanes || []).filter((l) => (l.points || []).length >= 2);
    const spawns = pointsOf(map.spawns).map((p, i) => ({
      ...p,
      faction: (map.spawns[i] && map.spawns[i].faction) || "?",
    }));
    const turrets = (map.turrets || [])
      .map((t) => {
        const p = pointOf(t);
        return p ? { ...p, faction: (t && t.faction) || "?" } : null;
      })
      .filter(Boolean);

    // ---- lane nối hai nhà, và cả ba đi cùng một chiều -----------------------
    //
    // Thay cho `expect(path[0]).toEqual({x: 400, y: 6075})`. Cái cũ bắt lane
    // phải *bắt đầu đúng tại* đài phun nước; lane bây giờ bắt đầu ở cửa nhà,
    // cách đó 800px, và đó là một thay đổi hoàn toàn hợp lệ mà phép kiểm cũ
    // không có cách nào phân biệt với một lane bị cắt cụt.
    //
    // Cái thật sự phải đúng thì nhẹ hơn nhiều: hai đầu của một lane thuộc về
    // hai nhà khác nhau, và mọi lane cùng kể câu chuyện theo một chiều — core
    // đảo danh sách waypoint cho phe thứ hai (`getLaneWaypoints`), nên một
    // lane vẽ ngược sẽ đẩy nguyên một wave chạy về nhà mình.
    if (spawns.length >= 2) {
      let opening = null;
      for (const lane of lanes) {
        const pts = lane.points;
        const head = nearestSpawn(spawns, { x: pts[0][0], y: pts[0][1] });
        const tail = nearestSpawn(spawns, {
          x: pts[pts.length - 1][0],
          y: pts[pts.length - 1][1],
        });
        if (!head || !tail) continue;
        if (head.spawn === tail.spawn) {
          out.push({
            text:
              `Lane “${lane.id}” không nối hai nhà: cả hai đầu đều gần trại ` +
              `${head.spawn.faction} nhất — wave sẽ không bao giờ tới nhà đối thủ.`,
            at: at({ x: pts[0][0], y: pts[0][1] }),
          });
          continue;
        }
        if (opening === null) opening = head.spawn;
        else if (opening !== head.spawn) {
          out.push({
            text:
              `Lane “${lane.id}” vẽ ngược chiều so với các lane khác: nó xuất phát ` +
              `từ trại ${head.spawn.faction} còn các lane kia từ trại ` +
              `${opening.faction}. Core đảo waypoint theo phe, nên một lane ngược ` +
              `chiều sẽ đẩy cả wave chạy ngược về nhà mình.`,
            at: at({ x: pts[0][0], y: pts[0][1] }),
          });
        }
      }
    }

    // ---- mỗi trụ hoặc đứng trong nhà, hoặc nằm trên một lane ---------------
    //
    // Thay cho hai bảng `BLUE_LANE_TURRETS`/`RED_LANE_TURRETS` gõ tay. Điều
    // mà bảng đó thật sự canh không phải là "trụ này thuộc lane top", mà là
    // "không có cái trụ nào bị bỏ quên" — một cái trụ không wave nào đi qua
    // thì không ai đẩy được, và nó chỉ đứng đó tới hết trận.
    if (lanes.length > 0 && turrets.length > 0) {
      for (const turret of turrets) {
        const home = spawns.length ? nearestSpawn(spawns, turret) : null;
        if (home && home.distance <= BASE_RADIUS) continue;

        let best = null;
        for (const lane of lanes) {
          const { distance } = nearestOnPath(lane.points, turret);
          if (!best || distance < best.distance) best = { lane, distance };
        }
        if (best && best.distance > LANE_COVERS_TURRET) {
          out.push({
            text:
              `Trụ tại (${Math.round(turret.x)}, ${Math.round(turret.y)}) không nằm ` +
              `trên lane nào: gần nhất là “${best.lane.id}”, cách ` +
              `${Math.round(best.distance)}px (cần ≤ ${LANE_COVERS_TURRET}px). ` +
              `Không wave nào đi qua nó, nên không ai đẩy được trụ này.`,
            at: at(turret),
          });
        }
      }
    }

    // ---- lane đi qua trụ nhà mình trước, trụ nhà đối thủ sau ---------------
    //
    // Thay cho phép so `blueAlong`/`redAlong` dựa trên hai bảng trên. Ở đây
    // "nhà mình" là phe của cái trại mà lane xuất phát, đọc từ chính dữ liệu.
    if (spawns.length >= 2 && turrets.length > 0) {
      for (const lane of lanes) {
        const head = nearestSpawn(spawns, { x: lane.points[0][0], y: lane.points[0][1] });
        if (!head) continue;
        const mine = head.spawn.faction;

        let lastMine = -Infinity;
        let firstTheirs = Infinity;
        let lastMineAt = null;
        let firstTheirsAt = null;
        for (const turret of turrets) {
          const home = spawns.length ? nearestSpawn(spawns, turret) : null;
          if (home && home.distance <= BASE_RADIUS) continue;
          const { distance, along } = nearestOnPath(lane.points, turret);
          if (distance > LANE_COVERS_TURRET) continue;
          if (turret.faction === mine) {
            if (along > lastMine) {
              lastMine = along;
              lastMineAt = turret;
            }
          } else if (along < firstTheirs) {
            firstTheirs = along;
            firstTheirsAt = turret;
          }
        }

        if (lastMineAt && firstTheirsAt && lastMine > firstTheirs) {
          out.push({
            text:
              `Lane “${lane.id}” đi qua trụ ${firstTheirsAt.faction} tại ` +
              `(${Math.round(firstTheirsAt.x)}, ${Math.round(firstTheirsAt.y)}) ` +
              `TRƯỚC trụ ${mine} tại ` +
              `(${Math.round(lastMineAt.x)}, ${Math.round(lastMineAt.y)}) — ` +
              `một lane là một đường từ nhà này sang nhà kia, nên hàng trụ của ` +
              `mỗi phe phải nằm gọn về một phía.`,
            at: at(lastMineAt),
          });
        }
      }
    }

    // ---- điểm gom lính đứng được lên -------------------------------------
    //
    // Cái cũ bắt điểm gom phải *bằng đúng* trung điểm của hai trụ gần đài
    // phun nước nhất — một công thức của `MinionSpawner.musterPointFor`, hàm
    // đã bị xoá từ lâu. Map khai báo thẳng điểm này bây giờ, và nó được kéo
    // bằng tay trong editor, nên "bằng đúng trung điểm" không còn là luật của
    // cái gì cả. Cái còn là luật: cả vòng rải quân phải đứng được.
    if (map.musters && map.musters.length) {
      const walls = prepareWalls(map.walls || []);
      for (const raw of map.musters) {
        const slot = pointOf(raw);
        if (!slot) continue;
        const name = `Điểm gom lính ${raw.faction || "?"}/${raw.lane || "?"}`;
        const scatter = Number.isFinite(+raw.scatter) ? +raw.scatter : 0;

        let worst = Infinity;
        let worstAt = null;
        const samples = [{ x: slot.x, y: slot.y }];
        for (let i = 0; scatter > 0 && i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          samples.push({ x: slot.x + Math.cos(a) * scatter, y: slot.y + Math.sin(a) * scatter });
        }
        for (const p of samples) {
          const gap = wallClearance(p.x, p.y, walls, MIN_LANE_WALL_CLEARANCE);
          if (gap < worst) {
            worst = gap;
            worstAt = p;
          }
        }
        if (worst < MIN_LANE_WALL_CLEARANCE && worstAt) {
          out.push({
            text:
              `${name} có phần vòng rải quân chỉ hở tường ${Math.round(worst)}px` +
              (worst < 0 ? " (nằm TRONG tường)" : "") +
              ` — lính sinh ra ở đó sẽ bị đẩy văng ra (cần ≥ ${MIN_LANE_WALL_CLEARANCE}px).`,
            at: at(worstAt),
          });
        }

        for (const turret of turrets) {
          const gap = Math.hypot(slot.x - turret.x, slot.y - turret.y);
          if (gap >= TURRET_BLOCKED_RADIUS + scatter) continue;
          out.push({
            text:
              `${name} chồng lên thân trụ tại (${Math.round(turret.x)}, ` +
              `${Math.round(turret.y)}) — cách ${Math.round(gap)}px, cần ` +
              `≥ ${TURRET_BLOCKED_RADIUS + scatter}px (vòng chặn ${TURRET_BLOCKED_RADIUS} ` +
              `cộng bán kính rải ${scatter}). Cả wave sẽ nổ tung ra khi vừa sinh.`,
            at: at(slot),
          });
        }
      }
    }

    // ---- bãi quái phải đứng trên đất -------------------------------------
    //
    // Một bãi nằm trong tường không làm game sập: nó làm ra một con quái mà
    // không đường đi nào tới được, và người ta phát hiện ra chuyện đó trong
    // một trận đấu chứ không phải ở đây. Chỉ hỏi về *tâm* bãi, không hỏi cả
    // bán kính — bãi quái nằm trong hốc đá là chuyện bình thường, mép bãi
    // chạm tường là đúng ý đồ.
    if (map.neutrals && map.neutrals.length) {
      const walls = prepareWalls(map.walls || []);
      for (const raw of map.neutrals) {
        const p = pointOf(raw);
        if (!p) continue;
        if (wallClearance(p.x, p.y, walls, 1) >= 0) continue;
        out.push({
          text:
            `Bãi quái “${raw.role || "?"}” tại (${Math.round(p.x)}, ${Math.round(p.y)}) ` +
            `nằm TRONG tường — sẽ có một con quái mà không ai đi tới được.`,
          at: at(p),
        });
      }
    }

    // ---- bãi quái có cặp thì phải là ảnh đối xứng của nhau -----------------
    //
    // Hai chỗ dễ sai, và cái thứ hai đã sai thật:
    //
    // **Sai số cho phép là bán kính của chính bãi đó**, chứ không phải 1px như
    // phép kiểm cũ bên pack. Đấy là ngưỡng duy nhất ở đây không phải do ai
    // chọn: lệch ít hơn bán kính bãi nghĩa là ảnh phản chiếu vẫn rơi vào trong
    // bãi, và không người chơi nào đo được. 1px thì không phải luật về công
    // bằng, nó là luật về "map này có được sinh ra bằng script không".
    //
    // **Và không phải map nào cũng đối xứng qua tâm.** Summoner's Rift thì có,
    // nên bản đầu tiên của luật này chỉ hỏi phép quay 180°; Twisted Treeline
    // đối xứng qua trục dọc và lập tức bị báo lệch 3023px. Một cặp hợp lệ khi
    // nó là ảnh của nhau qua *một* phép đối xứng của khung map — quay nửa
    // vòng, lật ngang, hoặc lật dọc — nên hỏi cả ba rồi lấy cái khớp nhất.
    if (map.neutrals && map.neutrals.length && Number.isFinite(+map.size)) {
      const span = +map.size;
      const byRole = new Map();
      for (const raw of map.neutrals) {
        const p = pointOf(raw);
        if (!p) continue;
        const role = raw.role || "?";
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push({ ...p, r: Number.isFinite(+raw.r) ? +raw.r : 0 });
      }
      for (const [role, list] of byRole) {
        if (list.length !== 2) continue;
        const [a, b] = list;
        const mirrors = [
          { name: "quay nửa vòng quanh tâm", x: span - b.x, y: span - b.y },
          { name: "lật qua trục dọc", x: span - b.x, y: b.y },
          { name: "lật qua trục ngang", x: b.x, y: span - b.y },
        ];
        let best = null;
        for (const m of mirrors) {
          const off = Math.hypot(a.x - m.x, a.y - m.y);
          if (!best || off < best.off) best = { off, name: m.name };
        }
        const tolerance = Math.min(a.r, b.r);
        if (!best || !(tolerance > 0) || best.off <= tolerance) continue;
        out.push({
          text:
            `Cặp bãi “${role}” không phải ảnh đối xứng của nhau: gần nhất là ` +
            `${best.name}, vẫn lệch ${Math.round(best.off)}px — quá bán kính bãi ` +
            `(${tolerance}px), nên một nửa rừng đi bộ gần hơn nửa kia.`,
          at: at(a),
        });
      }
    }

    return out;
  }

  /** Cả hai bộ luật, một lần gọi. Đây là thứ editor và cổng của pack dùng. */
  function mapIssues(map) {
    return laneIssues(map).concat(structureIssues(map));
  }

  const MapRules = {
    MIN_LANE_WALL_CLEARANCE,
    TURRET_BODY_RADIUS,
    MINION_BODY_RADIUS,
    TURRET_BLOCKED_RADIUS,
    MIN_WAYPOINT_TURRET_CLEARANCE,
    MIN_SEGMENT_TURRET_CLEARANCE,
    LANE_COVERS_TURRET,
    BASE_RADIUS,
    wallClearance,
    prepareWalls,
    nearestOnPath,
    laneIssues,
    structureIssues,
    mapIssues,
  };

  // Biến toàn cục cho editor; `globalThis` để bên `vm` của Node lấy được cùng
  // một đối tượng mà không cần `window`.
  globalThis.MapRules = MapRules;
})();
