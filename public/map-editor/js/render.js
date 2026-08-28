/* =========================================================================
   render.js — vẽ bằng Canvas2D thuần (không còn p5.js).

   Vẽ theo yêu cầu: không có vòng lặp 60fps chạy suốt. Mỗi thay đổi gọi
   requestRender(); khi camera đang trượt mượt thì tự lên lịch frame kế tiếp
   rồi dừng hẳn. Máy đứng yên = 0% CPU, điện thoại không nóng.
   ========================================================================= */

let requestRender = () => { };

const Renderer = (() => {
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

    requestRender = () => {
      if (!rafId) rafId = requestAnimationFrame(frame);
    };

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
    if (!settled) requestRender();
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

    ctx.restore();

    drawLabels();
    if (E.showGrid) drawGridLabels(s);
    drawMarquee();
    if (E.showMinimap) drawMinimap();

    UI.syncStatus(fps);
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

  /** Điểm đánh dấu (trụ, điểm lính): cỡ cố định theo màn hình nên zoom mức
   *  nào cũng thấy và bấm trúng. */
  function drawMarker(t, s, hot, selected) {
    const r = MARKER_PX / s;
    ctx.lineWidth = (selected ? 2.2 : 1.6) / s;
    ctx.strokeStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    ctx.fillStyle = hot ? FILL_HI[t.type] : FILL[t.type];

    ctx.beginPath();
    if (t.type === "structure") {
      // hình vuông đứng — trụ
      ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
    } else {
      // hình thoi — điểm gom lính
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Geom.TAU);
    ctx.fillStyle = hot ? LINE_HI[t.type] : LINE[t.type];
    ctx.fill();
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
        drawMarker(t, s, hot, selected);
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
        const off = shape === "circle" ? circleR(t) * s + 5 : MARKER_PX + 5;
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
        const r = (KIND[t.type].shape === "circle" ? circleR(t) : MARKER_PX / s) + 7 / s;
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
        mctx.arc(t.position[0], t.position[1], shape === "circle" ? circleR(t) : 90, 0, Geom.TAU);
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
