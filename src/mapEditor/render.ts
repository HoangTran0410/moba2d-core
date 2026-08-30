/* =========================================================================
   render.js — vẽ bằng Canvas2D thuần (không còn p5.js).

   Vẽ theo yêu cầu: không có vòng lặp 60fps chạy suốt. Mỗi thay đổi gọi
   requestRender(); khi camera đang trượt mượt thì tự lên lịch frame kế tiếp
   rồi dừng hẳn. Máy đứng yên = 0% CPU, điện thoại không nóng.
   ========================================================================= */

import { Geom } from './geom';
import { requestRender, setRequestRender } from './frame';
import { MapRules } from './mapRules';
import { CORE_DEFAULTS, Cam, E, KIND, MARKER_PX, Sel, TYPES, TYPE_INFO, circleR, factionColor, isMarker, refreshTerrain, slotStat, turretBodyR, vertexHost } from './state';
import { Store } from './storage';
import { UI } from './ui';

export const Renderer = (() => {
  let cv, ctx, mini, mctx;
  let rafId = 0;
  let lastT = 0;
  let frames = 0, fpsT = 0, fps = 0;

  const view = [0, 0, 0, 0];
  const tmp = [0, 0];

  /* ------------------------------ màu ------------------------------- */

  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const C = {
    void: "#090b10",
    paper: "#0f141b",
    bound: "rgba(200,170,110,.30)",
    gridMinor: "rgba(120,140,165,.07)",
    gridMajor: "rgba(120,140,165,.15)",
    axis: "rgba(200,170,110,.34)",
    label: "rgba(140,155,175,.65)",
    accent: "#29d3c4",
    accentSoft: "rgba(41,211,196,.18)",
    vertex: "#ffd166",
    vertexHot: "#ffffff",
    piece: "rgba(255,255,255,.13)",
    marquee: "rgba(41,211,196,.12)",
    marqueeLine: "#29d3c4",
    pen: "#ffd166",
  };

  const FILL = {}, FILL_HI = {}, LINE = {}, LINE_HI = {};
  for (const k of TYPES) {
    const c = TYPE_INFO[k].color;
    FILL[k] = rgba(c, 0.22);
    FILL_HI[k] = rgba(c, 0.42);
    LINE[k] = rgba(c, 0.75);
    LINE_HI[k] = rgba(c, 1);
  }

  /* ----------------------------- vòng đời ---------------------------- */

  function init() {
    cv = document.getElementById("board");
    ctx = cv.getContext("2d", { alpha: false, desynchronized: true });
    mini = document.getElementById("minimap");
    mctx = mini.getContext("2d", { alpha: false });

    setRequestRender(() => {
      if (!rafId) rafId = requestAnimationFrame(frame);
    });

    resize();
    window.addEventListener("resize", resize, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", resize, { passive: true });
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || window.innerWidth;
    const h = cv.clientHeight || window.innerHeight;
    if (E.view.w === w && E.view.h === h && E.view.dpr === dpr) return;

    E.view.w = w;
    E.view.h = h;
    E.view.dpr = dpr;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);

    requestRender();
  }

  function frame(t) {
    rafId = 0;
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0.016;
    lastT = t;

    frames++;
    if (t - fpsT > 500) {
      fps = Math.round((frames * 1000) / (t - fpsT));
      frames = 0;
      fpsT = t;
    }

    const settled = Cam.step(dt);
    draw();
    Store.noteCamera();
    // Editor chỉ vẽ khi có việc, nên bất cứ thứ gì tự chạy theo thời gian đều
    // phải tự giữ vòng lặp sống. Camera đã tự lo phần của nó qua `settled`;
    // vòng nháy ở chỗ lỗi thì không, và nếu chỉ dựa vào camera thì nó đứng
    // hình đúng lúc camera tới nơi — tức là đúng lúc người ta bắt đầu nhìn.
    // `drawCheckFocus` tự xoá `E.checkFocus` khi hết hạn, nên điều kiện này
    // cũng là thứ dừng vòng lặp lại.
    if (!settled || E.checkFocus) requestRender();
  }

  /* ------------------------------ vẽ chính --------------------------- */

  function draw() {
    const { w, h, dpr } = E.view;
    const s = Cam.scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.void;
    ctx.fillRect(0, 0, w, h);

    Cam.viewRect(80, view);

    ctx.save();
    ctx.translate(w * 0.5, h * 0.5);
    ctx.scale(s, s);
    ctx.translate(-Cam.x, -Cam.y);

    labels.length = 0;
    drawMapPaper();
    drawBackgroundImage();
    if (E.showGrid) drawGrid(s);
    drawTerrains(s);
    drawSelectionChrome(s);
    drawPen(s);
    if (E.showDummy) drawDummy();
    drawCheckFocus(s);

    ctx.restore();

    drawLabels();
    if (E.showGrid) drawGridLabels(s);
    drawMarquee();
    if (E.showMinimap) drawMinimap();

    // `syncStatus` takes no argument, and the compiler saying so is how the
    // whole readout turned out to be dead: there is no `#st-fps` in the page
    // and no reader of `Renderer.fps` anywhere. The counter above still runs;
    // the number has not reached a screen in some time.
    UI.syncStatus();
  }

  /** Bao lâu vòng nháy ở chỗ lỗi còn sống, tính từ lúc bấm. */
  const CHECK_FOCUS_MS = 2600;

  /**
   * Vòng nháy tại chỗ hỏng mà bảng "Kiểm tra" vừa bay tới.
   *
   * Bay tới thôi là chưa đủ: mấy lỗi hình học không trỏ vào một hình nào bấm
   * chọn được — "lane đoạn 6 hở tường 3px" là một điểm giữa quãng đi, giữa hai
   * waypoint, không thuộc về vật gì cả. Không có dấu thì người ta tới đúng chỗ
   * và vẫn không biết đang phải nhìn cái gì.
   *
   * Tự tắt: nó là câu trả lời cho một cú bấm, không phải một lớp hiển thị.
   */
  function drawCheckFocus(s) {
    const focus = E.checkFocus;
    if (!focus) return;
    const age = performance.now() - focus.since;
    if (age > CHECK_FOCUS_MS) {
      E.checkFocus = null;
      return;
    }

    const left = 1 - age / CHECK_FOCUS_MS;
    const beat = (age % 900) / 900;
    ctx.save();
    ctx.lineWidth = 2.5 / s;
    ctx.strokeStyle = `rgba(242,85,90,${(0.25 + 0.55 * left).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(focus.x, focus.y, 26 + 46 * beat, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = `rgba(242,85,90,${(0.9 * left).toFixed(3)})`;
    const arm = 34;
    ctx.beginPath();
    ctx.moveTo(focus.x - arm, focus.y);
    ctx.lineTo(focus.x + arm, focus.y);
    ctx.moveTo(focus.x, focus.y - arm);
    ctx.lineTo(focus.x, focus.y + arm);
    ctx.stroke();
    ctx.restore();
  }

  function drawMapPaper() {
    const [mw, mh] = E.mapSize;
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, mw, mh);
    ctx.lineWidth = 2 / Cam.scale;
    ctx.strokeStyle = C.bound;
    ctx.strokeRect(0, 0, mw, mh);
  }

  function drawBackgroundImage() {
    if (!E.showBg || !E.images.bg) return;
    ctx.globalAlpha = 0.85;
    try {
      ctx.drawImage(E.images.bg, 0, 0, E.mapSize[0], E.mapSize[1]);
    } catch (e) { /* ảnh chưa sẵn sàng */ }
    ctx.globalAlpha = 1;
  }

  /** Lưới hai cấp: bước phụ + bước chính (gấp 5), tự đổi theo mức zoom. */
  function gridStep(s) {
    let step = 50;
    while (step * s < 26) step *= 2;
    while (step * s > 64) step /= 2;
    return step;
  }

  function drawGrid(s) {
    const step = gridStep(s);
    const major = step * 5;
    const [l, t, r, b] = view;

    // Chốt chặn: không bao giờ vẽ quá ~600 đường mỗi trục.
    const drawLines = (gs, style, width) => {
      const nx = (r - l) / gs, ny = (b - t) / gs;
      if (nx > 600 || ny > 600) return;
      ctx.beginPath();
      for (let x = Math.ceil(l / gs) * gs; x <= r; x += gs) {
        ctx.moveTo(x, t);
        ctx.lineTo(x, b);
      }
      for (let y = Math.ceil(t / gs) * gs; y <= b; y += gs) {
        ctx.moveTo(l, y);
        ctx.lineTo(r, y);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width / s;
      ctx.stroke();
    };

    drawLines(step, C.gridMinor, 1);
    drawLines(major, C.gridMajor, 1);

    ctx.beginPath();
    ctx.moveTo(0, t); ctx.lineTo(0, b);
    ctx.moveTo(l, 0); ctx.lineTo(r, 0);
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.5 / s;
    ctx.stroke();
  }

  /** Nhãn toạ độ vẽ ở hệ màn hình cho chữ luôn sắc nét, không bị scale méo. */
  function drawGridLabels(s) {
    const major = gridStep(s) * 5;
    if (major * s < 58) return;
    const [l, t, r, b] = view;

    ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = C.label;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    let n = 0;
    for (let x = Math.ceil(l / major) * major; x <= r && n < 60; x += major, n++) {
      Cam.toScreen(x, 0, tmp);
      const y = Geom.clamp(tmp[1], 56, E.view.h - 40);
      ctx.fillText(String(Math.round(x)), tmp[0] + 3, y + 3);
    }
    for (let y = Math.ceil(t / major) * major; y <= b && n < 120; y += major, n++) {
      if (y === 0) continue;
      Cam.toScreen(0, y, tmp);
      const x = Geom.clamp(tmp[0], 8, E.view.w - 60);
      ctx.fillText(String(Math.round(y)), x + 3, tmp[1] + 3);
    }
  }

  /* ---------------------------- terrain ------------------------------ */

  function pathFor(t) {
    if (!t._path) {
      const p = new Path2D();
      const poly = t.polygon;
      if (poly.length) {
        p.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) p.lineTo(poly[i][0], poly[i][1]);
        p.closePath();
      }
      t._path = p;
    }
    return t._path;
  }

  /** Nhãn của slot/lane, gom lại rồi vẽ ở hệ màn hình cho chữ sắc nét. */
  const labels = [];

  function queueLabel(t, wx, wy, dy) {
    const text = labelFor(t);
    if (!text || labels.length > 140) return;
    Cam.toScreen(wx, wy, tmp);
    labels.push({ x: tmp[0], y: tmp[1] + dy, text, color: LINE_HI[t.type] });
  }

  /**
   * Tên của một vòng tròn, vẽ ngay trên mép nó — chỉ khi slot đang được chọn.
   *
   * Một cái trụ đang vẽ ba vòng đồng tâm và một bãi quái vẽ ba, mà không vòng
   * nào tự nói nó là gì: câu hỏi "cái vòng cam nét đứt ngoài kia là gì" là
   * câu hỏi phải mở mã nguồn ra mới trả lời được, và đó là editor thiếu chữ
   * chứ không phải người dùng thiếu chú ý.
   *
   * Chỉ khi chọn, vì đó là lúc người ta đang hỏi về *cái này*; vẽ luôn cho
   * mọi slot thì bản đồ đầy chữ chồng lên nhau và không đọc được cái nào.
   */
  function queueRingLabel(t, radius, text) {
    if (!(radius > 0) || labels.length > 140) return;
    // Mép trên của vòng, ở hệ toạ độ của slot — khối vẽ đang `translate` về
    // tâm nó, còn nhãn thì vẽ ở hệ màn hình nên cần toạ độ world.
    Cam.toScreen(t.position[0], t.position[1] - radius, tmp);
    labels.push({ x: tmp[0], y: tmp[1] - 15, text, color: "rgba(200,210,225,.85)" });
  }

  function labelFor(t) {
    const p = t.props || {};
    switch (t.type) {
      case "spawn": return p.faction || "";
      case "structure": return p.faction || "";
      case "minion": return `${p.faction || "?"} · ${p.lane || "?"}`;
      case "neutral": return p.role || "";
      case "lane": return p.id || "";
      default: return "";
    }
  }

  function drawLabels() {
    if (!labels.length || Cam.scale < 0.035) return;
    ctx.font = '600 10.5px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const l of labels) {
      if (l.x < -60 || l.x > E.view.w + 60 || l.y < 40 || l.y > E.view.h - 20) continue;
      const w = ctx.measureText(l.text).width;
      ctx.fillStyle = "rgba(9,11,16,.72)";
      ctx.fillRect(l.x - w / 2 - 4, l.y - 1, w + 8, 14);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
    }
  }

  // `slotStat`, `turretBodyR` và `CORE_DEFAULTS` ở `state.js`: `pickR` cần
  // đúng công thức này để bắt chuột trúng chỗ vừa vẽ, và hai bản sao của một
  // công thức là hai bản sẽ lệch nhau.
  const slotNumber = slotStat;

  /**
   * Một vòng tròn "tầm với", vẽ mảnh và nhạt.
   *
   * Chấm chấm và không tô: đây là **thông tin**, không phải hình người ta vẽ,
   * và nó phải đọc được là khác loại với đường viền của chính slot — nếu
   * không thì trông như slot to hơn thật.
   */
  function drawReach(radius, s, color, dash) {
    if (!(radius > 0)) return;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Geom.TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 / s;
    ctx.setLineDash(dash.map((d) => d / s));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Điểm gom lính: hình thoi cỡ cố định theo màn hình, zoom nào cũng thấy. */
  function drawMarker(t, s, hot, selected) {
    const r = MARKER_PX / s;
    ctx.lineWidth = (selected ? 2.2 : 1.6) / s;
    ctx.strokeStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    ctx.fillStyle = hot ? FILL_HI[t.type] : FILL[t.type];

    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Geom.TAU);
    ctx.fillStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    ctx.fill();
  }

  /**
   * Cái trụ, **to bằng đúng cỡ thật**, và chính nó là thứ để bấm vào.
   *
   * Trước đây trụ vẽ ra một ô vuông cố định 12px màn hình *nằm chồng lên*
   * vòng tròn cỡ thật. Ô vuông đó là vùng bấm duy nhất, nên thứ người ta nhìn
   * và thứ người ta bấm trúng là hai chỗ khác nhau — kéo trụ phải nhắm vào
   * cái chấm giữa, còn cái vòng to bao quanh thì trơ ra. Ô vuông đi rồi;
   * `pickR` (state.js) giờ trả về đúng bán kính thân này, nên hover, click và
   * kéo đều ăn trên cả mặt tròn.
   *
   * Ba vòng, trả lời ba câu khác nhau:
   *
   *   - **Thân** (`size / 2`, tô đặc): chỗ trụ thật sự đứng. Đây là vật bất
   *     động trong `UnitCollisionSystem` — không ai đi xuyên qua nó.
   *   - **Vòng chặn** (`size / 2 + MINION_BODY_RADIUS`, cam nét đứt): tâm một
   *     con lính không bao giờ vào gần hơn thế. Đây đúng là con số mà luật
   *     lane trong `mapRules.js` đo, nên khi bảng "Kiểm tra" báo "waypoint chỉ
   *     cách tâm trụ 67px", cái vòng cam này là thứ nó đang nói tới.
   *   - **Tầm bắn** (xanh nét đứt thưa): trụ với tới đâu. Hai trụ cách nhau
   *     bao nhiêu thì vùng bắn còn chồng nhau là câu hỏi phải nhìn mới trả
   *     lời được.
   *
   * Cái chấm giữa ở lại, cỡ cố định theo màn hình: zoom ra đủ xa thì thân trụ
   * nhỏ hơn một pixel, và lúc đó nó là thứ duy nhất còn nói "có trụ ở đây".
   */
  function drawTurret(t, s, hot, selected) {
    const body = turretBodyR(t);

    ctx.beginPath();
    ctx.arc(0, 0, body, 0, Geom.TAU);
    ctx.fillStyle = hot ? FILL_HI[t.type] : FILL[t.type];
    ctx.fill();
    ctx.strokeStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    ctx.lineWidth = (selected ? 2.4 : 1.6) / s;
    ctx.stroke();

    const blocked = body + MapRules.MINION_BODY_RADIUS;
    drawReach(blocked, s, "rgba(255,150,120,.55)", [5, 5]);
    drawReach(slotNumber(t, "attackRange", "turrets", CORE_DEFAULTS.turretRange),
      s, LINE_HI[t.type], [9, 6]);

    const dot = Math.min(MARKER_PX / s, body * 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, dot, 0, Geom.TAU);
    ctx.fillStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    ctx.fill();

    if (selected) {
      queueRingLabel(t, blocked, "lính không vào gần hơn");
      queueRingLabel(t, slotNumber(t, "attackRange", "turrets", CORE_DEFAULTS.turretRange),
        "tầm bắn");
    }
  }

  /** Vòng tròn có bán kính thật (điểm hồi sinh, bãi quái). */
  function drawCircleSlot(t, s, hot, selected) {
    const r = circleR(t);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Geom.TAU);
    ctx.fillStyle = hot ? FILL_HI[t.type] : FILL[t.type];
    ctx.fill();
    ctx.lineWidth = (selected ? 2.4 : 1.6) / s;
    ctx.strokeStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    if (t.type === "neutral") ctx.setLineDash([10 / s, 7 / s]);
    ctx.stroke();
    ctx.setLineDash([]);

    const c = MARKER_PX / s;
    ctx.beginPath();
    ctx.moveTo(-c, 0); ctx.lineTo(c, 0);
    ctx.moveTo(0, -c); ctx.lineTo(0, c);
    ctx.lineWidth = 1.4 / s;
    ctx.stroke();

    // Hai tầm của một bãi quái, vẽ riêng vì chúng trả lời hai câu khác nhau.
    //
    // Vòng nét đứt của chính slot là `r` — chỗ quái *đứng*, và cũng là cái
    // người ta kéo để chỉnh. Nó không nói gì về việc đứng gần tới đâu thì bị
    // đánh, hay bị đuổi tới đâu thì quái quay về, mà đó mới là hai thứ quyết
    // định đặt bãi ở đâu cho an toàn.
    //
    // **Tầm phát hiện chỉ vẽ khi map thật sự khai báo.** Không khai thì nó là
    // của *con quái* (`MonsterBody.aggroRange`, nằm trong pack), và editor
    // không đọc được pack — vẽ một con số bịa ra còn tệ hơn không vẽ gì.
    // Tầm đuổi thì luôn vẽ được: `max(r, aggroRange) + chaseMargin` là công
    // thức của `Monster.chaseLeashRange`, và cả hai vế đều có mặc định.
    if (t.type === "neutral") {
      const aggro = slotNumber(t, "aggroRange", "monsters", 0);
      const margin = slotNumber(t, "chaseMargin", "monsters", CORE_DEFAULTS.chaseMargin);
      const leash = Math.max(r, aggro) + margin;
      drawReach(aggro, s, "rgba(255,196,92,.75)", [4, 5]);
      drawReach(leash, s, "rgba(255,120,120,.6)", [12, 8]);
      if (selected) {
        if (aggro > 0) queueRingLabel(t, aggro, "tầm phát hiện");
        queueRingLabel(t, leash, "tầm đuổi");
      }
    }

    /**
     * Tầm mua đồ của bệ đá.
     *
     * `shopRange` là field duy nhất của bệ đá không nhìn thấy được: bán kính
     * bệ thì chính là cái vòng đang vẽ, hồi máu/mana là con số trong bảng, còn
     * "đứng tới đâu thì mở được shop" thì chỉ hiện ra khi vào trận mà đứng thử.
     * Mà đó lại đúng là thứ làm nên map "mua đồ ở giữa đường" — cái lý do
     * field này tồn tại.
     *
     * 0 nghĩa là "bằng đúng bệ" (`Fountain.shopRadius` resolve như vậy), nên
     * lúc đó không vẽ thêm gì: vẽ chồng một vòng nét đứt lên đúng đường viền
     * sẵn có chỉ làm người ta tưởng có hai thứ khác nhau.
     */
    if (t.type === "spawn") {
      const shop = slotNumber(t, "shopRange", "fountain", 0);
      if (shop > 0 && Math.round(shop) !== Math.round(r)) {
        drawReach(shop, s, "rgba(120,220,160,.7)", [7, 5]);
        if (selected) queueRingLabel(t, shop, "tầm mua đồ");
      }
    }

    // Bãi quái có thể xoay bố cục quái bên trong — vẽ kim chỉ hướng.
    if (t.type === "neutral" && t.props && t.props.rotationDeg) {
      const a = (t.props.rotationDeg * Math.PI) / 180 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.strokeStyle = LINE_HI[t.type];
      ctx.lineWidth = 1.6 / s;
      ctx.stroke();
    }
  }

  /**
   * Lane: đường gấp khúc mở, mũi tên vẽ HAI CHIỀU.
   *
   * Một LaneDefinition phục vụ cả hai phe — core tự đảo danh sách waypoint
   * cho phe thứ hai — nên mũi tên một chiều là nói dối. Hai đầu được tô theo
   * màu của phe xuất phát ở đầu đó, đấy mới là thông tin thật: ai đi từ đâu.
   */
  function drawLane(t, s, hot, selected) {
    const pts = t.polygon;
    if (pts.length < 2) return;
    const p = t.props || {};

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    ctx.lineWidth = (selected ? 3.4 : 2.4) / s;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const a = MARKER_PX / s;
    const head = (mx, my, ux, uy) => {
      ctx.beginPath();
      ctx.moveTo(mx + ux * a * 0.8, my + uy * a * 0.8);
      ctx.lineTo(mx - ux * a * 0.35 - uy * a * 0.42, my - uy * a * 0.35 + ux * a * 0.42);
      ctx.lineTo(mx - ux * a * 0.35 + uy * a * 0.42, my - uy * a * 0.35 - ux * a * 0.42);
      ctx.closePath();
      ctx.fill();
    };

    ctx.fillStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      const len = Math.hypot(dx, dy);
      if (len < a * 4) continue;                       // đoạn ngắn quá thì bỏ
      const mx = (pts[i][0] + pts[i - 1][0]) / 2, my = (pts[i][1] + pts[i - 1][1]) / 2;
      const ux = dx / len, uy = dy / len;
      head(mx + ux * a * 0.55, my + uy * a * 0.55, ux, uy);
      head(mx - ux * a * 0.55, my - uy * a * 0.55, -ux, -uy);
    }

    // Hai đầu: phe nào xuất phát ở đầu nào.
    const ends = [[pts[0], p.from], [pts[pts.length - 1], p.to]];
    for (const [q, faction] of ends) {
      ctx.beginPath();
      ctx.arc(q[0], q[1], a * 0.62, 0, Geom.TAU);
      ctx.fillStyle = factionColor(faction);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 1.6 / s;
      ctx.stroke();
    }
  }

  function drawTerrains(s) {
    const lw = 1.6 / s;
    let drawn = 0;

    for (let i = 0; i < E.terrains.length; i++) {
      const t = E.terrains[i];
      if (!E.visible[t.type]) continue;
      const b = t._bbox || refreshTerrain(t)._bbox;
      if (!Geom.rectsOverlap(b, view)) continue;

      const selected = Sel.has(t);
      const hot = selected || E.hover === t;
      const shape = KIND[t.type].shape;
      drawn++;

      ctx.save();
      // Đang sửa đỉnh thì mọi hình khác mờ đi: nhìn là biết ngay cử chỉ kéo
      // lúc này nhắm vào đỉnh chứ không phải vào các hình đó.
      if (E.editing && t !== E.editing) ctx.globalAlpha = 0.4;
      ctx.translate(t.position[0], t.position[1]);

      if (shape === "circle") {
        drawCircleSlot(t, s, hot, selected);
      } else if (shape === "point") {
        if (t.type === "structure") drawTurret(t, s, hot, selected);
        else drawMarker(t, s, hot, selected);
      } else if (shape === "line") {
        drawLane(t, s, hot, selected);
      } else if (t.polygon.length >= 3) {
        const path = pathFor(t);
        ctx.fillStyle = hot ? FILL_HI[t.type] : FILL[t.type];
        ctx.fill(path);
        ctx.strokeStyle = hot ? LINE_HI[t.type] : LINE[t.type];
        ctx.lineWidth = (selected ? 2.4 : 1.6) / s;
        ctx.lineJoin = "round";
        ctx.stroke(path);

        // Khi chọn: lộ các mảnh lồi mà game sẽ nhận được sau khi export.
        if (selected && t.polygons.length > 1) {
          ctx.beginPath();
          for (const poly of t.polygons) {
            if (poly.length < 2) continue;
            ctx.moveTo(poly[0][0], poly[0][1]);
            for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k][0], poly[k][1]);
            ctx.closePath();
          }
          ctx.strokeStyle = C.piece;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
      } else if (t.polygon.length) {
        ctx.beginPath();
        ctx.moveTo(t.polygon[0][0], t.polygon[0][1]);
        for (let k = 1; k < t.polygon.length; k++) ctx.lineTo(t.polygon[k][0], t.polygon[k][1]);
        ctx.strokeStyle = LINE_HI[t.type];
        ctx.lineWidth = 2 / s;
        ctx.stroke();
      }

      ctx.restore();
      ctx.globalAlpha = 1;

      if (shape !== "poly") {
        const lab = shape === "line"
          ? (t.polygon.length ? [t.polygon[0][0] + t.position[0], t.polygon[0][1] + t.position[1]] : t.position)
          : t.position;
        const off =
          shape === "circle" ? circleR(t) * s + 5
          : t.type === "structure" ? Math.max(turretBodyR(t) * s, MARKER_PX) + 5
          : MARKER_PX + 5;
        queueLabel(t, lab[0], lab[1], off);
      }
    }
    return drawn;
  }

  /* --------------------- viền chọn / tay cầm ------------------------- */

  function drawSelectionChrome(s) {
    if (E.selection.length === 0) return;

    // Khung bao khi chọn nhiều — cho biết nhóm đang thao tác gồm những gì.
    if (E.selection.length > 1) {
      const b = Sel.bounds();
      const pad = 8 / s;
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.2 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.strokeRect(b[0] - pad, b[1] - pad, b[2] - b[0] + pad * 2, b[3] - b[1] + pad * 2);
      ctx.setLineDash([]);
    }

    const host = vertexHost();
    for (const t of E.selection) {
      if (isMarker(t)) {
        const r =
          (KIND[t.type].shape === "circle" ? circleR(t)
           : t.type === "structure" ? Math.max(turretBodyR(t), MARKER_PX / s)
           : MARKER_PX / s) + 7 / s;
        ctx.beginPath();
        ctx.arc(t.position[0], t.position[1], r, 0, Geom.TAU);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1.4 / s;
        ctx.stroke();
        continue;
      }
      // Chỉ hiện tay cầm đỉnh cho hình đang sửa (hoặc hình duy nhất đang
      // chọn) — chọn nhiều thì màn hình đầy chấm mà chẳng thao tác được gì.
      if (t !== host) continue;

      const r = (E.editing === t ? 5.2 : 4.6) / s;
      const ox = t.position[0], oy = t.position[1];
      for (let i = 0; i < t.polygon.length; i++) {
        const pt = t.polygon[i];
        const x = pt[0] + ox;
        const y = pt[1] + oy;
        const picked = E.editing === t && E.vertexSel.has(pt);
        const hot =
          (E.hoverVertex && E.hoverVertex.t === t && E.hoverVertex.i === i) ||
          (E.dragVertex && E.dragVertex.t === t && E.dragVertex.i === i);

        ctx.beginPath();
        ctx.arc(x, y, picked || hot ? r * 1.55 : r, 0, Geom.TAU);
        ctx.fillStyle = picked ? C.accent : hot ? C.vertexHot : C.vertex;
        ctx.fill();
        ctx.strokeStyle = picked ? "#fff" : "rgba(0,0,0,.6)";
        ctx.lineWidth = (picked ? 1.6 : 1) / s;
        ctx.stroke();
      }

      // tâm polygon
      ctx.beginPath();
      ctx.arc(ox, oy, 3 / s, 0, Geom.TAU);
      ctx.fillStyle = C.accent;
      ctx.fill();

      if (E.showVertexIndex) drawVertexIndices(t);
    }
  }

  function drawVertexIndices(t) {
    ctx.save();
    ctx.setTransform(E.view.dpr, 0, 0, E.view.dpr, 0, 0);
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let i = 0; i < t.polygon.length; i++) {
      Cam.toScreen(t.polygon[i][0] + t.position[0], t.polygon[i][1] + t.position[1], tmp);
      if (tmp[0] < -20 || tmp[0] > E.view.w + 20 || tmp[1] < -20 || tmp[1] > E.view.h + 20) continue;
      ctx.fillText(String(i), tmp[0], tmp[1] - 8);
    }
    ctx.restore();
  }

  /* ------------------------ vẽ polygon tự do ------------------------- */

  function drawPen(s) {
    if (!E.pen || !E.pen.pts.length) return;
    const pts = E.pen.pts;

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (E.pointerOnCanvas) ctx.lineTo(E.mouse[0], E.mouse[1]);
    ctx.strokeStyle = C.pen;
    ctx.lineWidth = 1.8 / s;
    ctx.setLineDash([7 / s, 5 / s]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (pts.length > 1 && E.pen.shape !== "line") {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,209,102,.10)";
      ctx.fill();
    }

    const r = 4.5 / s;
    for (let i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], i === 0 ? r * 1.5 : r, 0, Geom.TAU);
      ctx.fillStyle = i === 0 ? "#fff" : C.pen;
      ctx.fill();
    }
  }

  function drawDummy() {
    const img = E.images.dummy;
    const r = 60;
    const x = Cam.x, y = Cam.y;
    if (img) {
      ctx.drawImage(img, x - r / 2, y - r / 2, r, r);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r / 2, 0, Geom.TAU);
      ctx.fillStyle = "rgba(255,255,255,.5)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r / 2, 0, Geom.TAU);
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 1.4 / Cam.scale;
    ctx.stroke();
  }

  /* --------------------------- kéo chọn vùng ------------------------- */

  function drawMarquee() {
    if (!E.marquee) return;
    const m = E.marquee;
    Cam.toScreen(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), tmp);
    const x = tmp[0], y = tmp[1];
    const w = Math.abs(m.x1 - m.x0) * Cam.scale;
    const h = Math.abs(m.y1 - m.y0) * Cam.scale;

    const onVerts = m.vertices;
    ctx.fillStyle = onVerts ? "rgba(255,209,102,.12)" : C.marquee;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = onVerts ? C.vertex : C.marqueeLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

  /* ----------------------------- minimap ----------------------------- */

  function drawMinimap() {
    // Kích thước thật chỉ biết được khi thẻ minimap đang hiện, nên chỉnh ở
    // đây thay vì trong resize() (lúc ẩn thì clientWidth = 0).
    const dpr = E.view.dpr;
    const size = mini.clientWidth || 172;
    if (mini.width !== Math.round(size * dpr)) {
      mini.width = Math.round(size * dpr);
      mini.height = Math.round(size * dpr);
    }
    const [mw, mh] = E.mapSize;
    const k = Math.min(size / mw, size / mh) * 0.94;
    const offX = (size - mw * k) / 2;
    const offY = (size - mh * k) / 2;

    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.fillStyle = "#0a0d12";
    mctx.fillRect(0, 0, size, size);

    mctx.save();
    mctx.translate(offX, offY);
    mctx.scale(k, k);

    if (E.showBg && E.images.bg) {
      mctx.globalAlpha = 0.7;
      try { mctx.drawImage(E.images.bg, 0, 0, mw, mh); } catch (e) { }
      mctx.globalAlpha = 1;
    } else {
      mctx.fillStyle = "#101720";
      mctx.fillRect(0, 0, mw, mh);
    }

    for (const t of E.terrains) {
      if (!E.visible[t.type]) continue;
      mctx.fillStyle = FILL_HI[t.type];
      const shape = KIND[t.type].shape;
      if (shape === "circle" || shape === "point") {
        mctx.beginPath();
        // Trụ vẽ đúng thân của nó; điểm gom lính không có bán kính thật nên
        // giữ con số cũ để còn thấy được ở cỡ minimap.
        mctx.arc(t.position[0], t.position[1],
          shape === "circle" ? circleR(t) : t.type === "structure" ? turretBodyR(t) : 90,
          0, Geom.TAU);
        mctx.fill();
      } else if (shape === "line") {
        if (t.polygon.length >= 2) {
          mctx.save();
          mctx.translate(t.position[0], t.position[1]);
          mctx.beginPath();
          mctx.moveTo(t.polygon[0][0], t.polygon[0][1]);
          for (let i = 1; i < t.polygon.length; i++) mctx.lineTo(t.polygon[i][0], t.polygon[i][1]);
          mctx.strokeStyle = LINE_HI[t.type];
          mctx.lineWidth = 26;
          mctx.stroke();
          mctx.restore();
        }
      } else if (t.polygon.length >= 3) {
        mctx.save();
        mctx.translate(t.position[0], t.position[1]);
        mctx.fill(pathFor(t));
        mctx.restore();
      }
    }
    mctx.restore();

    // khung nhìn hiện tại
    Cam.viewRect(0, view);
    mctx.strokeStyle = "rgba(41,211,196,.9)";
    mctx.lineWidth = 1.4;
    mctx.strokeRect(
      offX + view[0] * k,
      offY + view[1] * k,
      (view[2] - view[0]) * k,
      (view[3] - view[1]) * k
    );
  }

  /** Đổi vị trí click trên minimap thành toạ độ world (để nhảy camera). */
  function minimapToWorld(px, py) {
    const size = mini.clientWidth || 172;
    const [mw, mh] = E.mapSize;
    const k = Math.min(size / mw, size / mh) * 0.94;
    return [(px - (size - mw * k) / 2) / k, (py - (size - mh * k) / 2) / k];
  }

  return { init, resize, minimapToWorld, get fps() { return fps; } };
})();
