/* =========================================================================
   input.js — chuột, touchpad, cảm ứng và bàn phím.

   Dùng Pointer Events cho tất cả: một đường code chạy chung cho chuột, ngón
   tay và bút. Nhờ vậy điện thoại có đủ mọi thao tác của máy tính, chỉ khác
   ở chỗ vùng chạm rộng hơn và một ngón trên nền trống thì kéo màn hình.
   ========================================================================= */

const Input = (() => {
  let cv;
  const ptrs = new Map();          // pointerId -> { x, y }
  let mode = null;                 // pan | drag | vertex | marquee | pinch
  let drag = null;
  let pinch = null;
  let spaceDown = false;
  let moved = false;
  let downAt = [0, 0];
  let cursorClass = "";

  const world = [0, 0];
  const HIT_MOVE = 4;              // px màn hình trước khi coi là "đã kéo"

  const hitRadius = () => (E.isTouch ? 24 : 13) / Cam.scale;
  const snapV = (v) => (E.snap ? Geom.snap(v, E.gridSize) : Math.round(v));

  const isTypingTarget = (t) =>
    t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

  const modalOpen = () => document.getElementById("modal-root").childElementCount > 0;

  /* ------------------------------ con trỏ ---------------------------- */

  function setCursor(cls) {
    if (cursorClass === cls) return;
    if (cursorClass) cv.classList.remove(cursorClass);
    if (cls) cv.classList.add(cls);
    cursorClass = cls;
  }

  function updateCursor() {
    if (mode === "pan" || mode === "pinch") return setCursor("c-grabbing");
    if (spaceDown || E.tool === "hand") return setCursor("c-grab");
    if (E.tool === "pen") return setCursor("c-cross");
    if (E.tool === "marquee") return setCursor("c-cross");
    if (mode === "drag" || mode === "vertex" || mode === "vertexGroup") return setCursor("c-move");
    if (E.editing) return setCursor(E.hoverVertex ? "c-move" : "c-cross");
    if (E.hoverVertex) return setCursor("c-move");
    if (E.hover) return setCursor("c-pointer");
    setCursor("");
  }

  /* ------------------------------- hover ----------------------------- */

  function updateHover() {
    const prevT = E.hover;
    const prevV = E.hoverVertex;

    E.hoverVertex = pickVertex(world[0], world[1], hitRadius());
    E.hover = E.editing ? E.editing : pickTerrain(world[0], world[1]);

    const changed =
      prevT !== E.hover ||
      (!!prevV !== !!E.hoverVertex) ||
      (prevV && E.hoverVertex && (prevV.t !== E.hoverVertex.t || prevV.i !== E.hoverVertex.i));
    if (changed) requestRender();
    updateCursor();
  }

  /* ---------------------------- pointer down -------------------------- */

  function onDown(e) {
    if (e.pointerType === "touch") E.isTouch = true;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    UI.closeSheet();

    if (ptrs.size === 2) { startPinch(); return; }
    if (ptrs.size > 2) return;

    if (document.activeElement && isTypingTarget(document.activeElement)) document.activeElement.blur();

    moved = false;
    downAt = [e.clientX, e.clientY];
    Cam.toWorld(e.clientX, e.clientY, world);
    E.mouse[0] = world[0];
    E.mouse[1] = world[1];

    const wantPan = e.button === 1 || e.button === 2 || spaceDown || E.tool === "hand";
    if (wantPan) { mode = "pan"; updateCursor(); return; }

    if (E.tool === "pen") { mode = "pen"; return; }
    if (E.tool === "marquee") { beginMarquee(e.shiftKey); return; }

    // --- công cụ chọn ---
    const v = pickVertex(world[0], world[1], hitRadius());

    if (E.editing) {
      // Trong chế độ sửa đỉnh, mọi cử chỉ nhắm vào ĐỈNH: chạm trúng dot thì
      // kéo cả cụm đang chọn, chạm ra ngoài thì quét chọn đỉnh.
      if (v) {
        const pt = v.t.polygon[v.i];
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          toggleVertex(pt);
          if (!E.vertexSel.has(pt)) { mode = null; return; }
        } else if (!E.vertexSel.has(pt)) {
          setVertexSel([pt]);
        }
        beginVertexDrag();
        return;
      }
      beginMarquee(e.shiftKey, true);
      return;
    }

    // Ngoài mode: chọn một hình rồi kéo thẳng một đỉnh — đường tắt cũ, giữ nguyên.
    if (v) {
      mode = "vertex";
      E.dragVertex = v;
      updateCursor();
      requestRender();
      return;
    }

    const t = pickTerrain(world[0], world[1]);
    if (t) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) {
        Sel.toggle(t);
        if (!Sel.has(t)) { mode = null; return; }
      } else if (!Sel.has(t)) {
        Sel.set([t]);
      }
      beginDrag();
      return;
    }

    if (!e.shiftKey) Sel.clear();
    // Trên cảm ứng, một ngón trên nền trống = kéo màn hình (tự nhiên hơn);
    // với chuột thì đó là quét chọn, còn kéo màn hình đã có Space/chuột giữa.
    if (E.isTouch && e.pointerType === "touch") { mode = "pan"; updateCursor(); }
    else beginMarquee(e.shiftKey);
  }

  function beginDrag() {
    mode = "drag";
    drag = {
      start: [world[0], world[1]],
      items: E.selection.map((t) => ({ t, px: t.position[0], py: t.position[1] })),
    };
    updateCursor();
  }

  function beginVertexDrag() {
    mode = "vertexGroup";
    drag = {
      start: [world[0], world[1]],
      items: [...E.vertexSel].map((p) => ({ p, x: p[0], y: p[1] })),
    };
    updateCursor();
    requestRender();
  }

  function beginMarquee(additive, vertices = false) {
    mode = "marquee";
    E.marquee = {
      x0: world[0], y0: world[1], x1: world[0], y1: world[1],
      additive, vertices,
      base: vertices ? [...E.vertexSel] : E.selection.slice(),
    };
    updateCursor();
    requestRender();
  }

  /* ---------------------------- pointer move -------------------------- */

  function onMove(e) {
    const p = ptrs.get(e.pointerId);
    const prevX = p ? p.x : e.clientX;
    const prevY = p ? p.y : e.clientY;
    if (p) { p.x = e.clientX; p.y = e.clientY; }

    if (mode === "pinch") { stepPinch(); return; }

    Cam.toWorld(e.clientX, e.clientY, world);
    E.mouse[0] = world[0];
    E.mouse[1] = world[1];
    E.pointerOnCanvas = true;

    if (!p && mode) return;

    if (mode && !moved) {
      if (Math.abs(e.clientX - downAt[0]) > HIT_MOVE || Math.abs(e.clientY - downAt[1]) > HIT_MOVE) moved = true;
    }

    switch (mode) {
      case "pan":
        // Tự tính delta thay vì dùng movementX: chính xác trên mọi trình
        // duyệt, kể cả khi pointer đang bị capture hay đang ở chế độ cảm ứng.
        Cam.panBy(e.clientX - prevX, e.clientY - prevY, true);
        requestRender();
        return;
      case "drag": {
        let dx = world[0] - drag.start[0];
        let dy = world[1] - drag.start[1];
        if (E.snap && drag.items.length) {
          const a = drag.items[0];
          dx = Geom.snap(a.px + dx, E.gridSize) - a.px;
          dy = Geom.snap(a.py + dy, E.gridSize) - a.py;
        }
        dx = Math.round(dx); dy = Math.round(dy);
        for (const it of drag.items) moveTerrainTo(it.t, it.px + dx, it.py + dy);
        UI.syncSelection();
        requestRender();
        return;
      }
      case "vertexGroup": {
        const t = E.editing;
        if (!t || !drag.items.length) return;
        let dx = world[0] - drag.start[0];
        let dy = world[1] - drag.start[1];
        if (E.snap && drag.items.length) {
          const a = drag.items[0];
          dx = Geom.snap(a.x + t.position[0] + dx, E.gridSize) - (a.x + t.position[0]);
          dy = Geom.snap(a.y + t.position[1] + dy, E.gridSize) - (a.y + t.position[1]);
        }
        dx = Math.round(dx); dy = Math.round(dy);
        for (const it of drag.items) { it.p[0] = it.x + dx; it.p[1] = it.y + dy; }
        markShapeDirty(t);
        requestRender();
        return;
      }
      case "vertex": {
        const { t, i } = E.dragVertex;
        t.polygon[i][0] = snapV(world[0]) - t.position[0];
        t.polygon[i][1] = snapV(world[1]) - t.position[1];
        markShapeDirty(t);
        requestRender();
        return;
      }
      case "marquee": {
        E.marquee.x1 = world[0];
        E.marquee.y1 = world[1];
        requestRender();
        return;
      }
      case "pen":
        // Kéo tay khi đang cầm bút = di chuyển khung nhìn.
        if (moved) { mode = "pan"; updateCursor(); }
        requestRender();
        return;
    }

    // Rê chuột không bấm: chỉ vẽ lại khi thật sự có gì đổi, còn toạ độ ở
    // thanh trạng thái thì cập nhật thẳng vào DOM — khỏi tốn một frame.
    updateHover();
    if (E.pen) requestRender();
    UI.syncStatus();
  }

  /* ----------------------------- pointer up --------------------------- */

  function onUp(e) {
    ptrs.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { }

    if (mode === "pinch") {
      if (ptrs.size === 1) {
        // Còn một ngón: chuyển mượt sang kéo màn hình thay vì dừng khựng.
        const only = ptrs.values().next().value;
        mode = "pan";
        moved = true;
        downAt = [only.x, only.y];
        pinch = null;
      } else if (ptrs.size === 0) {
        mode = null;
        pinch = null;
      }
      updateCursor();
      return;
    }

    switch (mode) {
      case "drag":
        if (moved) commit();
        break;
      case "vertex":
        refreshTerrain(E.dragVertex.t);
        E.dragVertex = null;
        commit();
        break;
      case "vertexGroup":
        if (moved && E.editing) { refreshTerrain(E.editing); commit(); }
        break;
      case "marquee": {
        const m = E.marquee;
        if (m) {
          const rect = [
            Math.min(m.x0, m.x1), Math.min(m.y0, m.y1),
            Math.max(m.x0, m.x1), Math.max(m.y0, m.y1),
          ];
          if (moved && m.vertices && E.editing) {
            const found = pickVerticesInRect(E.editing, rect);
            setVertexSel(m.additive ? m.base.concat(found.filter((p) => m.base.indexOf(p) === -1)) : found);
            if (found.length) UI.toast(`Đã chọn ${E.vertexSel.size} đỉnh`);
          } else if (moved && !m.vertices) {
            const found = pickInRect(rect);
            Sel.set(m.additive ? m.base.concat(found.filter((t) => m.base.indexOf(t) === -1)) : found);
            if (found.length) UI.toast(`Đã chọn ${found.length} đối tượng`);
          }
        }
        E.marquee = null;
        break;
      }
      case "pen":
        if (!moved) penClick();
        break;
    }

    mode = null;
    drag = null;
    updateHover();
    requestRender();
  }

  function onCancel(e) {
    ptrs.delete(e.pointerId);
    if (mode === "marquee") E.marquee = null;
    if (mode === "vertex" && E.dragVertex) { refreshTerrain(E.dragVertex.t); E.dragVertex = null; }
    if (mode === "vertexGroup" && E.editing) refreshTerrain(E.editing);
    mode = null;
    drag = null;
    pinch = null;
    updateCursor();
    requestRender();
  }

  /* -------------------------------- pinch ----------------------------- */

  function twoPointers() {
    const it = ptrs.values();
    return [it.next().value, it.next().value];
  }

  function startPinch() {
    const [a, b] = twoPointers();
    if (!a || !b) return;
    // Bỏ dở thao tác một ngón đang làm giữa chừng.
    if (mode === "marquee") E.marquee = null;
    if (mode === "vertex" && E.dragVertex) { refreshTerrain(E.dragVertex.t); E.dragVertex = null; }
    if (mode === "vertexGroup" && E.editing) refreshTerrain(E.editing);
    mode = "pinch";
    drag = null;
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
    updateCursor();
  }

  function stepPinch() {
    const [a, b] = twoPointers();
    if (!a || !b || !pinch) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;

    Cam.zoomAt(cx, cy, dist / pinch.dist, true);
    Cam.panBy(cx - pinch.cx, cy - pinch.cy, true);

    pinch.dist = dist;
    pinch.cx = cx;
    pinch.cy = cy;
    requestRender();
  }

  /* --------------------------- công cụ vẽ pen ------------------------- */

  function penClick() {
    if (!E.pen) E.pen = { pts: [], kind: "wall", shape: "poly" };
    const x = snapV(world[0]), y = snapV(world[1]);
    const pts = E.pen.pts;

    // Chạm lại đỉnh đầu tiên = đóng hình (chỉ với polygon; lane là đường mở).
    if (E.pen.shape !== "line" && pts.length >= 3) {
      const d = Math.hypot(x - pts[0][0], y - pts[0][1]);
      if (d < hitRadius() * 1.6) { Cmd.finishPen(); return; }
    }
    pts.push([x, y]);
    requestRender();
  }

  /* ----------------------------- nháy đúp ----------------------------- */

  function onDblClick(e) {
    Cam.toWorld(e.clientX, e.clientY, world);
    const one = vertexHost();

    // Trên polygon đang chọn: chèn đỉnh mới đúng vào cạnh gần con trỏ nhất.
    if (one && hasVerts(one) && one.polygon.length >= 2) {
      const edge = Geom.nearestEdge(one.polygon, world[0], world[1], one.position[0], one.position[1], isLine(one));
      if (edge && edge.dist < hitRadius() * 2) {
        one.polygon.splice(edge.index, 0, [
          Math.round(snapV(edge.x) - one.position[0]),
          Math.round(snapV(edge.y) - one.position[1]),
        ]);
        refreshTerrain(one);
        commit();
        UI.toast("Đã chèn đỉnh");
        return;
      }
    }

    // Không trúng cạnh: nháy đúp lên một hình là vào thẳng chế độ sửa đỉnh,
    // giống Figma. Đây là đường tắt cho chuột; nút công cụ là đường cho cảm ứng.
    const t = pickTerrain(world[0], world[1]);
    if (t && hasVerts(t)) { enterEdit(t); UI.toast("Chế độ sửa đỉnh — Esc để thoát"); }
    else if (t) Sel.set([t]);
  }

  /* -------------------------------- wheel ----------------------------- */

  /**
   * Phân biệt con lăn chuột với touchpad: con lăn thật thường bắn ra bước
   * lớn (|deltaY| ≥ 100 hoặc deltaMode ≠ 0), còn touchpad cho giá trị nhỏ
   * liên tục và hay có cả deltaX. Người dùng vẫn ép được trong menu “…”.
   */
  function wheelIsZoom(e) {
    if (e.ctrlKey || e.metaKey) return true;          // pinch trên touchpad
    if (E.wheelMode === "zoom") return true;
    if (E.wheelMode === "pan") return false;
    if (e.deltaMode !== 0) return true;
    if (e.deltaX !== 0) return false;
    return Math.abs(e.deltaY) >= 100 && Number.isInteger(e.deltaY);
  }

  /**
   * Độ nhạy zoom, tách làm hai vì hai loại thiết bị bắn ra hai thang đo
   * hoàn toàn khác nhau:
   *   - con lăn chuột: từng nấc rời rạc, |deltaY| ≈ 100 (hoặc deltaMode ≠ 0);
   *   - touchpad (chụm hai ngón, hoặc cuộn khi ép chế độ zoom): liên tục,
   *     |deltaY| thường chỉ 2–15.
   * Dùng chung một hệ số thì hoặc con lăn giật cục, hoặc touchpad bò rất
   * chậm — nên mỗi loại một hệ số riêng.
   */
  const ZOOM_COARSE = 0.0018;   // một nấc con lăn ≈ 1.20×
  const ZOOM_FINE = 0.011;      // mỗi bước touchpad, cộng dồn ~60 lần/giây

  function zoomFactorFor(e, dy) {
    // ctrlKey là hệ điều hành nói thẳng "đây là cử chỉ chụm". Ngoài ra chỉ
    // khi người dùng ép chế độ "luôn zoom" mới phải đoán qua độ lớn bước
    // cuộn: con lăn chuột gần như luôn ≥ 100 (hoặc dùng deltaMode ≠ 0).
    const fine = e.ctrlKey || e.metaKey || (e.deltaMode === 0 && Math.abs(dy) < 40);
    const k = (fine ? ZOOM_FINE : ZOOM_COARSE) * E.zoomSpeed;
    return Geom.clamp(Math.exp(-dy * k), 0.2, 5);
  }

  function onWheel(e) {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const dy = e.deltaY * k;
    const dx = e.deltaX * k;

    if (wheelIsZoom(e)) {
      if (e.shiftKey && !e.ctrlKey) {
        Cam.panBy(-dy, 0, true);          // shift + lăn = cuộn ngang
      } else {
        Cam.zoomAt(e.clientX, e.clientY, zoomFactorFor(e, dy), true);
      }
    } else if (e.shiftKey) {
      Cam.panBy(-dy - dx, 0, true);
    } else {
      Cam.panBy(-dx, -dy, true);
    }

    Cam.toWorld(e.clientX, e.clientY, world);
    E.mouse[0] = world[0];
    E.mouse[1] = world[1];
    updateHover();
    requestRender();
  }

  /* ------------------------------ bàn phím ---------------------------- */

  function addVertexAtCursor() {
    const t = Sel.one;
    if (!t || !hasVerts(t)) return;
    const lx = Math.round(snapV(E.mouse[0]) - t.position[0]);
    const ly = Math.round(snapV(E.mouse[1]) - t.position[1]);
    if (t.polygon.length >= 2) {
      const edge = Geom.nearestEdge(t.polygon, E.mouse[0], E.mouse[1], t.position[0], t.position[1], isLine(t));
      // Lane: con trỏ ở ngoài hai đầu thì nối dài thêm chứ không chèn vào giữa.
      let at = edge ? edge.index : t.polygon.length;
      if (isLine(t) && edge) {
        const dFirst = Math.hypot(E.mouse[0] - (t.polygon[0][0] + t.position[0]), E.mouse[1] - (t.polygon[0][1] + t.position[1]));
        const last = t.polygon[t.polygon.length - 1];
        const dLast = Math.hypot(E.mouse[0] - (last[0] + t.position[0]), E.mouse[1] - (last[1] + t.position[1]));
        if (edge.dist > Math.min(dFirst, dLast)) at = dLast <= dFirst ? t.polygon.length : 0;
      }
      t.polygon.splice(at, 0, [lx, ly]);
    } else {
      t.polygon.push([lx, ly]);
    }
    refreshTerrain(t);
    commit();
  }

  function deleteVertexAtCursor() {
    const t = Sel.one;
    if (!t || !hasVerts(t)) return;
    const v = pickVertex(E.mouse[0], E.mouse[1], hitRadius());
    if (!v) return;
    const min = isLine(t) ? 2 : 3;
    if (t.polygon.length <= min) {
      UI.toast(`${isLine(t) ? "Lane" : "Polygon"} phải còn ít nhất ${min} đỉnh`, "warn");
      return;
    }
    t.polygon.splice(v.i, 1);
    E.hoverVertex = null;
    refreshTerrain(t);
    commit();
  }

  function onKeyDown(e) {
    if (isTypingTarget(e.target) || modalOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (k === " " && !spaceDown) {
      spaceDown = true;
      updateCursor();
      e.preventDefault();
      return;
    }

    if (mod) {
      switch (k.toLowerCase()) {
        case "z": e.preventDefault(); Cmd.run(e.shiftKey ? "edit.redo" : "edit.undo"); return;
        case "y": e.preventDefault(); Cmd.run("edit.redo"); return;
        case "a":
          e.preventDefault();
          Cmd.run(E.editing ? "vertex.selectAll" : "edit.selectAll");
          return;
        case "d": e.preventDefault(); Cmd.run("shape.duplicate"); return;
        case "s": e.preventDefault(); Cmd.run("file.save"); return;
        case "m": e.preventDefault(); Cmd.run("map.menu"); return;
        case "o": e.preventDefault(); Cmd.run("file.open"); return;
        case "e": e.preventDefault(); Cmd.run("file.exportGeometry"); return;
        case "i": e.preventDefault(); Cmd.run("file.import"); return;
        case "enter": e.preventDefault(); Cmd.run("file.playtest"); return;
        // KHÔNG preventDefault cho c/x/v: để trình duyệt bắn ra sự kiện
        // copy/cut/paste thật, nơi có sẵn dữ liệu clipboard.
        case "v": pasteInPlace = e.shiftKey; return;
        case "c": case "x": return;
      }
      return;
    }

    switch (k) {
      case "Escape":
        UI.closeSheet();
        e.preventDefault();
        // Thoát dần từng lớp: bỏ chọn đỉnh -> rời chế độ sửa đỉnh -> bỏ chọn hình.
        if (E.pen) Cmd.cancelPen();
        else if (E.editing && E.vertexSel.size) setVertexSel([]);
        else if (E.editing) exitEdit();
        else Sel.clear();
        return;
      case "Enter":
        if (E.pen) { Cmd.finishPen(); e.preventDefault(); }
        else if (vertexHost()) { e.preventDefault(); Cmd.run("tool.node"); }
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        // Trong chế độ sửa đỉnh, Delete nhắm vào đỉnh chứ không xoá cả hình.
        if (E.editing && E.vertexSel.size) Cmd.run("vertex.delete");
        else Cmd.run("shape.delete");
        return;
      case "Tab":
        e.preventDefault();
        Cmd.run("ui.inspector");
        return;
      case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown": {
        const onVertices = E.editing && E.vertexSel.size > 0;
        if (!onVertices && !E.selection.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = k === "ArrowLeft" ? [-step, 0] : k === "ArrowRight" ? [step, 0]
          : k === "ArrowUp" ? [0, -step] : [0, step];
        Cmd.run(onVertices ? "vertex.nudge" : "shape.nudge", d);
        return;
      }
      case "+": case "=": e.preventDefault(); Cmd.run("view.zoomIn"); return;
      case "-": case "_": e.preventDefault(); Cmd.run("view.zoomOut"); return;
      case "?": Cmd.run("help.shortcuts"); return;
    }

    switch (k.toLowerCase()) {
      case "v": Cmd.run(e.shiftKey ? "shape.flipV" : "tool.select"); break;
      case "m": Cmd.run("tool.marquee"); break;
      case "h": Cmd.run(e.shiftKey ? "shape.flipH" : "tool.hand"); break;
      case "p": Cmd.run("tool.pen"); break;
      case "c": if (e.shiftKey) Cmd.run("shape.recenter"); break;
      case "l": Cmd.run("tool.lane"); break;
      case "e": Cmd.run("tool.node"); break;
      case "n": Cmd.run("shape.add"); break;
      case "f": Cmd.run("view.fit"); break;
      case "g": Cmd.run(e.shiftKey ? "view.snap" : "view.grid"); break;
      case "a": addVertexAtCursor(); break;
      case "d": deleteVertexAtCursor(); break;
    }
  }

  function onKeyUp(e) {
    if (e.key === " ") {
      spaceDown = false;
      if (mode !== "pan") updateCursor();
    }
  }

  /* ---------------------- copy / cắt / dán ---------------------------- */

  /**
   * Bám vào sự kiện thật của trình duyệt thay vì tự bắt Ctrl+C/V: sự kiện
   * mang sẵn `clipboardData` nên không phải xin quyền clipboard, và người
   * dùng vẫn copy được chữ trong ô nhập như thường (ta nhường khi đang gõ).
   */
  let pasteInPlace = false;

  const clipboardBusy = (e) => isTypingTarget(e.target) || modalOpen();

  function onCopy(e) {
    if (clipboardBusy(e)) return;
    const text = Cmd.copyToText();
    if (!text) return;
    e.preventDefault();
    if (e.clipboardData) e.clipboardData.setData("text/plain", text);
    UI.toast(`Đã copy ${E.selection.length} đối tượng`);
  }

  function onCut(e) {
    if (clipboardBusy(e)) return;
    const n = E.selection.length;
    const text = Cmd.copyToText();
    if (!text) return;
    e.preventDefault();
    if (e.clipboardData) e.clipboardData.setData("text/plain", text);
    Cmd.deleteSelection();
    UI.toast(`Đã cắt ${n} đối tượng`);
  }

  function onPaste(e) {
    if (clipboardBusy(e)) return;
    const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || Cmd.readMemClip();
    if (!text) return;
    e.preventDefault();
    Cmd.pasteFromText(text, pasteInPlace);
    pasteInPlace = false;
  }

  /* ------------------------------ minimap ----------------------------- */

  function onMinimapDown(e) {
    const mini = document.getElementById("minimap");
    const r = mini.getBoundingClientRect();
    const [wx, wy] = Renderer.minimapToWorld(e.clientX - r.left, e.clientY - r.top);
    Cam.moveTo(wx, wy, null, false);
    requestRender();
    e.stopPropagation();
  }

  /* -------------------------------- gắn ------------------------------- */

  function init() {
    cv = document.getElementById("board");
    E.isTouch = window.matchMedia("(hover: none)").matches;

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onCancel);
    cv.addEventListener("pointerleave", () => { E.pointerOnCanvas = false; });
    cv.addEventListener("pointerenter", () => { E.pointerOnCanvas = true; });
    cv.addEventListener("dblclick", onDblClick);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());

    const mini = document.getElementById("minimap");
    mini.addEventListener("pointerdown", onMinimapDown);
    mini.addEventListener("pointermove", (e) => { if (e.buttons) onMinimapDown(e); });

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => { spaceDown = false; updateCursor(); });

    // Chặn zoom-nhấn-đúp của Safari trên iOS (nó phá thao tác chạm hai lần).
    document.addEventListener("gesturestart", (e) => e.preventDefault());
  }

  return { init, updateCursor };
})();
