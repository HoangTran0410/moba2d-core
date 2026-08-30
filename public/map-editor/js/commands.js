/* =========================================================================
   commands.js — mọi hành động của editor nằm trong một sổ đăng ký duy nhất.

   Thanh công cụ, menu tràn, phím tắt và bảng thuộc tính đều đọc từ đây, nên
   thêm một chức năng chỉ cần khai báo một lần là xuất hiện ở khắp nơi —
   và không bao giờ có chuyện nút bấm với phím tắt làm hai việc khác nhau.
   ========================================================================= */

const Cmd = (() => {
  const map = new Map();
  const def = (id, spec) => map.set(id, Object.assign({ id }, spec));

  const get = (id) => map.get(id);
  const run = (id, arg) => {
    const c = map.get(id);
    if (!c) return;
    if (c.isEnabled && !c.isEnabled()) return;
    return c.run(arg);
  };

  /* --------------------------- input ẩn cho file --------------------- */

  function pickFile(accept, onPick) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      if (input.files && input.files[0]) onPick(input.files[0]);
      input.remove();
    });
    input.click();
  }

  /* ------------------------------ tiện ích --------------------------- */

  const hasSel = () => E.selection.length > 0;

  function setTool(tool) {
    if (E.tool === tool) return;
    if (E.pen && tool !== "pen") cancelPen();
    E.tool = tool;
    E.marquee = null;
    UI.syncToolbar();
    requestRender();
  }

  /** Thêm polygon với kích thước hiển thị ổn định dù đang zoom mức nào. */
  function addPolygon(sides = 4, radiusPx = 110, kind = "wall") {
    const r = Geom.clamp(Math.round(radiusPx / Cam.scale), 12, 20000);
    const t = makeTerrain(kind, [Math.round(Cam.tx), Math.round(Cam.ty)], Geom.regularPolygon(sides, r));
    E.terrains.push(t);
    Sel.set([t]);
    commit();
    return t;
  }

  /**
   * Thêm một đối tượng bất kỳ vào giữa khung nhìn. Địa hình ra polygon, slot
   * ra một điểm, còn lane thì bật thẳng chế độ vẽ đường.
   */
  function addObject(kind) {
    if (!KIND[kind]) return null;
    if (KIND[kind].group === "lane") { startPen("lane"); return null; }
    if (KIND[kind].shape === "poly") return addPolygon(4, 110, kind);

    const t = makeTerrain(kind, [Math.round(Cam.tx), Math.round(Cam.ty)], []);
    E.terrains.push(t);
    Sel.set([t]);
    commit();
    UI.toast(`Đã thêm ${KIND[kind].label.toLowerCase()}`);
    return t;
  }

  function deleteSelection() {
    if (!hasSel()) return;
    const doomed = new Set(E.selection);
    E.terrains = E.terrains.filter((t) => !doomed.has(t));
    Sel.clear();
    commit();
  }

  function duplicateSelection() {
    if (!hasSel()) return;
    const offset = Math.round(40 / Cam.scale) || 20;
    const copies = E.selection.map((t) => {
      const c = makeTerrain(t.type, [t.position[0] + offset, t.position[1] + offset], t.polygon);
      return c;
    });
    E.terrains.push(...copies);
    Sel.set(copies);
    commit();
  }

  /**
   * Gộp các polygon dính cạnh lại — hỏi trước, và hoàn tác được như mọi
   * thay đổi khác.
   *
   * Cố ý KHÔNG tự chạy khi mở map. Map từ pack không mang `authoring` nên thứ
   * mở ra là dạng đã cắt lồi — Summoner's Rift là 329 mảnh cho 73 bức tường —
   * nhưng "map này trông như đã cắt" chỉ là suy đoán, và tự viết lại hình của
   * người khác dựa trên suy đoán là việc không nên làm. Map đã có `authoring`
   * thì vốn đang ở dạng người ta vẽ và lệnh này không có gì để làm.
   *
   * Có vùng chọn từ 2 polygon trở lên thì chỉ gộp trong đó; không thì cả map.
   */
  async function mergeSelection() {
    const useSel = E.selection.filter(isPoly).length >= 2;
    const scope = useSel ? E.selection.slice() : E.terrains.slice();
    const before = scope.filter(isPoly).length;
    if (before < 2) {
      UI.toast("Cần ít nhất 2 polygon để gộp");
      return;
    }

    const merged = mergeTerrains(scope);
    const after = merged.filter(isPoly).length;
    if (after >= before) {
      UI.alert({
        icon: "ok",
        title: "Không có gì để gộp",
        text: "Không tìm thấy polygon nào cùng loại mà dùng chung cạnh với nhau.",
      });
      return;
    }

    const ok = await UI.confirm({
      icon: "ask",
      title: "Gộp polygon dính nhau?",
      text:
        `${before} hình sẽ còn ${after}. Chỉ gộp trong cùng một loại — tường không ` +
        "bao giờ dính vào bụi — và hình nào quây quanh một khoảng trống thì giữ " +
        "nguyên, vì gộp lại sẽ lấp mất khoảng đó. Ctrl+Z hoàn tác được.",
      confirmText: "Gộp",
    });
    if (!ok) return;

    if (useSel) {
      const doomed = new Set(scope);
      E.terrains = E.terrains.filter((t) => !doomed.has(t)).concat(merged);
    } else {
      E.terrains = merged;
    }
    Sel.set(merged.filter(isPoly));
    commit();
    UI.toast(`Đã gộp ${before} hình còn ${after}`);
  }

  /**
   * Map đang mở có gộp được không? Nếu có thì mời một tiếng.
   *
   * Map từ pack đã được `Store.openPackMap` tự gộp rồi — ở đó thiếu
   * `authoring` là bằng chứng chắc chắn nó đang ở dạng đã cắt. Còn map mở từ
   * file, hay bản nháp của chính người dùng, thì không có bằng chứng nào như
   * vậy: các hình dính cạnh nhau có thể là cố ý. Nên chỗ này chỉ hỏi.
   *
   * Gọi sau khi mở map. Không tìm thấy gì thì im lặng — một gợi ý bật lên mỗi
   * lần mở map sẽ nhanh chóng thành thứ người ta học cách phớt lờ.
   */
  function offerMerge() {
    const before = E.terrains.filter(isPoly).length;
    if (before < 2) return;
    const after = mergeTerrains(E.terrains.slice()).filter(isPoly).length;
    if (after >= before) return;
    UI.suggest({
      text: `Map này có ${before} hình, gộp lại còn ${after} — nhiều mảnh đang dính cạnh nhau.`,
      actionLabel: "Gộp lại",
      onAction: () => Cmd.run("shape.merge"),
    });
  }

  /**
   * Đổi loại chỉ trong cùng một nhóm: địa hình ↔ địa hình, slot ↔ slot. Biến
   * một polygon thành điểm hồi sinh thì mất sạch hình, nên chặn luôn.
   */
  function setType(type) {
    if (!hasSel() || !KIND[type]) return;
    const group = KIND[type].group;
    const bad = E.selection.filter((t) => KIND[t.type].group !== group);
    if (bad.length) {
      UI.toast("Chỉ đổi được trong cùng nhóm (địa hình / slot)", "warn");
      return;
    }
    for (const t of E.selection) {
      t.type = type;
      t.props = withDefaults(type, t.props || {});
      refreshTerrain(t);
    }
    commit();
  }

  /** Sửa một thuộc tính của mọi đối tượng đang chọn. */
  /**
   * Ghi một giá trị vào `obj.a.b.c`, tự tạo các tầng trên đường đi.
   *
   * Xoá thì phải **dọn ngược lên**: một `stats: {}` còn sót lại sau khi người
   * ta gõ vào rồi xoá đi sẽ đi thẳng vào bản export và ra tới validator của
   * core, nơi nó là một khối rỗng chẳng nói gì. Map không ghi đè gì phải
   * export ra y hệt như trước khi có tính năng này.
   */
  function setDeep(root, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const chain = [root];
    let node = root;
    for (const k of keys) {
      if (!node[k] || typeof node[k] !== "object") {
        if (value === "" || value == null) return;
        node[k] = {};
      }
      node = node[k];
      chain.push(node);
    }
    if (value === "" || value == null) delete node[last];
    else node[last] = value;

    for (let i = chain.length - 1; i > 0; i--) {
      if (Object.keys(chain[i]).length) break;
      delete chain[i - 1][keys[i - 1]];
    }
  }

  function setProp(key, value) {
    if (!hasSel()) return;
    for (const t of E.selection) {
      if (!t.props) t.props = {};
      // Khoá có dấu chấm (`stats.damage`) là ghi đè theo slot — cùng một
      // đường ghi, cùng một lệnh undo được, chỉ khác chỗ đến.
      if (key.includes(".")) setDeep(t.props, key, value);
      else if (value === "" || value == null) delete t.props[key];
      else t.props[key] = value;
      t.props = withDefaults(t.type, t.props);
      refreshTerrain(t);
    }
    commit();
  }

  /**
   * Một ô trong "Cấu hình map" — `E.meta.tuning.<đường dẫn>`.
   *
   * Undo được như mọi thao tác khác trong editor: `commit()` là thứ đẩy trạng
   * thái vào lịch sử, và một panel cấu hình không undo được sẽ là chỗ duy
   * nhất trong editor này mà Ctrl+Z không cứu được.
   */
  function setTuning(path, value) {
    if (!E.meta.tuning || typeof E.meta.tuning !== "object") {
      if (value === "" || value == null) return;
      E.meta.tuning = {};
    }
    setDeep(E.meta.tuning, path, value);
    if (!Object.keys(E.meta.tuning).length) delete E.meta.tuning;
    commit();
  }

  function setPos(pair) {
    const one = Sel.one;
    if (!one) {
      // Chọn nhiều: dời cả nhóm sao cho tâm nhóm về đúng toạ độ nhập vào.
      if (!hasSel()) return;
      const c = Sel.center();
      const dx = pair[0] == null ? 0 : pair[0] - c[0];
      const dy = pair[1] == null ? 0 : pair[1] - c[1];
      for (const t of E.selection) moveTerrainTo(t, Math.round(t.position[0] + dx), Math.round(t.position[1] + dy));
      commit();
      return;
    }
    moveTerrainTo(
      one,
      pair[0] == null ? one.position[0] : Math.round(pair[0]),
      pair[1] == null ? one.position[1] : Math.round(pair[1])
    );
    commit();
  }

  function rotateSelection(deg) {
    if (!hasSel() || !deg) return;
    if (E.selection.length === 1) {
      const t = E.selection[0];
      if (!hasVerts(t)) return;
      Geom.roundPoints(Geom.rotatePoints(t.polygon, deg, 0, 0));
      refreshTerrain(t);
    } else {
      const c = Sel.center();
      const r = (deg * Math.PI) / 180;
      const cos = Math.cos(r), sin = Math.sin(r);
      for (const t of E.selection) {
        const dx = t.position[0] - c[0], dy = t.position[1] - c[1];
        moveTerrainTo(t, Math.round(c[0] + dx * cos - dy * sin), Math.round(c[1] + dx * sin + dy * cos));
        if (hasVerts(t)) Geom.roundPoints(Geom.rotatePoints(t.polygon, deg, 0, 0));
        refreshTerrain(t);
      }
    }
    commit();
  }

  function scaleSelection(k) {
    if (!hasSel() || !Number.isFinite(k) || k <= 0 || k === 1) return;
    if (E.selection.length === 1) {
      const t = E.selection[0];
      if (!hasVerts(t)) { if (KIND[t.type].shape === "circle") setProp("r", Math.round(circleR(t) * k)); return; }
      Geom.roundPoints(Geom.scalePoints(t.polygon, k, 0, 0));
      refreshTerrain(t);
    } else {
      const c = Sel.center();
      for (const t of E.selection) {
        moveTerrainTo(t, Math.round(c[0] + (t.position[0] - c[0]) * k), Math.round(c[1] + (t.position[1] - c[1]) * k));
        if (hasVerts(t)) Geom.roundPoints(Geom.scalePoints(t.polygon, k, 0, 0));
        refreshTerrain(t);
      }
    }
    commit();
  }

  /**
   * Lật vùng chọn qua trục đứng ('h') hoặc trục ngang ('v') của chính nó.
   *
   * Trục luôn là tâm hộp bao của VÙNG CHỌN, nên một polygon lật tại chỗ (hộp
   * bao ánh xạ lên chính nó), còn chọn nhiều thì cả cụm đảo bên đồng thời mỗi
   * cái tự lật — đúng như Figma/Illustrator làm. Cùng một công thức cho cả
   * hai: điểm world x -> 2C - x, tức vị trí thành 2C - px và toạ độ local
   * thành -lx.
   */
  function flipSelection(axis) {
    if (!hasSel()) return;
    const b = Sel.bounds();
    if (!b) return;
    const horizontal = axis === "h";
    const c = horizontal ? (b[0] + b[2]) / 2 : (b[1] + b[3]) / 2;

    for (const t of E.selection) {
      moveTerrainTo(
        t,
        horizontal ? Math.round(2 * c - t.position[0]) : t.position[0],
        horizontal ? t.position[1] : Math.round(2 * c - t.position[1])
      );
      if (hasVerts(t)) Geom.roundPoints(Geom.flipPoints(t.polygon, axis));
      refreshTerrain(t);
    }
    commit();
  }

  /**
   * Dời GỐC của hình về trung bình các đỉnh, mà hình đứng yên tại chỗ trong
   * world: gốc cộng thêm (cx, cy) thì mọi đỉnh trừ đi đúng ngần ấy.
   *
   * Gốc là thứ vô hình cho tới khi nó lệch: nó là tâm xoay của hình (xoay một
   * mình quay quanh gốc), là cặp X/Y trong bảng thuộc tính, và là chấm xanh
   * giữa hình. Kéo đỉnh vài lượt là gốc trôi ra rìa, xoay một cái thấy hình
   * văng đi đâu mất.
   */
  function recenterSelection() {
    let changed = 0;
    for (const t of E.selection) {
      if (!hasVerts(t) || !t.polygon.length) continue;
      const m = Geom.meanPoint(t.polygon);
      const cx = Math.round(m[0]), cy = Math.round(m[1]);
      if (cx === 0 && cy === 0) continue;          // đã ở giữa rồi

      t.position[0] += cx;
      t.position[1] += cy;
      for (const p of t.polygon) { p[0] -= cx; p[1] -= cy; }
      refreshTerrain(t);
      changed++;
    }
    if (!changed) { UI.toast("Gốc đã ở giữa các đỉnh rồi"); return; }
    commit();
    UI.toast(`Đã căn tâm ${changed} hình`);
  }

  /** Độ lệch hiện tại của gốc so với trung bình các đỉnh (để hiện trong UI). */
  function centerOffset(t) {
    if (!t || !hasVerts(t) || !t.polygon.length) return null;
    const m = Geom.meanPoint(t.polygon);
    return [Math.round(m[0]), Math.round(m[1])];
  }

  /**
   * Scale TOÀN BỘ nội dung map quanh gốc (0,0) — không phải quanh tâm map.
   * Toạ độ map chạy từ 0 tới size, nên nhân quanh gốc là ánh xạ đúng
   * 0…12500 sang 0…6400, không lệch mép nào.
   *
   * Bán kính (spawn, bãi quái) và `scatter` dùng trung bình của hai hệ số:
   * một vòng tròn không co giãn lệch trục được.
   */
  function scaleMapContent(kx, ky) {
    const kr = (kx + ky) / 2;
    let flat = 0;
    for (const t of E.terrains) {
      t.position[0] = Math.round(t.position[0] * kx);
      t.position[1] = Math.round(t.position[1] * ky);
      if (hasVerts(t)) {
        for (const p of t.polygon) {
          p[0] = Math.round(p[0] * kx);
          p[1] = Math.round(p[1] * ky);
        }
      }
      const props = t.props;
      if (props) {
        if (props.r > 0) props.r = Math.max(1, Math.round(props.r * kr));
        if (props.scatter > 0) props.scatter = Math.max(1, Math.round(props.scatter * kr));
      }
      refreshTerrain(t);
      // Thu quá nhỏ thì làm tròn có thể ép các đỉnh chồng lên nhau.
      if (isPoly(t) && t.polygon.length >= 3 && Geom.area(t.polygon) < 1) flat++;
    }
    return flat;
  }

  /**
   * Đổi kích thước map. `scaleContent` = kéo cả nội dung theo cho khớp khung
   * mới; nếu không thì chỉ cái khung đổi, đồ vẽ nằm nguyên toạ độ cũ.
   */
  function resizeMap(w, h, scaleContent) {
    w = Geom.clamp(Math.round(w) || 0, 100, 200000);
    h = Geom.clamp(Math.round(h) || 0, 100, 200000);
    const [ow, oh] = E.mapSize;
    if (w === ow && h === oh) return false;

    let flat = 0;
    if (scaleContent && E.terrains.length) {
      const kx = w / ow, ky = h / oh;
      flat = scaleMapContent(kx, ky);
      // Kéo camera theo cùng hệ số để nhìn vào vẫn y như trước khi đổi.
      Cam.moveTo(Cam.tx * kx, Cam.ty * ky, Cam.tscale / kx, true);
    }

    E.mapSize = [w, h];
    commit();
    UI.syncAll();
    requestRender();

    UI.toast(scaleContent
      ? `Map ${ow}×${oh} → ${w}×${h}, đã scale ${E.terrains.length} đối tượng`
      : `Map ${ow}×${oh} → ${w}×${h} (giữ nguyên toạ độ)`);
    if (flat) {
      UI.toast(`${flat} polygon bị bẹt sau khi thu nhỏ — Ctrl+Z nếu không ưng`, "warn");
    }
    return true;
  }

  function reorder(toFront) {
    if (!hasSel()) return;
    const sel = new Set(E.selection);
    const rest = E.terrains.filter((t) => !sel.has(t));
    const moved = E.terrains.filter((t) => sel.has(t));
    E.terrains = toFront ? rest.concat(moved) : moved.concat(rest);
    commit();
  }

  /** Dịch vùng chọn bằng phím mũi tên. */
  function nudge(dx, dy) {
    if (!hasSel()) return;
    for (const t of E.selection) moveTerrainTo(t, t.position[0] + dx, t.position[1] + dy);
    commit();
  }

  /* ------------------------ copy / cắt / dán -------------------------- */

  /**
   * Clipboard dùng ĐÚNG sự kiện copy/cut/paste của trình duyệt, không phải
   * `navigator.clipboard.readText()` — sự kiện thật mang sẵn dữ liệu nên
   * không phải xin quyền, và dán qua lại giữa hai tab editor cũng chạy.
   * `memClip` chỉ là phao cứu sinh cho lúc trình duyệt chặn clipboard.
   */
  const CLIP_TAG = "moba2d-mapeditor-clip";
  let memClip = null;

  function clipPayload() {
    if (!E.selection.length) return null;
    return JSON.stringify({
      [CLIP_TAG]: 1,
      factions: E.meta.factions,
      terrains: serializeTerrains(E.selection),
    });
  }

  /** Trả về text đã copy, hoặc null nếu không có gì để copy. */
  function copyToText() {
    const text = clipPayload();
    if (!text) return null;
    memClip = text;
    return text;
  }

  /**
   * Dán. `inPlace` = giữ nguyên toạ độ gốc (tiện khi chuyển đồ giữa hai map);
   * mặc định thì cả cụm được dời sao cho tâm rơi vào con trỏ.
   */
  function pasteFromText(text, inPlace) {
    if (!text) { UI.toast("Clipboard trống", "warn"); return false; }

    let raws = null, factions = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed[CLIP_TAG] && Array.isArray(parsed.terrains)) {
        raws = parsed.terrains;
        factions = Array.isArray(parsed.factions) ? parsed.factions : null;
      }
    } catch (err) { /* không phải clip của editor */ }

    if (!raws) {
      // Không phải clip của mình thì thử bộ đọc JSON dùng chung: dán thẳng
      // MapGeometry hay bản export vào canvas cũng gộp được vào map đang mở.
      try {
        const doc = Store.parseMapJSON(text, "Dán vào");
        return Store.importParsed(doc, "merge");
      } catch (err) {
        UI.toast("Clipboard không chứa dữ liệu map", "warn");
        return false;
      }
    }

    // Phe của nguồn phải có mặt, nếu không mọi slot dán sang thành mồ côi.
    if (factions) {
      for (const f of factions) if (!E.meta.factions.includes(f)) E.meta.factions.push(f);
    }

    // Bỏ id cũ: dán vào chính map nguồn mà giữ id thì thành trùng id.
    const added = raws.map((raw) => normalizeTerrain(Object.assign({}, raw, { id: undefined })));
    if (!added.length) return false;

    if (!inPlace) {
      const r = [Infinity, Infinity, -Infinity, -Infinity];
      for (const t of added) {
        const b = t._bbox;
        if (b[0] < r[0]) r[0] = b[0];
        if (b[1] < r[1]) r[1] = b[1];
        if (b[2] > r[2]) r[2] = b[2];
        if (b[3] > r[3]) r[3] = b[3];
      }
      const at = E.pointerOnCanvas ? E.mouse : [Cam.tx, Cam.ty];
      const dx = Math.round(at[0] - (r[0] + r[2]) / 2);
      const dy = Math.round(at[1] - (r[1] + r[3]) / 2);
      for (const t of added) moveTerrainTo(t, t.position[0] + dx, t.position[1] + dy);
    }

    E.terrains.push(...added);
    Sel.set(added);
    commit();
    UI.syncAll();
    UI.toast(`Đã dán ${added.length} đối tượng`);
    return true;
  }

  const readMemClip = () => memClip;

  /* ------------------------------ lane -------------------------------- */

  /**
   * Đảo chiều lane: waypoint chạy ngược lại và `from`/`to` đổi chỗ.
   *
   * KHÔNG tạo lane thứ hai. `getLaneWaypoints()` của core đã tự trả bản
   * `.reverse()` cho phe thứ hai rồi (src/game/lanes.ts), nên một
   * LaneDefinition phục vụ cả hai hướng — thêm một id nữa trên cùng con
   * đường sẽ khiến `MinionSpawner` (nó lặp qua MỌI id trong LANES) đẻ gấp
   * đôi số wave. Thứ thật sự cần là đổi xem ĐẦU NÀO là waypoint 0.
   */
  function reverseLanes() {
    const lanes = E.selection.filter((t) => t.type === "lane");
    if (!lanes.length) { UI.toast("Chọn một lane trước đã", "warn"); return; }
    for (const t of lanes) {
      t.polygon.reverse();
      const p = t.props || (t.props = {});
      const from = p.from;
      p.from = p.to;
      p.to = from;
      refreshTerrain(t);
    }
    commit();
    UI.syncAll();
    const p = lanes[0].props;
    UI.toast(lanes.length === 1
      ? `Lane “${p.id}” giờ đi ${p.from} → ${p.to}`
      : `Đã đảo chiều ${lanes.length} lane`);
  }

  /* --------------------------- sửa đỉnh ------------------------------ */

  function toggleNodeMode() {
    if (E.editing) { exitEdit(); return; }
    const t = vertexHost();
    if (!t) { UI.toast("Chọn một polygon hoặc lane trước đã", "warn"); return; }
    enterEdit(t);
    UI.toast("Chế độ sửa đỉnh — kéo để quét chọn nhiều đỉnh, Esc để thoát");
  }

  function deleteVertices() {
    const t = E.editing;
    if (!t || !E.vertexSel.size) return;
    const min = minVerts(t);
    const word = isLine(t) ? "waypoint" : "đỉnh";
    const keep = t.polygon.filter((p) => !E.vertexSel.has(p));
    if (keep.length < min) {
      UI.toast(`${isLine(t) ? "Lane" : "Polygon"} phải còn ít nhất ${min} ${word}`, "warn");
      return;
    }
    const n = t.polygon.length - keep.length;
    t.polygon = keep;
    E.vertexSel.clear();
    refreshTerrain(t);
    commit();
    UI.toast(`Đã xoá ${n} ${word}`);
  }

  function nudgeVertices(dx, dy) {
    const t = E.editing;
    if (!t || !E.vertexSel.size) return;
    for (const p of E.vertexSel) { p[0] += dx; p[1] += dy; }
    refreshTerrain(t);
    commit();
  }

  /* ----------------------------- công cụ vẽ -------------------------- */

  function startPen(kind = "wall") {
    E.pen = { pts: [], kind, shape: KIND[kind].shape };
    setTool("pen");
    requestRender();
    UI.toast(KIND[kind].shape === "line"
      ? "Nháy từng waypoint · Enter để xong · Esc huỷ"
      : `Vẽ ${KIND[kind].label.toLowerCase()} — nháy từng đỉnh, Enter/nháy đỉnh đầu để đóng`);
  }

  function cancelPen() {
    E.pen = null;
    requestRender();
  }

  /** Chốt polygon đang vẽ: đưa các đỉnh về toạ độ local quanh trọng tâm. */
  function finishPen() {
    if (!E.pen) return;
    const line = E.pen.shape === "line";
    const min = line ? 2 : 3;
    if (E.pen.pts.length < min) { cancelPen(); return; }

    const pts = E.pen.pts;
    const c = Geom.centroid(pts);
    const origin = [Math.round(c[0]), Math.round(c[1])];
    const kind = E.pen.kind || "wall";
    const t = makeTerrain(kind, origin, pts.map((p) => [p[0] - origin[0], p[1] - origin[1]]));
    E.terrains.push(t);
    E.pen = null;
    Sel.set([t]);
    setTool("select");
    commit();
    UI.toast(line ? `Đã tạo lane ${t.polygon.length} waypoint` : `Đã tạo polygon ${t.polygon.length} đỉnh`);
  }

  /* ------------------------------ zoom ------------------------------- */

  const zoomStep = (factor) => {
    Cam.zoomAt(E.view.w / 2, E.view.h / 2, factor, false);
    requestRender();
  };

  function fitView() {
    const b = hasSel() ? Sel.bounds() : (E.terrains.length ? allBounds() : [0, 0, E.mapSize[0], E.mapSize[1]]);
    Cam.fitRect(b, 110, false);
    requestRender();
  }

  function allBounds() {
    const r = [Infinity, Infinity, -Infinity, -Infinity];
    for (const t of E.terrains) {
      const b = t._bbox || refreshTerrain(t)._bbox;
      if (b[0] < r[0]) r[0] = b[0];
      if (b[1] < r[1]) r[1] = b[1];
      if (b[2] > r[2]) r[2] = b[2];
      if (b[3] > r[3]) r[3] = b[3];
    }
    return Number.isFinite(r[0]) ? r : [0, 0, E.mapSize[0], E.mapSize[1]];
  }

  /* ============================ đăng ký lệnh =========================== */

  def("tool.select", {
    label: "Chọn", icon: "cursor", keyHint: "V",
    isOn: () => E.tool === "select", run: () => setTool("select"),
  });
  def("tool.marquee", {
    label: "Quét chọn vùng", icon: "marquee", keyHint: "M",
    isOn: () => E.tool === "marquee", run: () => setTool("marquee"),
  });
  def("tool.hand", {
    label: "Kéo khung nhìn", icon: "hand", keyHint: "H",
    isOn: () => E.tool === "hand", run: () => setTool("hand"),
  });
  def("tool.pen", {
    label: "Vẽ polygon", icon: "pen", keyHint: "P",
    isOn: () => E.tool === "pen" && (!E.pen || E.pen.shape !== "line"),
    run: () => (E.pen ? finishPen() : startPen("wall")),
  });
  def("tool.lane", {
    label: "Vẽ lane", icon: "route", keyHint: "L",
    isOn: () => !!E.pen && E.pen.shape === "line",
    run: () => (E.pen && E.pen.shape === "line" ? finishPen() : startPen("lane")),
  });

  def("tool.node", {
    label: "Sửa đỉnh", icon: "nodes", keyHint: "E",
    isOn: () => !!E.editing,
    isEnabled: () => !!E.editing || !!vertexHost(),
    run: toggleNodeMode,
  });
  def("vertex.delete", {
    label: "Xoá đỉnh đang chọn", icon: "trash", danger: true,
    isEnabled: () => !!E.editing && E.vertexSel.size > 0,
    run: deleteVertices,
  });
  def("vertex.selectAll", {
    label: "Chọn tất cả đỉnh", icon: "marquee",
    isEnabled: () => !!E.editing,
    run: () => setVertexSel(E.editing.polygon),
  });
  def("vertex.nudge", {
    label: "Dịch đỉnh", icon: "target",
    isEnabled: () => !!E.editing && E.vertexSel.size > 0,
    run: (d) => nudgeVertices(d[0], d[1]),
  });

  def("shape.add", {
    label: "Thêm tường", icon: "square-plus", keyHint: "N",
    run: () => addPolygon(4, 110, "wall"),
  });
  def("shape.addCustom", {
    label: "Thêm polygon đều…", icon: "square-plus",
    run: async () => {
      const r = await UI.form({
        title: "Thêm polygon đều",
        fields: [
          { key: "sides", label: "Số đỉnh", type: "number", value: 6, min: 3, max: 64 },
          { key: "size", label: "Bán kính (đơn vị map)", type: "number", value: Math.round(120 / Cam.scale), min: 4 },
        ],
        confirmText: "Thêm",
      });
      if (!r) return;
      const sides = Geom.clamp(Math.round(r.sides) || 4, 3, 64);
      const t = makeTerrain("wall", [Math.round(Cam.tx), Math.round(Cam.ty)],
        Geom.regularPolygon(sides, Math.max(4, Math.round(r.size))));
      E.terrains.push(t);
      Sel.set([t]);
      commit();
    },
  });
  def("shape.duplicate", {
    label: "Nhân bản", icon: "copy", keyHint: "Ctrl+D",
    isEnabled: hasSel, run: duplicateSelection,
  });
  def("shape.delete", {
    label: "Xoá", icon: "trash", keyHint: "Del", danger: true,
    isEnabled: hasSel, run: deleteSelection,
  });
  def("shape.merge", {
    label: "Gộp polygon dính nhau", icon: "layers",
    isEnabled: () => E.terrains.filter(isPoly).length >= 2,
    run: mergeSelection,
  });
  def("shape.type", { label: "Đổi loại", icon: "check", run: setType });
  def("shape.prop", { label: "Đổi thuộc tính", icon: "settings", run: (a) => setProp(a[0], a[1]) });
  def("map.tuning", { label: "Đổi cấu hình map", icon: "settings", run: (a) => setTuning(a[0], a[1]) });

  /**
   * Đội hình wave hiện tại, dưới dạng bảng đếm theo id loại lính.
   *
   * Đọc từ `composition` chứ không lưu riêng một bảng đếm: mảng đó là thứ
   * thật sự được export và được engine đọc, nên một bảng đếm lưu song song
   * là hai nguồn sự thật cho cùng một điều.
   */
  function waveCounts() {
    const composition =
      (E.meta.tuning && E.meta.tuning.minions && E.meta.tuning.minions.waves &&
        E.meta.tuning.minions.waves.composition) || [];
    const counts = {};
    for (const id of composition) counts[id] = (counts[id] || 0) + 1;
    return counts;
  }
  def("map.tuningSeedMinions", {
    label: "Chép 3 loại lính mặc định", icon: "plus",
    run: () => {
      // `MinionTuning.types` thay hẳn bảng của core chứ không trộn vào, nên
      // map chỉ muốn sửa một con số vẫn phải khai đủ ba loại. Nút này là lý
      // do việc đó không phải là chép tay — số ở đây khớp `MinionPresets`.
      if (!E.meta.tuning) E.meta.tuning = {};
      if (!E.meta.tuning.minions) E.meta.tuning.minions = {};
      E.meta.tuning.minions.types = {
        melee: { name: "Lính Cận Chiến", style: "melee", speed: 2.6, size: 34, health: 140, damage: 5, attackInterval: 1100, attackRange: 40, aggroRange: 300 },
        ranged: { name: "Lính Phép Sư", style: "ranged", speed: 2.6, size: 30, health: 90, damage: 3, attackInterval: 1500, attackRange: 280, aggroRange: 340 },
        cannon: { name: "Lính Xe Pháo", style: "cannon", speed: 2.6, size: 38, health: 260, damage: 8, attackInterval: 1650, attackRange: 300, aggroRange: 360 },
      };
      commit();
    },
  });
  def("map.waveCount", {
    label: "Đổi số lính mỗi wave", icon: "settings",
    /**
     * Bao nhiêu con loại này trong một wave.
     *
     * `MinionTuning.waves.composition` là **một mảng id có thứ tự** —
     * `["melee","melee","melee","ranged","ranged","cannon"]` — chứ không phải
     * bảng đếm. Ô nhập ở đây là bảng đếm, vì đó mới là thứ người vẽ map nghĩ
     * trong đầu ("wave có mấy con cận chiến"), rồi hàm này dựng lại mảng theo
     * đúng thứ tự map khai loại lính.
     *
     * Đánh đổi có thật và có chủ ý: thứ tự trong mảng quyết định thứ tự **ra
     * quân**, nên viết tay mảng thì xen kẽ được (cận, xa, cận, xa…) còn ô đếm
     * thì luôn ra "hết cận rồi tới xa". Đổi lại là một cái bảng ai cũng điền
     * được, thay vì một ô chữ mà gõ sai một id là wave rỗng — xem
     * `MinionSpawner.spawn`, nó bỏ qua id lạ chứ không báo gì.
     */
    run: (a) => {
      const id = String((a && a[0]) || "").trim();
      if (!id) return;
      const count = Math.max(0, Math.floor(Number(a[1]) || 0));
      if (!E.meta.tuning) E.meta.tuning = {};
      if (!E.meta.tuning.minions) E.meta.tuning.minions = {};
      const minions = E.meta.tuning.minions;
      if (!minions.waves) minions.waves = {};

      const counts = waveCounts();
      counts[id] = count;
      // Theo thứ tự map khai loại lính, không theo thứ tự người ta bấm ô nào
      // trước: thứ tự đó mới là thứ nhìn thấy được trên màn hình.
      const composition = [];
      for (const typeId of Object.keys(minions.types || {})) {
        for (let i = 0; i < (counts[typeId] || 0); i++) composition.push(typeId);
      }

      // Không loại nào có con nào thì bỏ hẳn khai báo, để map quay về đội hình
      // của core — chứ không phải để lại một mảng rỗng, tức là wave không có
      // con lính nào và cũng chẳng có gì nói ra điều đó.
      if (composition.length) minions.waves.composition = composition;
      else delete minions.waves.composition;
      if (!Object.keys(minions.waves).length) delete minions.waves;
      commit();
    },
  });
  def("map.tuningAddMinion", {
    label: "Thêm loại lính", icon: "plus",
    run: (a) => {
      const id = String((a && a[0]) || "").trim();
      if (!id) return;
      if (!E.meta.tuning) E.meta.tuning = {};
      if (!E.meta.tuning.minions) E.meta.tuning.minions = {};
      if (!E.meta.tuning.minions.types) E.meta.tuning.minions.types = {};
      if (E.meta.tuning.minions.types[id]) return;
      E.meta.tuning.minions.types[id] = {
        name: id, style: "melee", speed: 2.6, size: 34,
        health: 140, damage: 5, attackInterval: 1100, attackRange: 40, aggroRange: 300,
      };
      commit();
    },
  });
  def("map.tuningResetGroup", {
    label: "Về mặc định", icon: "undo",
    run: (a) => {
      const group = a && a[0];
      if (!E.meta.tuning || !group || !E.meta.tuning[group]) return;
      delete E.meta.tuning[group];
      if (!Object.keys(E.meta.tuning).length) delete E.meta.tuning;
      commit();
    },
  });
  def("map.tuningRemoveMinion", {
    label: "Xoá loại lính", icon: "trash",
    run: (a) => {
      const id = a && a[0];
      const types = E.meta.tuning && E.meta.tuning.minions && E.meta.tuning.minions.types;
      if (!types || !types[id]) return;
      delete types[id];
      if (!Object.keys(types).length) delete E.meta.tuning.minions.types;
      if (!Object.keys(E.meta.tuning.minions).length) delete E.meta.tuning.minions;
      if (!Object.keys(E.meta.tuning).length) delete E.meta.tuning;
      commit();
    },
  });
  def("shape.addKind", { label: "Thêm đối tượng", icon: "plus", run: addObject });

  /** Menu “+” — mọi thứ có thể đặt lên map, gom theo nhóm của MapGeometry. */
  def("ui.addMenu", {
    label: "Thêm…", icon: "square-plus", keyHint: "N",
    run: (anchor) => {
      const item = (kind, extra) => Object.assign({
        icon: KIND[kind].shape === "line" ? "pen" : KIND[kind].shape === "poly" ? "square-plus" : "target",
        label: KIND[kind].label,
        run: () => addObject(kind),
      }, extra);
      UI.sheet(anchor || document.querySelector('[data-cmd="ui.addMenu"]'), [
        {
          title: "Địa hình", items: [
            item("wall", { shortcut: "N" }), item("bush"), item("water"),
            { icon: "pen", label: "Vẽ tự do…", shortcut: "P", run: () => startPen("wall") },
            { icon: "square-plus", label: "Đa giác đều…", run: () => run("shape.addCustom") },
          ],
        },
        { title: "Slot", items: SLOT_KINDS.map((k) => item(k)) },
        { title: "Lane", items: [item("lane", { shortcut: "L" })] },
      ]);
    },
  });
  def("shape.setPos", { label: "Đặt vị trí", icon: "target", run: setPos });
  def("shape.rotate", { label: "Xoay", icon: "rotate", isEnabled: hasSel, run: rotateSelection });
  def("shape.scale", { label: "Co giãn", icon: "scale", isEnabled: hasSel, run: scaleSelection });
  def("lane.reverse", {
    label: "Đảo chiều lane", icon: "reverse",
    isEnabled: () => E.selection.some((t) => t.type === "lane"),
    run: reverseLanes,
  });
  def("shape.recenter", {
    label: "Căn tâm", icon: "target", keyHint: "Shift+C",
    isEnabled: () => E.selection.some(hasVerts),
    run: recenterSelection,
  });
  def("shape.flipH", {
    label: "Lật ngang", icon: "flip-h", keyHint: "Shift+H",
    isEnabled: hasSel, run: () => flipSelection("h"),
  });
  def("shape.flipV", {
    label: "Lật dọc", icon: "flip-v", keyHint: "Shift+V",
    isEnabled: hasSel, run: () => flipSelection("v"),
  });
  def("shape.front", { label: "Đưa lên trước", icon: "front", isEnabled: hasSel, run: () => reorder(true) });
  def("shape.back", { label: "Đưa ra sau", icon: "back", isEnabled: hasSel, run: () => reorder(false) });
  def("shape.nudge", { label: "Dịch", icon: "target", isEnabled: hasSel, run: (d) => nudge(d[0], d[1]) });

  def("edit.undo", {
    label: "Hoàn tác", icon: "undo", keyHint: "Ctrl+Z",
    isEnabled: () => History.canUndo(),
    run: () => { if (History.undo()) { Store.scheduleSave(); UI.syncAll(); requestRender(); } },
  });
  def("edit.redo", {
    label: "Làm lại", icon: "redo", keyHint: "Ctrl+Shift+Z",
    isEnabled: () => History.canRedo(),
    run: () => { if (History.redo()) { Store.scheduleSave(); UI.syncAll(); requestRender(); } },
  });
  def("edit.copy", {
    label: "Copy", icon: "copy", keyHint: "Ctrl+C",
    isEnabled: hasSel,
    run: async () => {
      const text = copyToText();
      if (!text) return;
      try { await navigator.clipboard.writeText(text); } catch (e) { /* còn memClip */ }
      UI.toast(`Đã copy ${E.selection.length} đối tượng`);
    },
  });
  def("edit.cut", {
    label: "Cắt", icon: "trash", keyHint: "Ctrl+X",
    isEnabled: hasSel,
    run: async () => {
      const n = E.selection.length;
      const text = copyToText();
      if (!text) return;
      try { await navigator.clipboard.writeText(text); } catch (e) { }
      deleteSelection();
      UI.toast(`Đã cắt ${n} đối tượng`);
    },
  });
  def("edit.paste", {
    label: "Dán", icon: "import", keyHint: "Ctrl+V",
    run: async () => {
      let text = null;
      try { text = await navigator.clipboard.readText(); } catch (e) { }
      pasteFromText(text || memClip, false);
    },
  });
  def("edit.pasteInPlace", {
    label: "Dán tại chỗ (giữ toạ độ)", icon: "import", keyHint: "Ctrl+Shift+V",
    run: async () => {
      let text = null;
      try { text = await navigator.clipboard.readText(); } catch (e) { }
      pasteFromText(text || memClip, true);
    },
  });

  def("edit.selectAll", {
    label: "Chọn tất cả", icon: "marquee", keyHint: "Ctrl+A",
    run: () => Sel.all(),
  });
  def("edit.deselect", { label: "Bỏ chọn", icon: "x", keyHint: "Esc", run: () => Sel.clear() });

  def("view.grid", {
    label: "Lưới", icon: "grid", keyHint: "G",
    isOn: () => E.showGrid,
    run: () => { E.showGrid = !E.showGrid; Store.savePrefs(); UI.syncView(); requestRender(); },
  });
  def("view.snap", {
    label: "Hút vào lưới", icon: "magnet", keyHint: "Shift+G",
    isOn: () => E.snap,
    run: () => { E.snap = !E.snap; Store.savePrefs(); UI.syncView(); UI.toast(E.snap ? "Bật hút lưới" : "Tắt hút lưới"); },
  });
  def("view.bg", {
    label: "Ảnh nền", icon: "image",
    isOn: () => E.showBg,
    run: () => {
      if (!E.images.bg && !E.background) { run("view.bgUpload"); return; }
      E.showBg = !E.showBg;
      UI.syncView();
      requestRender();
    },
  });
  def("view.bgUpload", {
    label: "Tải ảnh nền…", icon: "image",
    run: () => pickFile("image/*", (f) => Store.importBackgroundFile(f)),
  });
  def("view.minimap", {
    label: "Minimap", icon: "map",
    isOn: () => E.showMinimap,
    run: () => { E.showMinimap = !E.showMinimap; Store.savePrefs(); UI.syncView(); requestRender(); },
  });
  def("view.dummy", {
    label: "Tướng mẫu", icon: "user",
    isOn: () => E.showDummy,
    run: () => { E.showDummy = !E.showDummy; Store.savePrefs(); UI.syncView(); requestRender(); },
  });
  def("view.zoomIn", { label: "Phóng to", icon: "zoom-in", keyHint: "+", run: () => zoomStep(1.25) });
  def("view.zoomOut", { label: "Thu nhỏ", icon: "zoom-out", keyHint: "−", run: () => zoomStep(1 / 1.25) });
  def("view.zoomReset", { label: "Về 100%", icon: "target", run: () => { Cam.moveTo(Cam.tx, Cam.ty, 1, false); requestRender(); } });
  def("view.fit", { label: "Vừa màn hình", icon: "fit", keyHint: "F", run: fitView });
  def("view.resetCamera", {
    label: "Xem toàn map", icon: "target",
    run: () => { Cam.fitRect([0, 0, E.mapSize[0], E.mapSize[1]], 110, false); requestRender(); },
  });

  def("file.save", {
    label: "Lưu file", icon: "save", keyHint: "Ctrl+S",
    run: () => { Store.saveNow(); Store.saveToFile(); },
  });
  def("file.open", {
    label: "Mở file", icon: "folder",
    run: () => pickFile(".json,application/json", (f) => Store.importMapFile(f)),
  });
  def("file.import", {
    label: "Nhập JSON", icon: "import", keyHint: "Ctrl+I",
    run: (arg) => UI.importDialog(typeof arg === "string" ? arg : null),
  });
  /**
   * Về game mà KHÔNG bắt đầu trận nào.
   *
   * Khác hẳn "Chơi thử" bên cạnh, và trước đây editor chỉ có mỗi cái đó —
   * nghĩa là đường duy nhất quay lại game là bắt đầu một trận đấu, còn ai chỉ
   * muốn về menu thì phải bấm nút Back của trình duyệt. Một cửa vào thì phải
   * có một cửa ra ngang hàng với nó.
   *
   * Lưu trước khi đi: điều hướng ra khỏi trang thì autosave đang hẹn giờ chưa
   * chắc kịp chạy.
   */
  def("file.backToGame", {
    label: "Về game", icon: "arrow-left", showLabel: true,
    run: () => {
      Store.flush();
      window.location.href = "../index.html";
    },
  });
  def("file.playtest", {
    label: "Chơi thử", icon: "play", keyHint: "Ctrl+Enter", showLabel: true,
    run: () => UI.playtest(),
  });
  def("file.exportGeometry", {
    label: "Export cho moba2d", icon: "code", keyHint: "Ctrl+E",
    run: () => UI.exportMoba2d(),
  });
  def("file.export", {
    label: "Export cho MOBA2D (bản cũ)", icon: "code",
    run: () => UI.text({
      title: "Export MOBA2D — định dạng đời trước",
      value: Store.exportForGame(),
      filename: "moba2d-map-export.json",
    }),
  });
  def("file.exportRaw", {
    label: "Export dữ liệu thô", icon: "code",
    run: () => UI.text({ title: "Export raw", value: Store.exportRaw(), filename: "moba2d-map-raw.json" }),
  });
  def("file.clear", {
    label: "Xoá toàn bộ terrain", icon: "trash", danger: true,
    run: async () => {
      if (!E.terrains.length) return;
      const ok = await UI.confirm({
        title: "Xoá toàn bộ terrain?", danger: true, confirmText: "Xoá hết",
        text: `Map đang có ${E.terrains.length} terrain. Có thể hoàn tác bằng Ctrl+Z, nhưng nên “Lưu file” trước cho chắc.`,
      });
      if (!ok) return;
      E.terrains = [];
      Sel.clear();
      commit();
      UI.toast("Đã xoá toàn bộ terrain");
    },
  });

  def("map.menu", {
    label: "Danh sách map", icon: "layers", keyHint: "Ctrl+M",
    run: () => { Store.flush(); return UI.mapMenu(); },
  });
  def("map.new", {
    label: "Map mới", icon: "plus",
    run: async () => {
      const r = await UI.form({
        title: "Tạo map mới",
        fields: [
          { key: "name", label: "Tên map", value: "Map mới" },
          { key: "w", label: "Chiều rộng", type: "number", value: 6400, min: 100 },
          { key: "h", label: "Chiều cao", type: "number", value: 6400, min: 100 },
        ],
        confirmText: "Tạo map",
        note: "Map chữ nhật cũng được — chỉ cần rộng và cao khác nhau.",
      });
      if (!r) return;
      const id = Store.createMap(
        (r.name || "").trim() || "Map mới",
        [Geom.clamp(Math.round(r.w) || 6400, 100, 200000), Geom.clamp(Math.round(r.h) || 6400, 100, 200000)],
        []
      );
      if (id) { Store.openMap(id); UI.toast("Đã tạo map mới"); }
    },
  });

  /* ------------------------------ phe ------------------------------- */

  def("map.addFaction", {
    label: "Thêm phe", icon: "flag",
    run: async () => {
      const r = await UI.form({
        title: "Thêm phe",
        fields: [{ key: "id", label: "Id của phe", value: "", placeholder: "amber" }],
        note: "Chuỗi tự do, core không diễn giải — MapSummary.factions dùng đúng id này.",
        confirmText: "Thêm",
      });
      if (!r) return;
      const id = String(r.id || "").trim();
      if (!id) return;
      if (E.meta.factions.includes(id)) { UI.toast("Phe này đã có", "warn"); return; }
      E.meta.factions.push(id);
      commit();
      UI.syncMap();
    },
  });

  def("map.renameFaction", {
    label: "Đổi tên phe", icon: "edit",
    run: ([from, to]) => {
      to = String(to || "").trim();
      if (!to || to === from) { UI.syncMap(); return; }
      if (E.meta.factions.includes(to)) { UI.toast("Trùng với phe đã có", "warn"); UI.syncMap(); return; }
      const i = E.meta.factions.indexOf(from);
      if (i === -1) return;
      E.meta.factions[i] = to;
      // Mọi thứ đang trỏ vào phe cũ phải đi theo, nếu không sẽ thành slot mồ côi.
      for (const t of E.terrains) {
        const p = t.props || {};
        for (const k of ["faction", "from", "to"]) if (p[k] === from) p[k] = to;
      }
      commit();
      UI.syncAll();
      UI.toast(`Đổi phe “${from}” thành “${to}”`);
    },
  });

  def("map.removeFaction", {
    label: "Xoá phe", icon: "trash", danger: true,
    run: async (id) => {
      const used = E.terrains.filter((t) => {
        const p = t.props || {};
        return p.faction === id || p.from === id || p.to === id;
      });
      if (E.meta.factions.length <= 1) { UI.toast("Phải còn ít nhất một phe", "warn"); return; }
      if (used.length) {
        const ok = await UI.confirm({
          title: "Xoá phe?", danger: true, confirmText: "Vẫn xoá",
          text: `${used.length} đối tượng đang dùng phe “${id}”. Xoá xong chúng sẽ trỏ vào phe không tồn tại — phần Kiểm tra sẽ báo lỗi cho tới khi bạn sửa lại.`,
        });
        if (!ok) return;
      }
      E.meta.factions = E.meta.factions.filter((f) => f !== id);
      commit();
      UI.syncAll();
    },
  });

  def("map.resize", {
    label: "Đổi kích thước map…", icon: "scale",
    run: async () => {
      const r = await UI.form({
        title: "Đổi kích thước map",
        fields: [
          { key: "w", label: "Chiều rộng", type: "number", value: E.mapSize[0], min: 100 },
          { key: "h", label: "Chiều cao", type: "number", value: E.mapSize[1], min: 100 },
          {
            key: "mode", label: "Nội dung đang vẽ", type: "select", value: "scale",
            options: [
              { value: "scale", label: "Scale theo khung mới" },
              { value: "keep", label: "Giữ nguyên toạ độ (chỉ đổi khung)" },
            ],
          },
        ],
        note: `Đang là ${E.mapSize[0]}×${E.mapSize[1]} với ${E.terrains.length} đối tượng. moba2d dùng map vuông.`,
        confirmText: "Áp dụng",
      });
      if (!r) return;
      resizeMap(r.w, r.h, r.mode === "scale");
    },
  });

  /** Scale nội dung mà không đụng tới khung — ví dụ vẽ lỡ tay quá to. */
  def("map.scaleContent", {
    label: "Scale nội dung theo %…", icon: "scale",
    isEnabled: () => E.terrains.length > 0,
    run: async () => {
      const r = await UI.form({
        title: "Scale nội dung",
        fields: [{ key: "pct", label: "Tỉ lệ (%)", type: "number", value: 50, min: 1 }],
        note: "Nhân mọi toạ độ quanh gốc (0,0). Khung map giữ nguyên.",
        confirmText: "Scale",
      });
      if (!r) return;
      const k = (Number(r.pct) || 0) / 100;
      if (!(k > 0) || k === 1) return;
      const flat = scaleMapContent(k, k);
      Cam.moveTo(Cam.tx * k, Cam.ty * k, Cam.tscale / k, true);
      commit();
      UI.syncAll();
      requestRender();
      UI.toast(`Đã scale ${E.terrains.length} đối tượng ×${k}`);
      if (flat) UI.toast(`${flat} polygon bị bẹt — Ctrl+Z nếu không ưng`, "warn");
    },
  });

  def("map.check", {
    label: "Kiểm tra map", icon: "check",
    run: () => {
      const issues = Store.validate();
      UI.syncCheck();
      if (!issues.length) { UI.toast("Map hợp lệ với schema moba2d"); return; }
      UI.alert({
        icon: issues.some((i) => i.level === "error") ? "err" : "warn",
        title: "Kết quả kiểm tra",
        html: issues.map((i) =>
          `<div style="color:${i.level === "error" ? "var(--danger)" : "var(--gold)"};margin-bottom:5px">
             ${i.level === "error" ? "Lỗi" : "Cảnh báo"} — ${UI.esc(i.text)}</div>`).join(""),
      });
    },
  });

  def("help.shortcuts", { label: "Phím tắt & hướng dẫn", icon: "keyboard", keyHint: "?", run: () => UI.shortcutsModal() });

  def("ui.inspector", {
    label: "Bảng thuộc tính", icon: "settings", keyHint: "Tab",
    isOn: () => E.inspectorOpen,
    run: () => { E.inspectorOpen = !E.inspectorOpen; Store.savePrefs(); UI.syncInspectorOpen(); },
  });

  def("ui.wheelMode", {
    label: "Cách dùng con lăn", icon: "settings",
    run: (mode) => {
      E.wheelMode = mode;
      Store.savePrefs();
      UI.toast(mode === "zoom" ? "Con lăn = phóng to/thu nhỏ"
        : mode === "pan" ? "Con lăn = cuộn khung nhìn"
          : "Con lăn: tự nhận chuột hay touchpad");
    },
  });

  def("ui.zoomSpeed", {
    label: "Tốc độ zoom", icon: "zoom-in",
    run: (v) => {
      E.zoomSpeed = Geom.clamp(v, 0.25, 4);
      Store.savePrefs();
      UI.toast(`Tốc độ zoom: ${v < 0.8 ? "chậm" : v > 1.4 ? "nhanh" : "vừa"}`);
    },
  });

  /** Menu “…” — chứa đủ mọi lệnh, kể cả những nhóm bị ẩn trên màn hình hẹp. */
  def("ui.overflow", {
    label: "Thêm", icon: "more",
    run: (anchor) => {
      const item = (id, extra) => {
        const c = get(id);
        return Object.assign({
          icon: c.icon, label: c.label, shortcut: c.keyHint,
          on: c.isOn ? c.isOn() : false,
          disabled: c.isEnabled ? !c.isEnabled() : false,
          run: () => run(id),
        }, extra);
      };
      UI.sheet(anchor || document.querySelector('[data-cmd="ui.overflow"]'), [
        { title: "Map", items: [item("map.menu"), item("map.new"), item("file.open"), item("file.import"), item("file.save")] },
        { title: "Clipboard", items: [item("edit.copy"), item("edit.cut"), item("edit.paste"), item("edit.pasteInPlace")] },
        { title: "Sửa", items: [item("ui.addMenu"), item("shape.addCustom"), item("shape.duplicate"), item("shape.delete"), item("shape.merge"), item("shape.flipH"), item("shape.flipV"), item("shape.recenter"), item("lane.reverse"), item("shape.front"), item("shape.back")] },
        { title: "Hiển thị", items: [item("view.grid"), item("view.snap"), item("view.bg"), item("view.bgUpload"), item("view.minimap"), item("view.dummy"), item("view.resetCamera"), item("ui.inspector")] },
        {
          title: "Con lăn chuột", items: [
            { icon: "settings", label: "Tự nhận (khuyên dùng)", on: E.wheelMode === "auto", run: () => run("ui.wheelMode", "auto") },
            { icon: "zoom-in", label: "Luôn phóng to/thu nhỏ", on: E.wheelMode === "zoom", run: () => run("ui.wheelMode", "zoom") },
            { icon: "hand", label: "Luôn cuộn khung nhìn", on: E.wheelMode === "pan", run: () => run("ui.wheelMode", "pan") },
          ],
        },
        {
          title: "Tốc độ zoom", items: [
            { icon: "zoom-out", label: "Chậm", on: E.zoomSpeed < 0.8, run: () => run("ui.zoomSpeed", 0.6) },
            { icon: "target", label: "Vừa", on: E.zoomSpeed >= 0.8 && E.zoomSpeed <= 1.4, run: () => run("ui.zoomSpeed", 1) },
            { icon: "zoom-in", label: "Nhanh", on: E.zoomSpeed > 1.4, run: () => run("ui.zoomSpeed", 1.8) },
          ],
        },
        { title: "moba2d", items: [item("file.backToGame"), item("file.playtest"), item("file.exportGeometry"), item("map.check"), item("map.resize"), item("map.scaleContent"), item("map.addFaction")] },
        { title: "Xuất / nhập khác", items: [item("file.import"), item("file.export"), item("file.exportRaw"), item("file.clear")] },
        { items: [item("help.shortcuts")] },
      ]);
    },
  });

  return {
    get, run, def, all: () => map,
    addPolygon, addObject, setProp, flipSelection, finishPen, cancelPen, startPen, setTool,
    toggleNodeMode, deleteVertices, recenterSelection, centerOffset,
    copyToText, pasteFromText, readMemClip, deleteSelection,
    scaleMapContent, resizeMap, reverseLanes,
    nudge, fitView, allBounds, offerMerge,
    waveCounts,
  };
})();
