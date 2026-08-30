/* =========================================================================
   storage.js — lưu trữ nhiều map trong localStorage + đọc/ghi file .json.

   Khoá và cấu trúc bản ghi giữ NGUYÊN như bản trước, nên mọi map đang có
   trong trình duyệt và mọi file đã export vẫn mở được bình thường.
   ========================================================================= */

const Store = (() => {
  const PREFIX = "lol-mapeditor-2";
  const INDEX_KEY = PREFIX + "-maps";
  const CURRENT_KEY = PREFIX + "-current";
  const LEGACY_KEY = "lol-mapeditor-2-terrains";
  const PREFS_KEY = PREFIX + "-prefs";
  const VIEWS_KEY = PREFIX + "-views";

  const mapKey = (id) => PREFIX + "-map-" + id;

  const readJSON = (key, fb) => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fb : JSON.parse(raw);
    } catch (e) {
      return fb;
    }
  };

  /**
   * Danh sách terrain trong một bản ghi. Bản Firebase ngày xưa lưu data
   * dưới dạng object {key: terrain} chứ không phải mảng — nhận cả hai.
   */
  const toList = (data) => {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return Object.values(data);
    return [];
  };

  /** Chuỗi dùng làm `MapSummary.id` — kiểu 'proving-grounds'. */
  const slugify = (s) =>
    String(s || "map").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d").replace(/Đ/g, "D")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "map";

  function normalizeMeta(meta, name) {
    const m = meta && typeof meta === "object" ? meta : {};
    let factions = Array.isArray(m.factions) ? m.factions : [];
    factions = factions
      .map((f) => (typeof f === "string" ? f : f && f.id))
      .filter((f) => typeof f === "string" && f.trim())
      .map((f) => f.trim());
    if (!factions.length) factions = ["amber", "jade"];
    const out = { id: m.id || slugify(name), factions };
    // `MapTuning` sống trong `meta` chứ không phải một khoá riêng, và đó là
    // quyết định có chủ đích: bản ghi trong kho editor đã lưu `meta` sẵn rồi,
    // nên tuning tự động đi theo mọi đường lưu/mở/tạo mà không phải sờ vào
    // đường nào. Editor không đọc nội dung bên trong — core mới là bên hiểu
    // nó — nên ở đây chỉ giữ nguyên vẹn cái object.
    if (m.tuning && typeof m.tuning === "object") out.tuning = m.tuning;
    return out;
  }

  const readIndex = () => {
    const list = readJSON(INDEX_KEY, []);
    return Array.isArray(list) ? list : [];
  };
  const writeIndex = (list) => localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  const readRecord = (id) => readJSON(mapKey(id), null);

  /* --------------------------- tuỳ chọn UI --------------------------- */

  function loadPrefs() {
    const p = readJSON(PREFS_KEY, {});
    if (!p || typeof p !== "object") return;
    if (typeof p.showGrid === "boolean") E.showGrid = p.showGrid;
    if (typeof p.snap === "boolean") E.snap = p.snap;
    if (typeof p.gridSize === "number" && p.gridSize > 0) E.gridSize = p.gridSize;
    if (typeof p.showMinimap === "boolean") E.showMinimap = p.showMinimap;
    if (typeof p.showDummy === "boolean") E.showDummy = p.showDummy;
    if (typeof p.showVertexIndex === "boolean") E.showVertexIndex = p.showVertexIndex;
    if (typeof p.inspectorOpen === "boolean") E.inspectorOpen = p.inspectorOpen;
    if (["auto", "zoom", "pan"].includes(p.wheelMode)) E.wheelMode = p.wheelMode;
    if (typeof p.zoomSpeed === "number" && p.zoomSpeed > 0) {
      E.zoomSpeed = Math.min(Math.max(p.zoomSpeed, 0.25), 4);
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        showGrid: E.showGrid, snap: E.snap, gridSize: E.gridSize,
        showMinimap: E.showMinimap, showDummy: E.showDummy,
        showVertexIndex: E.showVertexIndex, inspectorOpen: E.inspectorOpen,
        wheelMode: E.wheelMode, zoomSpeed: E.zoomSpeed,
      }));
    } catch (e) { /* hết chỗ thì thôi, không chặn người dùng */ }
  }

  /* ------------------------ khung nhìn từng map ----------------------- */

  /**
   * Vị trí camera được nhớ RIÊNG cho từng map, và để trong một khoá nhẹ của
   * riêng nó — không nhét vào bản ghi map. Kéo map một cái là camera đổi hàng
   * chục lần; ghi lại cả bản ghi map (kèm ảnh nền dạng data URL) mỗi lần như
   * thế thì đơ ngay.
   */
  const readViews = () => {
    const v = readJSON(VIEWS_KEY, {});
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  };

  let viewTimer = 0;
  let lastView = null;

  function saveViewNow() {
    clearTimeout(viewTimer);
    if (!E.mapId || !lastView) return;
    const views = readViews();
    views[E.mapId] = lastView;

    // Dọn khung nhìn của những map đã bị xoá, kẻo khoá này phình mãi.
    const alive = new Set(readIndex().map((m) => m.id));
    for (const id of Object.keys(views)) if (!alive.has(id)) delete views[id];

    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch (e) { /* đầy thì bỏ qua */ }
  }

  /**
   * Renderer gọi mỗi frame. So với giá trị đã ghi rồi mới hẹn giờ lưu, nên
   * đứng yên là không tốn gì, còn kéo/zoom liên tục thì gộp thành một lần ghi.
   */
  function noteCamera() {
    if (!E.mapId) return;
    const x = Math.round(Cam.tx), y = Math.round(Cam.ty), scale = Cam.tscale;
    if (lastView && lastView.x === x && lastView.y === y && Math.abs(lastView.scale - scale) < 1e-6) return;
    lastView = { x, y, scale: +scale.toFixed(6) };
    clearTimeout(viewTimer);
    viewTimer = setTimeout(saveViewNow, 500);
  }

  /**
   * Đặt lại camera cho map vừa mở: dùng khung nhìn đã nhớ nếu nó còn hợp lý,
   * không thì canh vừa map. "Hợp lý" = khung nhìn còn thấy được map — map bị
   * thu nhỏ lại hay đổi kích thước có thể ném camera ra giữa hư không, mở lên
   * thấy toàn màn hình đen thì tưởng mất sạch dữ liệu.
   */
  function restoreView(id) {
    const v = readViews()[id];
    const ok = v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.scale > 0;

    if (ok) {
      Cam.moveTo(v.x, v.y, Geom.clamp(v.scale, Cam.MIN, Cam.MAX), true);
      const seen = Cam.viewRect(0);
      if (Geom.rectsOverlap(seen, [0, 0, E.mapSize[0], E.mapSize[1]])) {
        lastView = { x: Math.round(Cam.tx), y: Math.round(Cam.ty), scale: +Cam.tscale.toFixed(6) };
        return;
      }
    }
    Cam.fitRect([0, 0, E.mapSize[0], E.mapSize[1]], 90, true);
    lastView = null;
    noteCamera();
  }

  /* ----------------------------- autosave ---------------------------- */

  let saveTimer = 0;
  let dirty = false;

  /**
   * Gộp nhiều thay đổi liên tiếp thành một lần ghi. Kéo một polygon có thể
   * bắn ra hàng chục commit; bản cũ ghi localStorage cho từng cái.
   */
  function scheduleSave(delay = 450) {
    dirty = true;
    if (typeof UI !== "undefined") UI.setSaveState("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delay);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    if (!E.mapId) { dirty = false; return; }

    const index = readIndex();
    const entry = index.find((m) => m.id === E.mapId);
    if (!entry) { dirty = false; return; }

    const record = {
      name: entry.name,
      mapSize: E.mapSize,
      meta: E.meta,
      background: E.background || null,
      data: serializeTerrains(),
    };

    try {
      localStorage.setItem(mapKey(E.mapId), JSON.stringify(record));
    } catch (e) {
      console.error("autosave lỗi", e);
      if (typeof UI !== "undefined") {
        UI.setSaveState("error");
        UI.alert({
          icon: "err",
          title: "Không lưu được",
          text: "Bộ nhớ trình duyệt đã đầy (thường do ảnh nền quá lớn). Hãy bấm “Lưu file” để giữ map, rồi xoá bớt map cũ hoặc ảnh nền.",
        });
      }
      return;
    }

    entry.updatedAt = Date.now();
    entry.count = E.terrains.length;
    entry.mapSize = E.mapSize.slice();
    writeIndex(index);
    dirty = false;
    if (typeof UI !== "undefined") UI.setSaveState("saved");
  }

  const flush = () => {
    if (dirty) saveNow();
    saveViewNow();
  };

  /* ------------------------------ map CRUD --------------------------- */

  function createMap(name, mapSize, terrains, background, meta) {
    const id = newId();
    const record = {
      name,
      mapSize,
      meta: meta || { id: slugify(name), factions: ["amber", "jade"] },
      background: background || null,
      data: toList(terrains),
    };
    try {
      localStorage.setItem(mapKey(id), JSON.stringify(record));
    } catch (e) {
      UI.alert({ icon: "err", title: "Không tạo được map", text: "Bộ nhớ trình duyệt đã đầy." });
      return null;
    }
    const index = readIndex();
    index.push({ id, name, updatedAt: Date.now(), count: record.data.length, mapSize });

    writeIndex(index);
    return id;
  }

  function openMap(id) {
    const record = readRecord(id);
    if (!record) {
      UI.alert({ icon: "err", title: "Lỗi", text: "Không đọc được map này." });
      return false;
    }
    flush();

    E.mapId = id;
    E.mapName = record.name || "Map";
    E.mapSize = Array.isArray(record.mapSize) && record.mapSize.length === 2
      ? record.mapSize.map((v) => Math.max(100, +v || 6400))
      : [6400, 6400];
    // meta phải vào trước: normalizeTerrain đọc danh sách phe khi quy đổi
    // turret1/turret2 đời cũ thành structure.
    E.meta = normalizeMeta(record.meta, record.name);
    E.terrains = toList(record.data).map(normalizeTerrain);
    E.selection = [];
    E.hover = null;
    E.hoverVertex = null;
    E.pen = null;

    localStorage.setItem(CURRENT_KEY, id);
    E.showBg = !!record.background;
    applyBackground(record.background, true);
    History.reset();
    restoreView(id);
    UI.syncAll();
    requestRender();
    return true;
  }

  function renameMap(id, name) {
    const index = readIndex();
    const entry = index.find((m) => m.id === id);
    if (!entry) return;
    entry.name = name;
    writeIndex(index);
    const record = readRecord(id);
    if (record) {
      record.name = name;
      try { localStorage.setItem(mapKey(id), JSON.stringify(record)); } catch (e) { }
    }
    if (E.mapId === id) {
      E.mapName = name;
      UI.syncMapName();
    }
  }

  function duplicateMap(id) {
    const record = readRecord(id);
    if (!record) return null;
    return createMap(
      record.name + " (bản sao)",
      (record.mapSize || [6400, 6400]).slice(),
      record.data || [],
      record.background || null
    );
  }

  /**
   * Xoá map — kể cả bản đã đẩy sang game.
   *
   * `unpublishLocal` là nửa từng thiếu: xoá map ở đây chỉ dọn kho riêng của
   * editor, còn `LOCAL_MAPS_KEY` thì không ai đụng, nên map đã xoá vẫn nằm
   * trong picker của game mãi mãi và không có đường nào gỡ ra. Hai kho, một
   * hành động — chúng phải đi cùng nhau.
   */
  function deleteMap(id) {
    const record = readRecord(id);
    unpublishLocal((record && record.meta && record.meta.id) || slugify(record && record.name));
    localStorage.removeItem(mapKey(id));
    writeIndex(readIndex().filter((m) => m.id !== id));
    const views = readViews();
    if (views[id]) {
      delete views[id];
      try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch (e) { }
    }
    if (E.mapId === id) {
      E.mapId = null;
      E.terrains = [];
      E.selection = [];
      History.reset();
      requestRender();
    }
  }

  /* ---------------------------- di sản ------------------------------- */

  function migrateLegacy() {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    try {
      const terrains = JSON.parse(raw);
      if (Array.isArray(terrains) && terrains.length) {
        createMap("Map cũ", [6400, 6400], terrains, null);
      }
    } catch (e) {
      console.error("migrate lỗi", e);
    }
    localStorage.removeItem(LEGACY_KEY);
  }

  /* ----------------------------- ảnh nền ----------------------------- */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("không tải được ảnh"));
      img.src = src;
    });
  }

  /** Trỏ editor vào ảnh nền của map: tên file asset, hoặc data URL đã upload. */
  function applyBackground(background, turnOn = true) {
    E.background = background || null;
    if (!background) {
      E.images.bg = null;
      E.showBg = false;
      requestRender();
      return Promise.resolve(null);
    }
    const src = background.kind === "upload" ? background.value : "asset/" + background.value;
    return loadImage(src)
      .then((img) => {
        E.images.bg = img;
        if (turnOn) E.showBg = true;
        UI.syncView();
        requestRender();
        return img;
      })
      .catch(() => {
        E.images.bg = null;
        requestRender();
        return null;
      });
  }

  /** Thu nhỏ + nén ảnh upload để không thổi bay hạn mức ~5MB của localStorage. */
  function importBackgroundFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadImage(url)
      .then((img) => {
        URL.revokeObjectURL(url);
        const MAX = 1600;
        const k = Math.min(1, MAX / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const dataURL = c.toDataURL("image/jpeg", 0.82);
        applyBackground({ kind: "upload", value: dataURL }, true).then(() => {
          E.showBg = true;
          UI.syncView();
          scheduleSave(0);
          UI.toast("Đã đặt ảnh nền");
        });
      })
      .catch(() => {
        URL.revokeObjectURL(url);
        UI.alert({ icon: "err", title: "Lỗi ảnh", text: "Không đọc được file ảnh này." });
      });
  }

  /* ----------------------------- nhập JSON --------------------------- */

  /**
   * Dựng lại terrain từ dữ liệu export cho game. Polygon ở đó nằm theo toạ độ
   * world, nên mỗi hình quay về thành một terrain riêng lấy trọng tâm làm gốc.
   *
   * File do editor này xuất ra còn mang theo `authoring` — hình như đã VẼ,
   * chưa cắt — và đó mới là thứ được đọc về; xem `mapAuthoring()`. Chỉ file
   * của người khác, hay file đã bị gỡ khối đó, mới rơi về mảnh lồi.
   */
  /** Chuỗi điểm bất kể viết kiểu [x,y] hay {x,y}. */
  const toPts = (list) =>
    (Array.isArray(list) ? list : [])
      .map((p) => (Array.isArray(p)
        ? [+p[0] || 0, +p[1] || 0]
        : (p && typeof p === "object" ? [+p.x || 0, +p.y || 0] : null)))
      .filter(Boolean);

  /** Một mảng điểm world -> terrain có gốc là trọng tâm. */
  function terrainFromWorldPoints(type, pts, props, min) {
    if (pts.length < (min || 3)) return null;
    const c = Geom.centroid(pts);
    const o = [Math.round(c[0]), Math.round(c[1])];
    return {
      type,
      position: o,
      polygon: pts.map((p) => [Math.round(p[0] - o[0]), Math.round(p[1] - o[1])]),
      polygons: [],
      props: props || {},
    };
  }

  const LEGACY_KEYS = ["wall", "brush", "water", "turret1", "turret2"];

  /** Định dạng export của MOBA2D đời trước. */
  function fromGameFormat(obj) {
    const out = [];
    for (const key of LEGACY_KEYS) {
      const list = obj[key];
      if (!Array.isArray(list)) continue;

      if (key === "turret1" || key === "turret2") {
        for (const p of list) {
          const q = toPts([p])[0];
          if (!q) continue;
          out.push({
            type: "structure",
            position: [Math.round(q[0]), Math.round(q[1])],
            polygon: [], polygons: [],
            props: { faction: factionAt(key === "turret1" ? 0 : 1), kind: "turret" },
          });
        }
        continue;
      }

      const type = key === "brush" ? "bush" : key;
      for (const poly of list) {
        const t = terrainFromWorldPoints(type, toPts(poly));
        if (t) out.push(t);
      }
    }
    return out;
  }

  /** Định dạng MapGeometry của moba2d. */
  function fromMapGeometry(obj) {
    const out = [];
    const terrain = obj.terrain || {};

    // Xét theo TỪNG LỚP chứ không phải cả khối: file chỉ còn hình gốc của
    // tường thì bụi và nước vẫn đọc được từ mảnh lồi.
    //
    // Đánh đổi: sửa tay `terrain` trong file mà quên sửa `authoring` thì bản
    // sửa tay bị bỏ qua không kêu một tiếng. Muốn nó thắng thì xoá `authoring`
    // của đúng lớp đó đi.
    const authored = obj.authoring && typeof obj.authoring === "object"
      ? obj.authoring.terrain : null;

    for (const kind of TERRAIN_KINDS) {
      const src = authored && Array.isArray(authored[kind]) ? authored[kind] : terrain[kind];
      for (const poly of (Array.isArray(src) ? src : [])) {
        const t = terrainFromWorldPoints(kind, toPts(poly));
        if (t) out.push(t);
      }
    }

    // Lane vào trước slot: điểm gom lính tham chiếu tới id của lane.
    for (const l of (Array.isArray(obj.lanes) ? obj.lanes : [])) {
      const t = terrainFromWorldPoints("lane", toPts(l && l.waypoints), {
        id: l.id || "lane", from: l.from || "", to: l.to || "",
      }, 2);
      if (t) out.push(t);
    }

    const slots = obj.slots || {};
    const marker = (type, s, props) => {
      if (!s || !Number.isFinite(+s.x) || !Number.isFinite(+s.y)) return;
      out.push({
        type, position: [Math.round(+s.x), Math.round(+s.y)],
        polygon: [], polygons: [], props,
      });
    };
    // `stats` đi cả hai chiều — xem `withStats`. Không đọc lại thì mở chính
    // file mình vừa xuất ra là mất sạch phần ghi đè, lần lưu sau ghi đè luôn.
    const keepStats = (s, p) => {
      if (s.stats && typeof s.stats === "object" && Object.keys(s.stats).length) p.stats = s.stats;
      return p;
    };
    for (const s of (slots.spawn || []))
      marker("spawn", s, keepStats(s, { faction: s.faction, r: +s.r || 150 }));
    for (const s of (slots.structure || []))
      marker("structure", s, keepStats(s, { faction: s.faction, kind: "turret" }));
    for (const s of (slots.minion || [])) {
      const p = keepStats(s, { faction: s.faction, lane: s.lane });
      if (s.scatter != null) p.scatter = +s.scatter;
      marker("minion", s, p);
    }
    for (const s of (slots.neutral || [])) {
      const p = { role: s.role, r: +s.r || 150 };
      if (s.rotationDeg) p.rotationDeg = +s.rotationDeg;
      marker("neutral", s, keepStats(s, p));
    }
    return out;
  }

  const isMapGeometry = (o) =>
    o && typeof o === "object" && !Array.isArray(o) && o.terrain && typeof o.terrain === "object" &&
    TERRAIN_KINDS.some((k) => Array.isArray(o.terrain[k]));

  const isGameFormat = (o) =>
    o && typeof o === "object" && !Array.isArray(o) && o.data == null && !o.terrain &&
    LEGACY_KEYS.some((k) => Array.isArray(o[k]));

  /** Kích thước map suy ra từ dữ liệu khi file không nói (format cho game). */
  function inferMapSize(terrains) {
    let max = 0;
    for (const t of terrains) {
      const px = t.position[0], py = t.position[1];
      if (!t.polygon.length) { max = Math.max(max, px, py); continue; }
      for (const p of t.polygon) max = Math.max(max, px + p[0], py + p[1]);
    }
    if (max <= 0) return [6400, 6400];
    const n = Math.max(6400, Math.ceil(max / 100) * 100);
    return [n, n];
  }

  /**
   * Đọc mọi định dạng JSON từng đi ra khỏi editor này:
   *   - {name, mapSize, background, data:[…]}  ← "Lưu file"
   *   - {data:[…]}                             ← "Export raw"
   *   - [ …terrain… ]                          ← mảng trần
   *   - {data:{key:{…}}}                       ← bản Firebase (field là chuỗi)
   *   - {wall:[…], brush:[…], turret1:[…]}     ← "Export cho game"
   * Ném lỗi kèm lời giải thích tiếng Việt nếu không nhận ra.
   */
  function parseMapJSON(text, fallbackName) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("JSON sai cú pháp: " + (e.message || e));
    }
    if (parsed == null || typeof parsed !== "object") {
      throw new Error("Nội dung không phải object hay mảng JSON.");
    }

    if (isMapGeometry(parsed)) {
      const meta = normalizeMeta(
        { id: parsed.id, factions: parsed.factions, tuning: parsed.tuning },
        parsed.name || fallbackName
      );
      // Phe phải có sẵn trước khi dựng slot, vì withDefaults tra vào đây.
      const keep = E.meta;
      E.meta = meta;
      let terrains;
      try { terrains = fromMapGeometry(parsed); } finally { E.meta = keep; }
      if (!terrains.length) throw new Error("MapGeometry không có địa hình, slot hay lane nào.");
      const size = Number(parsed.size) > 0 ? Math.round(parsed.size) : inferMapSize(terrains)[0];
      return {
        format: "geometry",
        name: parsed.name || fallbackName || "Map moba2d",
        mapSize: [size, size],
        background: null,
        meta,
        terrains,
      };
    }

    if (isGameFormat(parsed)) {
      const terrains = fromGameFormat(parsed);
      if (!terrains.length) throw new Error("Không tìm thấy polygon nào trong dữ liệu.");
      return {
        format: "game",
        name: fallbackName || "Map từ export",
        mapSize: inferMapSize(terrains),
        background: null,
        meta: null,
        terrains,
      };
    }

    let list = Array.isArray(parsed) ? parsed : parsed.data;
    list = toList(list);
    if (!list.length) throw new Error("Không tìm thấy terrain nào (thiếu mảng data).");

    return {
      format: Array.isArray(parsed) ? "array" : "editor",
      name: parsed.name || fallbackName || "Map từ file",
      mapSize: Array.isArray(parsed.mapSize) && parsed.mapSize.length === 2 ? parsed.mapSize : [6400, 6400],
      background: parsed.background || null,
      meta: parsed.meta || null,
      terrains: list,
    };
  }

  /** Đếm theo loại để hiện xem trước trong hộp thoại nhập. */
  function describe(terrains) {
    const c = {};
    for (const raw of terrains) {
      // Cùng phép quy đổi mà normalizeTerrain dùng, nếu không xem trước sẽ
      // đếm `brush` đời cũ thành tường.
      let t = raw.type === "brush" ? "bush" : raw.type;
      if (t === "turret1" || t === "turret2") t = "structure";
      if (!KIND[t]) t = "wall";
      c[t] = (c[t] || 0) + 1;
    }
    return TYPES.filter((k) => c[k]).map((k) => `${c[k]} ${KIND[k].label.toLowerCase()}`).join(" · ");
  }

  /** Nhập vào MAP MỚI, hoặc gộp thêm vào map đang mở. */
  function importParsed(doc, mode) {
    if (mode === "merge") {
      if (!E.mapId) return false;
      // Phe của file được nhập phải có mặt, nếu không mọi slot sẽ bị đánh dấu
      // "phe không tồn tại" ngay khi kiểm tra.
      if (doc.meta && Array.isArray(doc.meta.factions)) {
        for (const f of doc.meta.factions) {
          if (!E.meta.factions.includes(f)) E.meta.factions.push(f);
        }
      }
      const added = doc.terrains.map(normalizeTerrain);
      E.terrains.push(...added);
      Sel.set(added);
      commit();
      UI.syncAll();
      requestRender();
      UI.toast(`Đã thêm ${added.length} terrain vào map đang mở`);
      return true;
    }

    const meta = normalizeMeta(doc.meta, doc.name);
    const keep = E.meta;
    E.meta = meta;
    let data;
    try {
      data = doc.terrains.map((raw) => {
        const t = normalizeTerrain(raw);
        return { id: t.id, type: t.type, position: t.position, polygon: t.polygon, polygons: t.polygons, props: t.props };
      });
    } finally { E.meta = keep; }
    const id = createMap(doc.name, doc.mapSize, data, doc.background, meta);
    if (!id) return false;
    openMap(id);
    UI.toast(`Đã mở “${doc.name}” — ${E.terrains.length} terrain`);
    return true;
  }

  /* ------------------------------ file ------------------------------- */

  function download(filename, text, mime = "application/json") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveToFile() {
    const payload = {
      name: E.mapName,
      mapSize: E.mapSize,
      background: E.background || null,
      data: serializeTerrains(),
    };
    const safe = (E.mapName || "map").replace(/[^\p{L}\p{N}_-]+/gu, "-");
    download(`moba2d-map-${safe}.json`, JSON.stringify(payload, null, 2));
    UI.toast("Đã tải file map về máy");
  }

  const readFileText = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("không đọc được file"));
      reader.readAsText(file);
    });

  /** Mặc định file mở thành map MỚI — không bao giờ ghi đè map đang mở. */
  function importMapFile(file, mode = "new") {
    if (!file) return;
    readFileText(file)
      .then((text) => {
        const doc = parseMapJSON(text, file.name.replace(/\.json$/i, ""));
        importParsed(doc, mode);
      })
      .catch((e) => {
        UI.alert({ icon: "err", title: "File không hợp lệ", text: String(e.message || e) });
      });
  }

  /* --------------------- export cho moba2d --------------------------- */

  const R = Math.round;
  const pt = (x, y) => ({ x: R(x), y: R(y) });

  /** `MapSummary` — nửa nhẹ của map, thứ picker liệt kê. */
  function mapSummary() {
    const sum = {
      id: E.meta.id || slugify(E.mapName),
      name: E.mapName,
      // MapSummary.size là MỘT số: map moba2d hình vuông.
      size: Math.max(E.mapSize[0], E.mapSize[1]),
      factions: E.meta.factions.map((id) => ({ id })),
    };
    // Chỉ ghi khi có thật: map không chỉnh gì phải export ra y hệt như trước
    // khi có tính năng này, không thì mọi pack chưa dùng đều bị coi là "đã
    // đổi" và `generate-maps` báo lỗi cũ.
    const tuning = liveTuning();
    if (tuning) sum.tuning = tuning;
    return sum;
  }

  /**
   * `meta.tuning` nếu nó thực sự nói điều gì, còn không thì `null`.
   *
   * Một object rỗng — hoặc chỉ toàn nhóm rỗng, thứ mà panel cấu hình rất dễ
   * để lại sau khi người ta gõ vào rồi xoá đi — không phải là "map này có
   * luật riêng". Nó phải biến mất khỏi bản export chứ không nằm đó như một
   * lời hứa suông.
   */
  function liveTuning() {
    const raw = E.meta && E.meta.tuning;
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    for (const [group, body] of Object.entries(raw)) {
      if (!body || typeof body !== "object") continue;
      if (!Object.keys(body).length) continue;
      out[group] = body;
    }
    return Object.keys(out).length ? out : null;
  }

  /**
   * `MapGeometry` đúng như moba2d-core khai báo.
   *
   * Địa hình xuất ra là các MẢNH LỒI chứ không phải polygon gốc: TerrainField
   * và Vision trong core chỉ cho kết quả đúng với polygon lồi ("every wall
   * deeper than it is wide is authored as several convex boxes butted
   * together"), nên editor cắt sẵn và xuất phần đã cắt.
   */
  function mapGeometry() {
    const g = {
      terrain: { wall: [], bush: [], water: [] },
      slots: { spawn: [], minion: [], structure: [], neutral: [] },
      lanes: [],
    };

    for (const t of E.terrains) {
      const px = R(t.position[0]), py = R(t.position[1]);
      const p = t.props || {};
      const group = KIND[t.type].group;

      if (group === "terrain") {
        const parts = t.polygons && t.polygons.length
          ? t.polygons
          : (t.polygon.length >= 3 ? [t.polygon] : []);
        for (const poly of parts) {
          if (poly.length < 3) continue;
          g.terrain[t.type].push(poly.map((q) => pt(q[0] + px, q[1] + py)));
        }
        continue;
      }

      if (group === "lane") {
        if (t.polygon.length < 2) continue;
        g.lanes.push({
          id: p.id || "lane",
          from: p.from || "",
          to: p.to || "",
          waypoints: t.polygon.map((q) => pt(q[0] + px, q[1] + py)),
        });
        continue;
      }

      switch (t.type) {
        case "spawn":
          g.slots.spawn.push(withStats(p, { faction: p.faction || "", x: px, y: py, r: R(circleR(t)) }));
          break;
        case "structure":
          g.slots.structure.push(withStats(p, { faction: p.faction || "", kind: "turret", x: px, y: py }));
          break;
        case "minion": {
          const m = { faction: p.faction || "", lane: p.lane || "", x: px, y: py };
          if (p.scatter > 0) m.scatter = R(p.scatter);
          g.slots.minion.push(withStats(p, m));
          break;
        }
        case "neutral": {
          const n = { role: p.role || "", x: px, y: py, r: R(circleR(t)) };
          if (p.rotationDeg) n.rotationDeg = Number(p.rotationDeg);
          g.slots.neutral.push(withStats(p, n));
          break;
        }
      }
    }

    // "Absent on a map with no lanes" — bỏ hẳn field thay vì để mảng rỗng.
    if (!g.lanes.length) delete g.lanes;
    return g;
  }

  /**
   * Nửa authoring của file JSON: địa hình đúng như người ta VẼ, chưa cắt.
   *
   * `terrain` ở trên là thứ game chạy nên phải lồi, mà cắt rồi thì không suy
   * ngược lại được: mở file export lên chỉ còn một rổ mảnh rời, kéo một đỉnh
   * là hở seam. Nên hình gốc đi kèm ngay trong cùng file, ở một khoá core
   * không đọc — `checkMapGeometry` (content/validate.ts) chỉ chặn LỚP lạ bên
   * trong `terrain`, key thừa ở cấp geometry thì nó không soi, nên khối này
   * dán thẳng vào pack vẫn qua được kiểm tra.
   *
   * Chỉ địa hình cần chỗ này. Slot và lane xuất ra sao thì đọc về y như vậy.
   *
   * `polygons` (mảnh lồi) KHÔNG lưu ở đây: `refreshTerrain()` cắt lại từ
   * `polygon` ngay lúc nhập, nên chép theo chỉ tổ để hai bản lệch nhau.
   *
   * Bản `.ts` xuất cho game không mang khối này — nó là nửa nặng thật sự của
   * pack, và editor cũng chỉ đọc lại được JSON.
   */
  function mapAuthoring() {
    const terrain = { wall: [], bush: [], water: [] };
    for (const t of E.terrains) {
      if (KIND[t.type].group !== "terrain" || t.polygon.length < 3) continue;
      const px = R(t.position[0]), py = R(t.position[1]);
      terrain[t.type].push(t.polygon.map((q) => pt(q[0] + px, q[1] + py)));
    }
    return { version: 1, terrain };
  }

  /**
   * File JSON đầy đủ: nửa nhẹ (MapSummary) + nửa nặng (MapGeometry) + hình gốc
   * để mở lại còn sửa được.
   *
   * `parseMapJSON` vốn đã đọc `id`/`name`/`size`/`factions` từ lâu, chỉ là phía
   * export chưa bao giờ ghi — nên map nhập về mất tên, mất phe, và kích thước
   * phải đoán từ toạ độ xa nhất.
   */
  function exportMapGeometry() {
    const sum = mapSummary();
    const doc = Object.assign(
      { id: sum.id, name: sum.name, size: sum.size, factions: sum.factions },
      mapGeometry()
    );
    doc.authoring = mapAuthoring();
    return JSON.stringify(doc, null, 2);
  }

  /* ------------------- export ra module TypeScript ------------------- */

  const camel = (s) => slugify(s).replace(/-(.)/g, (_, c) => c.toUpperCase());
  const q = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

  const fmtPoints = (pts, indent) =>
    pts.map((p) => `${indent}{ x: ${p.x}, y: ${p.y} },`).join("\n");

  function fmtPolyList(list, indent) {
    if (!list.length) return "[],";
    const inner = indent + "  ";
    return "[\n" + list.map((poly) =>
      `${inner}[\n${fmtPoints(poly, inner + "  ")}\n${inner}],`
    ).join("\n") + `\n${indent}],`;
  }

  /**
   * Kèm theo `stats` của slot, nếu có.
   *
   * **Ba chỗ từng làm rơi nó và không chỗ nào báo gì.** Inspector cho gõ
   * `stats.health` cho trụ, `stats.healPercent` cho bệ đá, `stats.aggroRange`
   * cho bãi quái — `commands.js`'s `setDeep` ghi đúng vào `t.props.stats` —
   * rồi hàm export này dựng slot bằng cách liệt kê từng field một và không
   * liệt kê `stats`. Người chơi sửa chỉ số, bấm Chơi thử, và không thấy gì
   * thay đổi cả, vì core (`config/mapTuning.ts`'s `resolveTurretPreset`) nhận
   * được một slot chẳng có gì để ghi đè.
   *
   * `setDeep` đã tự dọn `stats: {}` rỗng, nên tới đây `stats` mà tồn tại thì
   * chắc chắn có nội dung.
   */
  function withStats(props, slot) {
    if (props.stats && typeof props.stats === "object" && Object.keys(props.stats).length) {
      slot.stats = props.stats;
    }
    return slot;
  }

  const fmtValue = (value) =>
    typeof value === "string" ? q(value) : typeof value === "object" ? JSON.stringify(value) : value;

  function fmtObjList(list, indent, keys) {
    if (!list.length) return "[],";
    const inner = indent + "  ";
    return "[\n" + list.map((o) => {
      const body = keys.filter((k) => o[k] !== undefined)
        // `stats` là object lồng, không phải số hay chuỗi — `JSON.stringify`
        // ra đúng cú pháp object literal của TS cho một khối toàn số.
        .map((k) => `${k}: ${fmtValue(o[k])}`).join(", ");
      return `${inner}{ ${body} },`;
    }).join("\n") + `\n${indent}],`;
  }

  /** Module `<tên>Geometry.ts` dán thẳng được vào pack của moba2d. */
  function exportGeometryTS() {
    const g = mapGeometry();
    const sum = mapSummary();
    const name = camel(sum.id);
    const counts = TERRAIN_KINDS.map((k) => `${g.terrain[k].length} ${k}`).join(", ");

    return `import type { MapGeometry } from '@moba2d/core/content/ContentPack';

/**
 * ${sum.name} — nửa nặng của map: địa hình, slot và lane.
 *
 * Sinh bởi MOBA2D Map Editor. Địa hình đã được cắt thành mảnh lồi
 * (${counts}); TerrainField/Vision của core chỉ đúng với polygon lồi.
 */
export const ${name}Geometry: MapGeometry = {
  terrain: {
    wall: ${fmtPolyList(g.terrain.wall, "    ")}
    bush: ${fmtPolyList(g.terrain.bush, "    ")}
    water: ${fmtPolyList(g.terrain.water, "    ")}
  },
  slots: {
    spawn: ${fmtObjList(g.slots.spawn, "    ", ["faction", "x", "y", "r", "stats"])}
    minion: ${fmtObjList(g.slots.minion, "    ", ["faction", "lane", "x", "y", "scatter", "stats"])}
    structure: ${fmtObjList(g.slots.structure, "    ", ["faction", "kind", "x", "y", "stats"])}
    neutral: ${fmtObjList(g.slots.neutral, "    ", ["role", "x", "y", "r", "rotationDeg", "stats"])}
  },${g.lanes ? `
  lanes: [
${g.lanes.map((l) => `    {
      id: ${q(l.id)},
      from: ${q(l.from)},
      to: ${q(l.to)},
      waypoints: [
${fmtPoints(l.waypoints, "        ")}
      ],
    },`).join("\n")}
  ],` : ""}
};
`;
  }

  /** Module định nghĩa map (nửa nhẹ) trỏ sang geometry bằng dynamic import. */
  function exportMapTS() {
    const sum = mapSummary();
    const name = camel(sum.id);
    return `import type { MapDefinition } from '@moba2d/core/content/ContentPack';

export const ${name}Map: MapDefinition = {
  id: ${q(sum.id)},
  name: ${q(sum.name)},
  size: ${sum.size},
  factions: [${sum.factions.map((f) => `{ id: ${q(f.id)} }`).join(", ")}],
${sum.tuning ? `  tuning: ${JSON.stringify(sum.tuning)},
` : ""}  geometry: () => import('./${name}Geometry').then(module => module.${name}Geometry),
};
`;
  }

  /* --------------------- chơi thử ngay trong game --------------------- */

  /**
   * Khoá mà game đọc để lấy map do người chơi tự vẽ. Phải khớp từng ký tự với
   * `LOCAL_MAPS_KEY` trong `src/content/localMaps.ts` của moba2d-core.
   *
   * Không dùng chung tiền tố `lol-mapeditor-2` với mấy khoá bên trên: đó là
   * kho riêng của editor, muốn đổi hình dạng lúc nào cũng được. Khoá này là
   * giao kèo với một chương trình khác.
   *
   * ĐÂY LÀ LỜI NHẮN, KHÔNG PHẢI THƯ VIỆN. Game *lấy* nội dung ra rồi xoá khoá
   * ngay trong lần đọc đầu tiên (`takeStagedMaps` bên core), nên map chỉ sống
   * đúng một lượt tải trang — đúng thứ nút "Chơi thử" hứa hẹn. Trước đây nó
   * được xử như thư viện: mọi map từng bấm chơi thử nằm lại trong picker của
   * game vĩnh viễn, và từ phía game không có đường nào gỡ ra.
   */
  const LOCAL_MAPS_KEY = "moba2d-local-maps-v1";

  /**
   * Khoá game ghi ra để editor biết game đang có những map nào. Khớp từng ký
   * tự với `PACK_MAPS_KEY` trong `src/content/editorCatalog.ts`.
   *
   * Là một CATALOG chứ không phải lời nhắn: đọc bao nhiêu lần cũng được và
   * không bao giờ xoá. Bản cũ chỉ là tin cũ. (Bản đầu tiên của tính năng này
   * là lời nhắn dùng-một-lần, và nếu quên xoá thì mỗi lần F5 map của game lại
   * đè lên việc đang làm dở — cách này không có kiểu hỏng đó.)
   */
  const PACK_MAPS_KEY = "moba2d-pack-maps-v1";

  /** Map game đang có, để màn hình "Map của bạn" xếp cạnh bản nháp. */
  function readPackMaps() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PACK_MAPS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((m) => m && m.id && m.terrain) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Mở một BẢN SAO của map game đang có. Trả về id map mới, hoặc null.
   *
   * Tự gộp lại các mảnh lồi khi map không mang `authoring` — và đây không phải
   * suy đoán: `terrain` là dạng đã cắt vì `TerrainField`/`Vision` của core chỉ
   * đúng với polygon lồi, nên thiếu `authoring` nghĩa là không ai còn giữ hình
   * gốc. Summoner's Rift là 329 mảnh cho 73 bức tường; mở ra mà thấy 329 hình
   * thì đang sửa kết quả cắt chứ không phải sửa map.
   *
   * Map CÓ `authoring` thì `fromMapGeometry` đã đọc đúng hình người ta vẽ rồi,
   * và gộp thêm là viết lại quyết định của tác giả — nên không đụng vào.
   *
   * Gộp là một bước undo RIÊNG, ngay sau bước mở map. Nên một lần Ctrl+Z trả
   * lại các mảnh rời mà vẫn giữ map đang mở — người không thích kết quả gộp
   * lấy lại được bản gốc, chứ không bị ném về map trước đó.
   */
  function openPackMap(id) {
    const found = readPackMaps().find((m) => m.id === id);
    if (!found) return null;

    const bare = String(found.id).includes(":")
      ? String(found.id).slice(String(found.id).lastIndexOf(":") + 1)
      : String(found.id);
    const name = String(found.name || "Map") + " (bản sửa)";

    let doc;
    try {
      doc = parseMapJSON(JSON.stringify(Object.assign({}, found, { id: bare, name })), name);
    } catch (e) {
      if (typeof UI !== "undefined") {
        UI.alert({ icon: "err", title: "Không mở được map", text: String((e && e.message) || e) });
      }
      return null;
    }
    if (!importParsed(doc, "new")) return null;

    const authored = found.authoring && typeof found.authoring === "object";
    if (!authored) {
      const before = E.terrains.filter(isPoly).length;
      E.terrains = mergeTerrains(E.terrains);
      const after = E.terrains.filter(isPoly).length;
      if (after < before) {
        for (const t of E.terrains) refreshTerrain(t);
        Sel.clear();
        commit();
        if (typeof UI !== "undefined") {
          UI.toast(`Đã gộp ${before} mảnh cắt thành ${after} hình — Ctrl+Z nếu muốn giữ mảnh rời`);
        }
      }
    }
    scheduleSave(0);
    return E.mapId;
  }

  /**
   * Đẩy map đang mở sang cho game, dưới dạng một `MapDefinition` đã có sẵn
   * geometry — thứ `PackRegistry.installData` nhận thẳng, không cần pack,
   * không cần manifest, không cần mạng.
   *
   * Ghi đè theo `id`: sửa map rồi bấm chơi thử lần nữa thì thay bản cũ chứ
   * không sinh ra bản thứ hai trùng tên. `id` ở đây là `meta.id` của map —
   * cùng cái đi vào `MapSummary.id` khi export, nên map chơi thử và map xuất
   * ra pack sau này là một.
   *
   * `authoring` đi kèm luôn (xem `mapAuthoring()`): map local là thứ người ta
   * sẽ còn mở ra sửa tiếp, nên nó phải tự mô tả được hình gốc của mình.
   *
   * Ném ra ngoài nếu localStorage đầy hoặc bị chặn — người gọi phải nói cho
   * người dùng biết, chứ nuốt lỗi ở đây thì bấm "Chơi thử" xong sang game
   * không thấy map đâu mà không hiểu vì sao.
   */
  function publishLocal() {
    const sum = mapSummary();
    const geometry = mapGeometry();
    geometry.authoring = mapAuthoring();
    const entry = {
      id: sum.id, name: sum.name, size: sum.size,
      factions: sum.factions, geometry,
    };
    // `MapSummary.tuning`, cùng tầng với `factions`. Quên dòng này thì "Chơi
    // thử" chạy map với chỉ số mặc định của core còn bản export lại có luật
    // riêng — hai thứ khác nhau từ cùng một map, mà không báo gì.
    if (sum.tuning) entry.tuning = sum.tuning;

    let list = [];
    try {
      const raw = localStorage.getItem(LOCAL_MAPS_KEY);
      const parsed = raw == null ? [] : JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch (e) {
      // Rác của ai đó để lại. Ghi đè bằng danh sách sạch còn hơn là chịu chết.
    }

    const i = list.findIndex((m) => m && m.id === entry.id);
    if (i >= 0) list[i] = entry; else list.push(entry);

    localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(list));
    return entry.id;
  }

  /**
   * Gỡ một map khỏi danh sách game đọc.
   *
   * `id` ở đây là `meta.id` — thứ đi vào `MapSummary.id` — chứ không phải id
   * bản ghi trong kho editor. Hai không gian id khác nhau, và nhầm chúng thì
   * lệnh xoá chạy êm ru mà không gỡ được gì.
   */
  function unpublishLocal(id) {
    if (!id) return false;
    let list = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_MAPS_KEY) || "[]");
      if (Array.isArray(parsed)) list = parsed;
    } catch (e) {
      return false;
    }
    const kept = list.filter((m) => !m || m.id !== id);
    if (kept.length === list.length) return false;
    try {
      localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(kept));
    } catch (e) {
      return false;
    }
    return true;
  }

  /** Danh sách map đã đẩy sang game — để biết map đang mở đã có bên đó chưa. */
  function localMapIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_MAPS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map((m) => m && m.id).filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }

  /* ---------------------------- kiểm tra ----------------------------- */

  /**
   * Soi map theo đúng những gì schema của moba2d đòi, trước khi export.
   * Trả về [{ level, text }] — 'error' là chắc chắn game không chạy được,
   * 'warn' là nhiều khả năng sai ý đồ.
   */
  /**
   * Những luật mà cổng đẩy lên của pack kiểm, và editor thì không.
   *
   * Đây là lý do "0 lỗi" trong editor mà `npm run verify` vẫn đỏ: bộ kiểm của
   * editor xưa nay chỉ soi *schema và topology* — id, phe, chiều lane, điểm
   * gom lính, khung map. Còn "lane có đi xuyên tường không", "lính có đứng
   * được lên waypoint này không", "cái trụ này có wave nào đi qua không" là
   * hình học, và không ai hỏi.
   *
   * Phần tính toán **không nằm ở đây**: nó ở `js/mapRules.js`, một bản duy
   * nhất mà cả `lol/tests/maps/Lanes.test.ts` của pack cũng nạp (qua
   * `src/seams/mapRules.ts`). Hai bản cài đặt là cách mà editor báo xanh còn
   * cổng báo đỏ, tức đúng cái đang được sửa. Việc của hàm này chỉ là dịch dữ
   * liệu của editor — polygon lưu theo toạ độ tương đối — sang toạ độ world
   * tuyệt đối mà luật nhận vào.
   *
   * Truyền cả slot chứ không chỉ lane và tường: nhóm luật thứ hai
   * (`structureIssues`) hỏi về *quan hệ* giữa chúng — lane có nối hai nhà
   * không, trụ có nằm trên lane nào không, điểm gom lính có đứng được không,
   * cặp bãi quái có đối xứng không. Đó đúng là những câu mà suite của pack
   * trước đây trả lời bằng bảng toạ độ gõ tay, thứ hỏng ngay lần đầu ai đó
   * kéo một cái trụ trong editor này.
   */
  /**
   * Loại lính khai ra rồi không bao giờ ra sân.
   *
   * `MinionTuning.types` **thay hẳn** ba loại của core chứ không trộn vào, và
   * đội hình wave là một danh sách id. Nên có hai cách hỏng, cả hai đều im
   * lặng tuyệt đối — `MinionSpawner.spawn` gặp id lạ thì `return null`, không
   * log, không lỗi, wave chỉ đơn giản là ít con hơn hoặc rỗng:
   *
   *   - khai bảng loại lính riêng mà không khai đội hình: đội hình mặc định
   *     của core gọi tên melee/ranged/cannon, bảng mới không có, **mọi wave
   *     rỗng**;
   *   - khai thêm một loại nhưng quên điền "mỗi wave mấy con": loại đó nằm
   *     trong file và không bao giờ xuất hiện trong trận.
   *
   * `validate.ts` bên core từ chối cài map như vậy. Ở đây là để thấy nó
   * *trước khi export*, chứ không phải sau khi copy file sang pack.
   */
  function waveRosterIssues(err) {
    const minions = (E.meta && E.meta.tuning && E.meta.tuning.minions) || {};
    const ids = Object.keys(minions.types || {});
    if (!ids.length) return;

    const fielded = new Set();
    const collect = (list) => {
      if (Array.isArray(list)) for (const id of list) fielded.add(id);
    };
    collect(minions.waves && minions.waves.composition);
    for (const stage of (minions.waves && minions.waves.stages) || []) {
      collect(stage && stage.composition);
    }

    if (!fielded.size) {
      err(
        `Map khai bảng loại lính riêng (${ids.join(", ")}) nhưng chưa khai đội hình wave. ` +
        `Đội hình mặc định của core gọi tên melee/ranged/cannon — bảng này không có — ` +
        `nên MỌI WAVE SẼ RỖNG. Điền ô “Mỗi wave” cho ít nhất một loại.`
      );
      return;
    }
    for (const id of ids) {
      if (fielded.has(id)) continue;
      err(
        `Loại lính “${id}” khai rồi nhưng không có trong đội hình wave — ` +
        `nó sẽ không bao giờ ra sân. Điền ô “Mỗi wave” cho nó, hoặc xoá loại này đi.`
      );
    }
  }

  function laneGeometryIssues(err) {
    const world = (t) => t.polygon.map((p) => [p[0] + t.position[0], p[1] + t.position[1]]);
    const slots = (type) => E.terrains.filter((t) => t.type === type);
    const props = (t) => t.props || {};

    const issues = MapRules.mapIssues({
      size: Math.max(E.mapSize[0], E.mapSize[1]),
      // In the order the map declares them, which is the whole of what the
      // rule needs: core's bridge is positional (`factions[0]` is blue,
      // `factions[1]` is red) and everything past the second seats nowhere.
      factions: ((E.meta && E.meta.factions) || []).slice(),
      lanes: E.terrains
        .filter((t) => t.type === "lane" && (t.polygon || []).length >= 2)
        .map((t) => ({ id: props(t).id || "?", points: world(t) })),
      walls: E.terrains
        .filter((t) => t.type === "wall" && (t.polygon || []).length >= 3)
        .map(world),
      turrets: slots("structure").map((t) => ({
        x: t.position[0],
        y: t.position[1],
        faction: props(t).faction || "",
      })),
      spawns: slots("spawn").map((t) => ({
        x: t.position[0],
        y: t.position[1],
        faction: props(t).faction || "",
      })),
      musters: slots("minion").map((t) => ({
        x: t.position[0],
        y: t.position[1],
        faction: props(t).faction || "",
        lane: props(t).lane || "",
        scatter: +props(t).scatter || 0,
      })),
      neutrals: slots("neutral").map((t) => ({
        x: t.position[0],
        y: t.position[1],
        r: circleR(t),
        role: props(t).role || "",
      })),
    });

    for (const issue of issues) err(issue.text, issue.at);
  }

  /**
   * `at` là toạ độ world của chỗ hỏng, khi biết được.
   *
   * Có nó thì bảng "Kiểm tra" bấm được: một dòng chữ mô tả chỗ hỏng rồi bắt
   * người ta tự đi tìm trong một map 6400×6400 là bắt người ta làm việc mà máy
   * đã biết câu trả lời.
   */
  function validate() {
    const out = [];
    const err = (text, at) => out.push({ level: "error", text, at });
    const warn = (text, at) => out.push({ level: "warn", text, at });

    const factions = E.meta.factions;
    const size = Math.max(E.mapSize[0], E.mapSize[1]);

    if (E.mapSize[0] !== E.mapSize[1]) {
      warn(`Map ${E.mapSize[0]}×${E.mapSize[1]} không vuông — MapSummary.size chỉ có một số, export sẽ dùng ${size}.`);
    }
    if (!/^[a-z0-9-]+$/.test(E.meta.id || "")) err(`Map id “${E.meta.id}” nên chỉ gồm chữ thường, số và dấu gạch ngang.`);
    if (factions.length < 2) warn(`Mới khai báo ${factions.length} phe — map MOBA thường có 2.`);
    if (new Set(factions).size !== factions.length) err("Có phe bị trùng id.");

    const lanes = E.terrains.filter((t) => t.type === "lane");
    const laneIdSet = new Set(lanes.map((t) => t.props.id));
    if (laneIdSet.size !== lanes.length) err("Có lane trùng id.");

    for (const t of E.terrains) {
      const p = t.props || {};
      const where = `${KIND[t.type].label} tại (${R(t.position[0])}, ${R(t.position[1])})`;

      const here = [t.position[0], t.position[1]];

      if (KIND[t.type].group === "terrain" && t.polygon.length < 3) {
        err(`${where}: polygon chỉ có ${t.polygon.length} đỉnh.`, here);
      }
      if (p.faction !== undefined && !factions.includes(p.faction)) {
        err(`${where}: phe “${p.faction}” không có trong danh sách phe của map.`, here);
      }
      if (t.type === "minion" && !laneIdSet.has(p.lane)) {
        err(`${where}: lane “${p.lane}” không tồn tại.`, here);
      }
      if (t.type === "neutral" && !String(p.role || "").trim()) {
        err(`${where}: chưa đặt role cho bãi quái.`, here);
      }
      if (t.type === "lane") {
        if (t.polygon.length < 2) err(`Lane “${p.id}” cần ít nhất 2 waypoint.`);
        for (const k of ["from", "to"]) {
          if (!factions.includes(p[k])) err(`Lane “${p.id}”: ${k} = “${p[k]}” không phải phe của map.`);
        }
        if (p.from === p.to) warn(`Lane “${p.id}” đi từ một phe về chính nó.`);

        // Core cho phe THỨ NHẤT đi xuôi danh sách waypoint và phe thứ hai đi
        // ngược (getLaneWaypoints trong moba2d-core, cầu nối phe→team là theo
        // thứ tự: factions[0] = BLUE). Nên waypoint 0 bắt buộc nằm ở phía base
        // của factions[0], nếu không lính phe đó xuất phát từ base địch.
        if (factions.length >= 2 && t.polygon.length >= 2) {
          // Hình học là bằng chứng chắc nhất; chỉ khi không có điểm hồi sinh
          // để đối chiếu mới xét tới field `from`. Một lỗi thì báo một lần.
          const home = E.terrains.find((x) => x.type === "spawn" && x.props.faction === factions[0]);
          let backwards = null;
          if (home) {
            const d = (q) => Math.hypot(
              q[0] + t.position[0] - home.position[0],
              q[1] + t.position[1] - home.position[1]
            );
            backwards = d(t.polygon[t.polygon.length - 1]) < d(t.polygon[0]);
          }
          // referenceMap.test.ts: "gives every lane a muster point for both of
          // its factions" — mỗi đầu lane phải có một điểm gom lính của phe đó.
          for (const end of [p.from, p.to]) {
            if (!end) continue;
            const has = E.terrains.some((x) =>
              x.type === "minion" && x.props.faction === end && x.props.lane === p.id);
            if (!has) warn(`Lane “${p.id}”: phe “${end}” chưa có điểm gom lính cho lane này.`);
          }

          if (backwards) {
            warn(`Lane “${p.id}”: waypoint 0 đang ở phía “${factions[1]}”. Core cho phe đầu tiên (“${factions[0]}”) đi xuôi danh sách, nên lính phe đó sẽ xuất phát từ base địch — bấm “Đảo chiều lane”.`);
          } else if (backwards === null && p.from !== factions[0]) {
            warn(`Lane “${p.id}”: from = “${p.from}” nhưng waypoint 0 phải ở phía phe đầu tiên (“${factions[0]}”). Bấm “Đảo chiều lane”.`);
          }
        }
      }

      const b = t._bbox;
      if (b && (b[0] < 0 || b[1] < 0 || b[2] > size || b[3] > size)) {
        warn(`${where} nằm ngoài khung map (0…${size}).`, here);
      }
    }

    for (const f of factions) {
      if (!E.terrains.some((t) => t.type === "spawn" && t.props.faction === f)) {
        warn(`Phe “${f}” chưa có điểm hồi sinh.`);
      }
    }
    if (!lanes.length) warn("Map chưa có lane nào — sẽ không có wave lính, và lệnh PUSH không dùng được.");

    waveRosterIssues(err);
    laneGeometryIssues(err);

    return out;
  }

  /* ------------------------ export MOBA2D (cũ) ------------------------ */

  /**
   * Định dạng của MOBA2D đời trước: mảng toạ độ trần, bụi gọi là `brush`, trụ
   * tách theo đội. Giữ lại để map cũ vẫn dùng được với game cũ.
   */
  function exportForGame() {
    const out = { wall: [], brush: [], water: [], turret1: [], turret2: [] };
    const legacyKey = { wall: "wall", bush: "brush", water: "water" };

    for (const t of E.terrains) {
      if (t.type === "structure") {
        const i = E.meta.factions.indexOf((t.props || {}).faction);
        out[i === 1 ? "turret2" : "turret1"].push([R(t.position[0]), R(t.position[1])]);
        continue;
      }
      const key = legacyKey[t.type];
      if (!key) continue;                       // spawn/minion/neutral/lane không có ở bản cũ
      const parts = t.polygons && t.polygons.length ? t.polygons : [t.polygon];
      for (const poly of parts) {
        if (poly.length < 3) continue;
        out[key].push(poly.map((p) => [R(p[0] + t.position[0]), R(p[1] + t.position[1])]));
      }
    }
    return JSON.stringify(out);
  }

  const exportRaw = () => JSON.stringify({ data: serializeTerrains() });

  return {
    INDEX_KEY, CURRENT_KEY, toList,
    readIndex, readRecord, writeIndex,
    loadPrefs, savePrefs,
    scheduleSave, saveNow, flush,
    noteCamera, saveViewNow, readViews, restoreView,
    createMap, openMap, renameMap, duplicateMap, deleteMap, migrateLegacy,
    loadImage, applyBackground, importBackgroundFile,
    download, saveToFile, importMapFile, readFileText,
    parseMapJSON, importParsed, describe, toPts,
    exportForGame, exportRaw,
    mapSummary, mapGeometry, mapAuthoring, exportMapGeometry, exportGeometryTS, exportMapTS,
    publishLocal, unpublishLocal, localMapIds, LOCAL_MAPS_KEY,
    readPackMaps, openPackMap, PACK_MAPS_KEY,
    validate, slugify, normalizeMeta, camel,
  };
})();
