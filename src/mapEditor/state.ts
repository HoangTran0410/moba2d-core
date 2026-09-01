/* =========================================================================
   state.js — nguồn sự thật duy nhất của editor: dữ liệu map, vùng chọn,
   camera và lịch sử undo/redo.

   Nguyên tắc hiệu năng: mỗi terrain giữ sẵn cache `_bbox` (AABB world) và
   `polygons` (mảnh lồi). Chúng chỉ được tính lại khi hình đổi — không phải
   mỗi frame như bản cũ (bản cũ gọi decomp() trong draw()).
   ========================================================================= */

import type { MapTuning } from '@/content/ContentPack';
import { Geom } from './geom';
import { requestRender } from './frame';
import { Store } from './storage';
import { UI } from './ui';

/* ==================== các loại đối tượng trên map =======================
   Mô hình bám sát `MapGeometry` của moba2d
   (moba2d-core/src/content/ContentPack.ts):

     terrain { wall, bush, water }   -> polygon
     slots   { spawn, minion, structure, neutral }
     lanes   [ { id, from, to, waypoints } ]

   `shape` quyết định cách vẽ / bắt chuột / sửa:
     poly   – đa giác, kéo được từng đỉnh
     line   – đường gấp khúc mở (lane), cũng kéo được từng đỉnh
     circle – một điểm kèm bán kính thật trong world (spawn, bãi quái)
     point  – một điểm thuần, vẽ cỡ cố định theo màn hình (trụ, điểm lính)
   ======================================================================= */

export const KIND = {
  wall: { label: "Tường", color: "#8b98ab", shape: "poly", group: "terrain" },
  bush: { label: "Bụi", color: "#46c95f", shape: "poly", group: "terrain" },
  water: { label: "Nước", color: "#3ba0e6", shape: "poly", group: "terrain" },
  spawn: { label: "Điểm hồi sinh", color: "#ffd166", shape: "circle", group: "slot" },
  structure: { label: "Trụ", color: "#5b8cff", shape: "point", group: "slot" },
  minion: { label: "Điểm gom lính", color: "#f0883e", shape: "point", group: "slot" },
  neutral: { label: "Điểm trung lập", color: "#c77dff", shape: "circle", group: "slot" },
  lane: { label: "Lane", color: "#29d3c4", shape: "line", group: "lane" },
};

export const TYPES = Object.keys(KIND);
export const TYPE_INFO = KIND;                       // tên cũ, giữ để khỏi sửa khắp nơi
export const TERRAIN_KINDS = ["wall", "bush", "water"];
export const SLOT_KINDS = ["spawn", "structure", "minion", "neutral"];

const shapeOf = (t) => KIND[t.type].shape;
export const isPoly = (t) => KIND[t.type].shape === "poly";
export const isLine = (t) => KIND[t.type].shape === "line";
export const hasVerts = (t) => isPoly(t) || isLine(t);
export const isMarker = (t) => !hasVerts(t);

/** Bán kính hiển thị của điểm đánh dấu, tính theo pixel màn hình. */
export const MARKER_PX = 12;
/** Nửa cạnh hộp bao của điểm đánh dấu (đơn vị world) — dùng cho quét chọn. */
const POINT_BOX = 45;

/** Bán kính thật (world) của một đối tượng dạng vòng tròn. */
export const circleR = (t) => Math.max(4, Number(t.props && t.props.r) || 150);

/**
 * Các mặc định của core, chép sang đây vì `public/map-editor/` là HTML +
 * global thuần, không bundler, nên `src/` không với tới được.
 *
 * `turretSize` là `DEFAULT_TURRET_PRESET.size` (`structures/Turret.ts`),
 * `chaseMargin` là `MONSTER_CHASE_MARGIN` (`Monster.ts`), `turretRange` là
 * tầm bắn mặc định của trụ. Bên kia đổi thì ở đây chỉ vẽ lệch một chút chứ
 * không hỏng — đây là bản xem trước, không phải nguồn sự thật.
 */
export const CORE_DEFAULTS = { turretRange: 430, chaseMargin: 350, turretSize: 92 };

/**
 * Đọc một chỉ số của slot: `stats` của chính nó, rồi tới tuning của map, rồi
 * tới mặc định của core — đúng ba lớp mà `MapTuning` merge bên kia.
 *
 * Ở `state.js` chứ không phải `render.js` vì cả hai đều cần: `render` để vẽ
 * đúng cỡ, và `pickR`/AABB dưới đây để bắt chuột đúng chỗ đã vẽ. Hai bản sao
 * của cùng công thức là hai bản sẽ lệch nhau, và lúc lệch thì cái người ta
 * thấy không còn là cái người ta bấm trúng.
 */
export function slotStat(t, key, group, fallback) {
  const own = t.props && t.props.stats ? t.props.stats[key] : undefined;
  if (Number.isFinite(+own)) return +own;
  const tuning = (E.meta && E.meta.tuning && E.meta.tuning[group]) || {};
  if (Number.isFinite(+tuning[key])) return +tuning[key];
  return fallback;
}

/** Bán kính thân trụ (world) — `size / 2`, đúng chỗ trụ thật sự đứng. */
export const turretBodyR = (t) =>
  Math.max(1, slotStat(t, "size", "turrets", CORE_DEFAULTS.turretSize) / 2);

/**
 * Bán kính bắt chuột.
 *
 * Vòng tròn dùng bán kính thật. **Trụ cũng vậy** — nó từng là một ô vuông cố
 * định 12px màn hình, tức là thứ người ta bấm trúng không liên quan gì tới
 * thứ người ta nhìn thấy; thân trụ mặc định rộng 92px world, gần ba thân lính
 * xếp cạnh nhau, mà vùng bấm thì bé tí ở giữa.
 *
 * `Math.max` với cỡ màn hình là chỗ duy nhất còn nói dối, và nó nói dối đúng
 * hướng: zoom ra thật xa thì thân trụ chỉ còn vài pixel, và một đối tượng
 * không bấm nổi thì tệ hơn một vùng bấm rộng hơn hình vẽ.
 */
/**
 * Bán kính bắt chuột. Xuất ra vì `mapEditorSlotShapes.test.ts` kiểm đúng cái
 * bất biến "bấm trúng thứ mình nhìn thấy" trên chính hàm này.
 */
export const pickR = (t) => {
  const screenFloor = Math.max(6, MARKER_PX / Cam.scale);
  if (KIND[t.type].shape === "circle") return circleR(t);
  if (t.type === "structure") return Math.max(turretBodyR(t), screenFloor);
  return screenFloor;
};

/* ------------------------- thuộc tính theo loại ------------------------- */

/** Màu của phe theo thứ tự khai báo — dùng chung cho canvas lẫn bảng bên. */
const FACTION_COLORS = ["#5b8cff", "#d962c8", "#f0883e", "#46c95f"];
export const factionColor = (id) => {
  const i = E.meta.factions.indexOf(id);
  return i >= 0 ? FACTION_COLORS[i % FACTION_COLORS.length] : "#8b98ab";
};

/** Phe thứ `i` của map, luôn trả về một chuỗi dùng được. */
export const factionAt = (i) => (E.meta.factions && E.meta.factions[i]) || E.meta.factions[0] || "amber";

export const laneIds = () =>
  E.terrains.filter((t) => t.type === "lane").map((t) => (t.props && t.props.id) || "").filter(Boolean);

/** Điền nốt những field mà schema đòi, giữ nguyên cái người dùng đã đặt. */
export function withDefaults(kind, props) {
  const p = Object.assign({}, props);
  switch (kind) {
    case "spawn":
      if (!p.faction) p.faction = factionAt(0);
      if (!(p.r > 0)) p.r = 150;
      break;
    case "structure":
      if (!p.faction) p.faction = factionAt(0);
      p.kind = "turret";                       // StructureKind hiện chỉ có 'turret'
      break;
    case "minion":
      if (!p.faction) p.faction = factionAt(0);
      if (!p.lane) p.lane = laneIds()[0] || "mid";
      if (p.scatter != null && !(p.scatter >= 0)) delete p.scatter;
      break;
    case "neutral":
      if (!p.role) p.role = "camp";
      // 'camp' is the default and is never written down — a point drawn before
      // this field existed and a point drawn now must export identically.
      if (p.kind !== "object") delete p.kind;
      if (!(p.r > 0)) p.r = 150;
      if (p.rotationDeg != null && !Number.isFinite(p.rotationDeg)) delete p.rotationDeg;
      break;
    case "lane":
      if (!p.id) p.id = "mid";
      if (!p.from) p.from = factionAt(0);
      if (!p.to) p.to = factionAt(1);
      break;
    default:
      return {};
  }
  return p;
}

/** Toàn bộ trạng thái runtime. */
export const E = {
  // dữ liệu map
  mapId: null,
  mapName: "Map",
  mapSize: [6400, 6400],
  background: null,
  terrains: [],
  /**
   * Nửa "nhẹ" của map theo MapSummary: id, danh sách phe, và bảng tuning.
   *
   * `MapTuning` là kiểu THẬT của core, `import` thẳng chứ không mô tả lại —
   * thứ mà bản JavaScript thuần không làm được. Trước đây chỗ này là một
   * object không tên, `tuning` được gắn vào lúc chạy, và cả một bài test
   * (`editorTuningSchema.test.ts`) tồn tại chỉ để dò chữ xem editor có đang
   * ghi vào một khoá mà core không đọc hay không. Giờ thì trình biên dịch trả
   * lời câu đó.
   */
  meta: { id: "my-map", factions: ["amber", "jade"] } as {
    id: string;
    factions: string[];
    tuning?: MapTuning;
  },

  // tương tác
  tool: "select",           // select | marquee | hand | pen
  selection: [],            // tham chiếu tới terrain
  hover: null,
  hoverVertex: null,        // { t, i }
  dragVertex: null,
  /**
   * Chế độ sửa đỉnh: khi khác null, mọi thao tác kéo trên canvas nhắm vào
   * ĐỈNH của polygon này chứ không phải vào các polygon khác. Đây là ranh
   * giới tường minh khiến "kéo để quét chọn" có thể vừa chọn nhiều polygon
   * (ngoài mode) vừa chọn nhiều đỉnh (trong mode) mà không nhập nhằng.
   */
  editing: null,
  /** Các đỉnh đang chọn — giữ THAM CHIẾU tới mảng [x,y], không giữ chỉ số:
   *  chèn/xoá đỉnh khác sẽ làm chỉ số lệch, còn tham chiếu thì không. */
  vertexSel: new Set(),
  marquee: null,            // { x0, y0, x1, y1 } — toạ độ world
  pen: null,                // { pts: [[x,y]...] } khi đang vẽ polygon
  mouse: [0, 0],            // world
  pointerOnCanvas: false,

  // hiển thị
  showGrid: true,
  showBg: false,
  showMinimap: false,
  showDummy: false,
  showVertexIndex: false,
  /**
   * Chỗ hỏng mà bảng "Kiểm tra" vừa bay tới — `{ x, y, since }`, hoặc null.
   *
   * Ở đây chứ không phải trong ui.js vì `render.js` là bên vẽ nó, và hai file
   * đó không import lẫn nhau: `E` là chỗ duy nhất chúng gặp được. Tự hết hạn
   * sau `CHECK_FOCUS_MS` (`render.js`), nên không có gì phải dọn.
   */
  checkFocus: null,
  /**
   * Lớp nào đang hiện. **Sinh ra từ `KIND`**, không gõ tay.
   *
   * Gõ tay thì thêm một loại mới là quên một dòng, và cái quên đó im lặng theo
   * kiểu tệ nhất có thể: `undefined` là falsy, nên `pickTerrain` và
   * `pickInRect` bỏ qua đối tượng — không bấm vào được, không quét chọn được —
   * và `render.ts` cũng bỏ qua nốt. Đã xảy ra đúng một lần, 2026-09-01, với
   * một loại slot sau đó bị gỡ vì lý do khác: người dùng thêm một cái, thấy
   * một vòng tròn (lớp phủ của vùng chọn — thứ duy nhất còn vẽ), bấm ra chỗ
   * khác là "nó mất luôn". Không có gì bị xoá cả; nó vô hình và không bắt được
   * chuột kể từ frame đầu tiên.
   */
  visible: Object.fromEntries(TYPES.map((kind) => [kind, true])),
  snap: false,
  gridSize: 50,

  // môi trường
  images: { dummy: null, bg: null },
  view: { w: 0, h: 0, dpr: 1 },
  isTouch: false,
  wheelMode: "auto",        // auto | zoom | pan
  zoomSpeed: 1,             // hệ số nhân độ nhạy zoom của con lăn/touchpad
  inspectorOpen: true,
  /**
   * Tên các mục trong bảng thuộc tính đang **mở**.
   *
   * Lưu danh sách mở chứ không phải danh sách gập, vì mặc định là gập hết:
   * chưa có gì lưu = mảng rỗng = đóng tất, và một mục mới thêm sau này cũng
   * đóng sẵn mà không phải sửa gì. Danh sách gập thì ngược lại — mục mới sẽ
   * bung ra chỉ vì chưa ai từng đóng nó.
   */
  openSections: [] as string[],
};

/* ============================== camera ================================= */

export const Cam = {
  x: 0, y: 0, scale: 1,
  tx: 0, ty: 0, tscale: 1,
  MIN: 0.015,
  MAX: 14,

  /**
   * Đã bám sát mục tiêu chưa — dùng để dừng vòng lặp vẽ. Ngưỡng tính theo
   * pixel màn hình chứ không theo đơn vị map: lệch 0.02 đơn vị map lúc thu
   * nhỏ hết cỡ là vô hình, không đáng để chạy thêm hàng chục frame.
   */
  settled() {
    const s = this.tscale;
    return (
      Math.abs(this.x - this.tx) * s < 0.05 &&
      Math.abs(this.y - this.ty) * s < 0.05 &&
      Math.abs(this.scale - this.tscale) < s * 5e-4
    );
  },

  snapToTarget() {
    this.x = this.tx;
    this.y = this.ty;
    this.scale = this.tscale;
  },

  /** Nội suy mượt về mục tiêu; dt tính theo giây để tốc độ không phụ thuộc FPS. */
  step(dt) {
    if (this.settled()) {
      this.snapToTarget();
      return true;
    }
    const k = 1 - Math.pow(0.001, Math.min(dt, 0.05));
    this.x = Geom.lerp(this.x, this.tx, k);
    this.y = Geom.lerp(this.y, this.ty, k);
    this.scale = Geom.lerp(this.scale, this.tscale, k);
    return false;
  },

  toWorld(sx, sy, out = [0, 0]) {
    out[0] = (sx - E.view.w * 0.5) / this.scale + this.x;
    out[1] = (sy - E.view.h * 0.5) / this.scale + this.y;
    return out;
  },

  toScreen(wx, wy, out = [0, 0]) {
    out[0] = (wx - this.x) * this.scale + E.view.w * 0.5;
    out[1] = (wy - this.y) * this.scale + E.view.h * 0.5;
    return out;
  },

  /** Hình chữ nhật world đang nhìn thấy [l, t, r, b], nới thêm `pad` px màn hình. */
  viewRect(pad = 0, out = [0, 0, 0, 0]) {
    const hw = (E.view.w * 0.5 + pad) / this.scale;
    const hh = (E.view.h * 0.5 + pad) / this.scale;
    out[0] = this.x - hw;
    out[1] = this.y - hh;
    out[2] = this.x + hw;
    out[3] = this.y + hh;
    return out;
  },

  /**
   * Zoom giữ nguyên điểm dưới con trỏ (sx, sy) — đây là điều bản cũ không có:
   * nó luôn zoom quanh tâm màn hình nên phải rê chuột lại sau mỗi lần cuộn.
   */
  zoomAt(sx, sy, factor, instant = true) {
    const s0 = this.tscale;
    const s1 = Geom.clamp(s0 * factor, this.MIN, this.MAX);
    if (s1 === s0) return;
    const ox = sx - E.view.w * 0.5;
    const oy = sy - E.view.h * 0.5;
    const wx = ox / s0 + this.tx;
    const wy = oy / s0 + this.ty;
    this.tx = wx - ox / s1;
    this.ty = wy - oy / s1;
    this.tscale = s1;
    if (instant) this.snapToTarget();
  },

  panBy(dxScreen, dyScreen, instant = true) {
    this.tx -= dxScreen / this.tscale;
    this.ty -= dyScreen / this.tscale;
    if (instant) {
      this.x -= dxScreen / this.scale;
      this.y -= dyScreen / this.scale;
    }
  },

  moveTo(x, y, scale, instant = false) {
    this.tx = x;
    this.ty = y;
    if (scale != null) this.tscale = Geom.clamp(scale, this.MIN, this.MAX);
    if (instant) this.snapToTarget();
  },

  /**
   * Phần màn hình còn trống thật sự: thanh công cụ che phía trên, bảng thuộc
   * tính che bên phải (máy tính) hoặc phía dưới (điện thoại). Nhờ vậy lệnh
   * "vừa màn hình" canh map vào chỗ nhìn được, không nằm nửa dưới bảng.
   */
  insets() {
    const ins = { top: 64, right: 0, bottom: 40, left: 0 };
    const panel = document.getElementById("inspector");
    if (panel && E.inspectorOpen && !panel.classList.contains("closed")) {
      const r = panel.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        if (window.innerWidth <= 680) ins.bottom = Math.max(ins.bottom, E.view.h - r.top + 8);
        else ins.right = Math.max(ins.right, E.view.w - r.left + 8);
      }
    }
    return ins;
  },

  /** Đưa một vùng world lọt vừa phần màn hình còn trống. */
  fitRect(rect, pad = 90, instant = false) {
    const w = Math.max(1, rect[2] - rect[0]);
    const h = Math.max(1, rect[3] - rect[1]);
    const ins = this.insets();
    const boxW = Math.max(120, E.view.w - ins.left - ins.right);
    const boxH = Math.max(120, E.view.h - ins.top - ins.bottom);
    const scale = Geom.clamp(
      Math.min((boxW - pad * 2) / w, (boxH - pad * 2) / h),
      this.MIN, this.MAX
    );

    // Tâm vùng trống (toạ độ màn hình) phải trùng tâm của rect.
    const cx = ins.left + boxW / 2;
    const cy = ins.top + boxH / 2;
    this.tx = (rect[0] + rect[2]) / 2 - (cx - E.view.w / 2) / scale;
    this.ty = (rect[1] + rect[3]) / 2 - (cy - E.view.h / 2) / scale;
    this.tscale = scale;
    if (instant) this.snapToTarget();
  },
};

/* ============================== terrain ================================ */

let idSeed = 0;
export function newId() {
  idSeed = (idSeed + 1) % 1e6;
  return Date.now().toString(36) + "-" + idSeed.toString(36) + Math.random().toString(36).slice(2, 5);
}

/** Tính lại mảnh lồi + AABB cho terrain. Gọi sau MỌI thay đổi hình học. */
export function refreshTerrain(t) {
  t._path = null;
  const shape = KIND[t.type] ? KIND[t.type].shape : "poly";

  if (shape === "poly") {
    // Game chỉ xử lý đúng polygon LỒI (xem TerrainField.ts trong moba2d-core),
    // nên mảnh lồi được giữ sẵn ở đây và chính là thứ đi vào bản export.
    t.polygons = Geom.decompose(t.polygon);
    t._bbox = Geom.bounds(t.polygon, t.position[0], t.position[1], t._bbox || [0, 0, 0, 0]);
    return t;
  }

  t.polygons = [];
  if (shape === "line") {
    t._bbox = Geom.bounds(t.polygon, t.position[0], t.position[1], t._bbox || [0, 0, 0, 0]);
    t._bbox[0] -= 24; t._bbox[1] -= 24; t._bbox[2] += 24; t._bbox[3] += 24;
    return t;
  }

  // AABB cho quét chọn và cho lọc khung nhìn. Trụ dùng thân thật của nó: hộp
  // 45px cố định gần đúng bằng thân mặc định (46) hoàn toàn do trùng hợp, và
  // một trụ khai `size` lớn hơn sẽ bị cắt mất khỏi khung nhìn trước khi ra
  // khỏi màn hình.
  const r =
    shape === "circle" ? circleR(t)
    : t.type === "structure" ? Math.max(POINT_BOX, turretBodyR(t))
    : POINT_BOX;
  t._bbox = [t.position[0] - r, t.position[1] - r, t.position[0] + r, t.position[1] + r];
  return t;
}

/**
 * Hình đổi khi đang kéo đỉnh: bỏ cache đường vẽ + AABB, nhưng hoãn việc cắt
 * lồi (decomp) tới lúc thả tay — decomp mỗi frame là thứ làm bản cũ giật.
 */
export function markShapeDirty(t) {
  t._path = null;
  t._bbox = Geom.bounds(t.polygon, t.position[0], t.position[1], t._bbox || [0, 0, 0, 0]);
}

/** Chỉ vị trí đổi (kéo thả) — khỏi decomp lại, chỉ dời AABB. */
export function moveTerrainTo(t, x, y) {
  const dx = x - t.position[0];
  const dy = y - t.position[1];
  if (dx === 0 && dy === 0) return;
  t.position[0] = x;
  t.position[1] = y;
  if (t._bbox) {
    t._bbox[0] += dx; t._bbox[1] += dy;
    t._bbox[2] += dx; t._bbox[3] += dy;
  } else {
    refreshTerrain(t);
  }
}

export function makeTerrain(type, position, polygon, props?) {
  const kind = KIND[type] ? type : "wall";
  const t = {
    id: newId(),
    type: kind,
    position: [Math.round(position[0]), Math.round(position[1])],
    polygon: (polygon || []).map((p) => [Math.round(p[0]), Math.round(p[1])]),
    polygons: [],
    props: withDefaults(kind, props || {}),
  };
  return refreshTerrain(t);
}

/**
 * Gộp các terrain dính cạnh thành ít hình hơn — vỏ chỉnh sửa của `Geom.union`.
 *
 * Gộp theo TỪNG type và không bao giờ vắt qua, đó là điều làm nó an toàn: một
 * bụi nằm sát tường dùng chung cạnh với tường y hệt hai mảnh tường dùng chung
 * cạnh, nên nếu chỉ xét hình học thì bụi bị hàn vào tường và chỗ nấp lặng lẽ
 * biến thành địa hình. Slot và lane đi thẳng qua: chúng không phải polygon.
 *
 * Hình có lỗ thì không gộp. Một terrain chỉ mang MỘT vòng, nên bốn bức tường
 * quây quanh một khoảng sân sẽ mất cái sân nếu ép thành một hình — sân biến
 * thành tường đặc. Chỉ riêng nhóm nào sinh ra lỗ mới giữ nguyên mảnh gốc;
 * phần còn lại của map vẫn gộp bình thường.
 *
 * KHÔNG tự chạy. Map mang theo `authoring` là map đã ở dạng người ta vẽ và
 * phải để yên; map không có thì đang ở dạng đã cắt, và dựng lại hay không là
 * quyết định của tác giả chứ không phải chuyện tự xảy ra khi mở map lên.
 */
export function mergeTerrains(list) {
  const out = [];
  const byType = new Map();
  for (const t of list || []) {
    if (!isPoly(t) || !t.polygon || t.polygon.length < 3) {
      out.push(t);
      continue;
    }
    if (!byType.has(t.type)) byType.set(t.type, []);
    byType.get(t.type).push(t);
  }

  for (const [type, group] of byType) {
    if (group.length < 2) {
      out.push(...group);
      continue;
    }
    const world = group.map((t) =>
      t.polygon.map((p) => [p[0] + t.position[0], p[1] + t.position[1]])
    );
    const rings = Geom.union(world);
    const outers = rings.filter((r) => Geom.signedArea(r) > 0);
    // Không tin kết quả nếu nó không phủ đúng cái các mảnh gốc phủ. `union`
    // đã từng gộp Sân Thử Nghiệm thành một vệt chéo cắt ngang map và không có
    // gì trên đường đi tới màn hình nhận ra — nên phép gộp phải tự chứng minh
    // trước khi được nhận. Không chứng minh được thì để nguyên mảnh gốc: mất
    // một tiện ích còn hơn mất map.
    if (!outers.length || !Geom.unionCovers(world, rings)) {
      out.push(...group);
      continue;
    }

    // Vòng ngoài nào đang ôm một lỗ thì không dựng thành hình được.
    const holed = new Set();
    for (const h of rings) {
      if (Geom.signedArea(h) >= 0) continue;
      const i = outers.findIndex((o) => Geom.pointInPolygon(h[0][0], h[0][1], o));
      if (i >= 0) holed.add(i);
    }

    // Mỗi mảnh gốc thuộc về vòng ngoài NHỎ NHẤT chứa nó — dùng để lấy props
    // cho hình gộp, và để trả lại nguyên vẹn những mảnh thuộc vòng có lỗ.
    //
    // Nhỏ nhất chứ không phải cái đầu tiên tìm thấy: các vòng ngoài lồng nhau
    // được. Ở Sân Thử Nghiệm, vòng ngoài của khung viền bao gần hết map, nên
    // "cái đầu tiên" gán cả sáu khối rừng cho nó — khung có lỗ nên bị giữ
    // nguyên, và sáu khối kia vừa được gộp thành hình mới vừa bị đẩy lại
    // nguyên bản. 12 mảnh vào, 18 hình ra.
    const owner = world.map((poly) => {
      const c = Geom.centroid(poly);
      let best = -1;
      let bestArea = Infinity;
      for (let i = 0; i < outers.length; i++) {
        if (!Geom.pointInPolygon(c[0], c[1], outers[i])) continue;
        const a = Geom.area(outers[i]);
        if (a < bestArea) {
          bestArea = a;
          best = i;
        }
      }
      return best;
    });

    outers.forEach((ring, i) => {
      if (holed.has(i)) return;
      const c = Geom.centroid(ring);
      const origin = [Math.round(c[0]), Math.round(c[1])];
      const first = owner.indexOf(i);
      out.push(
        makeTerrain(
          type,
          origin,
          ring.map((p) => [p[0] - origin[0], p[1] - origin[1]]),
          first >= 0 ? group[first].props : group[0].props
        )
      );
    });
    group.forEach((t, gi) => {
      const i = owner[gi];
      if (i < 0 || holed.has(i)) out.push(t);
    });
  }
  return out;
}

/** Đọc dữ liệu đã lưu (kể cả bản firebase cũ, nơi mọi field là chuỗi JSON). */
export function normalizeTerrain(raw) {
  const parse = (v, fb) => {
    if (typeof v === "string") {
      try { return JSON.parse(v); } catch (e) { return fb; }
    }
    return v == null ? fb : v;
  };
  // Map đời trước dùng brush/turret1/turret2; đổi sang từ vựng của moba2d.
  let type = raw.type;
  let props = raw.props && typeof raw.props === "object" ? Object.assign({}, raw.props) : {};
  if (type === "brush") type = "bush";
  if (type === "turret1" || type === "turret2") {
    props = { faction: factionAt(type === "turret1" ? 0 : 1), kind: "turret" };
    type = "structure";
  }
  if (!KIND[type]) type = "wall";

  const t = {
    id: raw.id || newId(),
    type: type,
    position: parse(raw.position, [0, 0]),
    polygon: parse(raw.polygon, []),
    polygons: parse(raw.polygons, []) || [],
    props: withDefaults(type, props),
  };
  if (!Array.isArray(t.position) || t.position.length < 2) t.position = [0, 0];
  if (!Array.isArray(t.polygon)) t.polygon = [];
  t.polygon = t.polygon.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [+p[0] || 0, +p[1] || 0]);
  return refreshTerrain(t);
}

/** Bản sao gọn, đã làm tròn — dùng cho localStorage, file và undo. */
export function serializeTerrains(list = E.terrains) {
  return list.map((t) => ({
    id: t.id,
    type: t.type || "wall",
    position: [Math.round(t.position[0]), Math.round(t.position[1])],
    polygon: t.polygon.map((p) => [Math.round(p[0]), Math.round(p[1])]),
    polygons: (t.polygons || []).map((poly) => poly.map((p) => [Math.round(p[0]), Math.round(p[1])])),
    props: t.props && Object.keys(t.props).length ? t.props : undefined,
  }));
}

export function countByType() {
  const c = {};
  for (const k of TYPES) c[k] = 0;
  for (const t of E.terrains) if (c[t.type] != null) c[t.type]++;
  return c;
}

/* ============================= selection =============================== */

export const Sel = {
  has: (t) => E.selection.indexOf(t) !== -1,
  get size() { return E.selection.length; },
  get one() { return E.selection.length === 1 ? E.selection[0] : null; },

  set(list) {
    // Lọc rác: một tham chiếu chết (map vừa bị undo/đóng) lọt vào đây sẽ làm
    // nổ toàn bộ vòng đồng bộ UI ở tận nơi khác, rất khó lần ra.
    E.selection = Array.isArray(list) ? list.filter((t) => t && KIND[t.type]) : [];
    E.hoverVertex = null;
    // Chọn sang thứ khác thì thoát chế độ sửa đỉnh của hình cũ.
    if (E.editing && (E.selection.length !== 1 || E.selection[0] !== E.editing)) {
      E.editing = null;
      E.vertexSel.clear();
    }
    afterSelectionChange();
  },

  clear() {
    E.editing = null;
    E.vertexSel.clear();
    if (E.selection.length === 0) return;
    E.selection.length = 0;
    E.hoverVertex = null;
    afterSelectionChange();
  },

  add(t) {
    if (!t || Sel.has(t)) return;
    E.selection.push(t);
    afterSelectionChange();
  },

  remove(t) {
    const i = E.selection.indexOf(t);
    if (i === -1) return;
    E.selection.splice(i, 1);
    afterSelectionChange();
  },

  toggle(t) {
    if (Sel.has(t)) Sel.remove(t); else Sel.add(t);
  },

  all() {
    Sel.set(E.terrains.filter((t) => E.visible[t.type]));
  },

  /** AABB bao toàn bộ vùng chọn, hoặc null. */
  bounds() {
    if (E.selection.length === 0) return null;
    const r = [Infinity, Infinity, -Infinity, -Infinity];
    for (const t of E.selection) {
      const b = t._bbox || refreshTerrain(t)._bbox;
      if (b[0] < r[0]) r[0] = b[0];
      if (b[1] < r[1]) r[1] = b[1];
      if (b[2] > r[2]) r[2] = b[2];
      if (b[3] > r[3]) r[3] = b[3];
    }
    return r;
  },

  /** Tâm của vùng chọn — gốc để xoay / phóng to nhóm. */
  center() {
    const b = Sel.bounds();
    return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [Cam.x, Cam.y];
  },
};

function afterSelectionChange() {
  if (typeof UI !== "undefined") UI.syncSelection();
  requestRender();
}

/* ============================== hit test =============================== */

/**
 * Terrain dưới con trỏ. Duyệt từ trên xuống (phần tử cuối vẽ trên cùng), lọc
 * nhanh bằng AABB rồi mới ray-cast. Vẫn giữ luật cũ: nước nhường chỗ cho vật
 * thể khác đè lên nó.
 */
export function pickTerrain(wx, wy) {
  let water = null;
  for (let i = E.terrains.length - 1; i >= 0; i--) {
    const t = E.terrains[i];
    if (!E.visible[t.type]) continue;
    const b = t._bbox || refreshTerrain(t)._bbox;
    if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) continue;

    let hit;
    const shape = KIND[t.type].shape;
    if (shape === "poly") {
      hit = Geom.pointInPolygon(wx, wy, t.polygon, t.position[0], t.position[1]);
    } else if (shape === "line") {
      hit = nearPolyline(wx, wy, t, 10 / Cam.scale);
    } else {
      const r = pickR(t);
      const dx = wx - t.position[0], dy = wy - t.position[1];
      hit = dx * dx + dy * dy <= r * r;
    }
    if (!hit) continue;
    if (t.type === "water") { if (!water) water = t; continue; }
    return t;
  }
  return water;
}

/** Con trỏ có nằm sát đường gấp khúc của một lane không? */
function nearPolyline(wx, wy, t, tol) {
  const pts = t.polygon, ox = t.position[0], oy = t.position[1];
  const tol2 = tol * tol;
  for (let i = 1; i < pts.length; i++) {
    const d = Geom.segDistSq(
      wx, wy,
      pts[i - 1][0] + ox, pts[i - 1][1] + oy,
      pts[i][0] + ox, pts[i][1] + oy
    );
    if (d <= tol2) return true;
  }
  return false;
}

/**
 * Polygon đang lộ tay cầm đỉnh: cái đang sửa, hoặc cái duy nhất đang chọn.
 * Chọn một hình rồi kéo thẳng một đỉnh vẫn dùng được như trước, không cần
 * vào mode; mode chỉ thêm khả năng chọn NHIỀU đỉnh.
 */
export function vertexHost() {
  if (E.editing && hasVerts(E.editing)) return E.editing;
  const one = Sel.one;
  return one && hasVerts(one) ? one : null;
}

/** Đỉnh dưới con trỏ của polygon đang lộ tay cầm. `r` là bán kính world. */
export function pickVertex(wx, wy, r) {
  const t = vertexHost();
  if (!t) return null;
  const r2 = r * r;
  let best = null, bestD = Infinity;
  const ox = t.position[0], oy = t.position[1];
  for (let i = 0; i < t.polygon.length; i++) {
    const dx = wx - (t.polygon[i][0] + ox);
    const dy = wy - (t.polygon[i][1] + oy);
    const d = dx * dx + dy * dy;
    if (d <= r2 && d < bestD) { bestD = d; best = { t, i }; }
  }
  return best;
}

/* ------------------------- chế độ sửa đỉnh -------------------------- */

/** Số đỉnh tối thiểu: polygon cần 3, đường gấp khúc cần 2. */
export const minVerts = (t) => (isLine(t) ? 2 : 3);

export function enterEdit(t) {
  if (!t || !hasVerts(t)) return false;
  E.editing = t;
  E.vertexSel.clear();
  if (!Sel.has(t) || E.selection.length !== 1) Sel.set([t]);
  else afterSelectionChange();
  return true;
}

export function exitEdit() {
  if (!E.editing) return false;
  E.editing = null;
  E.vertexSel.clear();
  if (typeof UI !== "undefined") UI.syncSelection();
  requestRender();
  return true;
}

export const setVertexSel = (points) => {
  E.vertexSel.clear();
  for (const p of points || []) E.vertexSel.add(p);
  if (typeof UI !== "undefined") UI.syncSelection();
  requestRender();
};

export const toggleVertex = (p) => {
  if (E.vertexSel.has(p)) E.vertexSel.delete(p); else E.vertexSel.add(p);
  if (typeof UI !== "undefined") UI.syncSelection();
  requestRender();
};

/** Các đỉnh của polygon đang sửa nằm trong hình chữ nhật world. */
export function pickVerticesInRect(t, rect) {
  const out = [];
  const ox = t.position[0], oy = t.position[1];
  for (const p of t.polygon) {
    if (Geom.rectContainsPoint(rect, p[0] + ox, p[1] + oy)) out.push(p);
  }
  return out;
}

/**
 * Vùng quét có "chạm" vào đối tượng này không.
 *
 * Hình có đường viền (polygon, lane): phải có một đỉnh nằm trong vùng hoặc
 * một cạnh cắt qua vùng. Vùng chọn nằm lọt trong ruột hình thì KHÔNG tính —
 * đó chính là cách chọn được mấy hình nhỏ nằm trong phần lõm của một
 * polygon lớn mà không vơ luôn hình lớn.
 *
 * Điểm đánh dấu (trụ, spawn, bãi quái…): lấy vị trí của nó, vì đó là thứ
 * người dùng nhắm vào.
 */
function hitsRect(t, rect) {
  const shape = KIND[t.type].shape;
  if (shape === "poly" || shape === "line") {
    return Geom.outlineHitsRect(t.polygon, t.position[0], t.position[1], rect, shape === "poly");
  }
  return Geom.rectContainsPoint(rect, t.position[0], t.position[1]);
}

/** Mọi terrain vùng quét chạm tới — dùng cho chọn nhiều bằng kéo thả. */
export function pickInRect(rect) {
  const out = [];
  for (const t of E.terrains) {
    if (!E.visible[t.type]) continue;
    // AABB lọc nhanh trước, rồi mới xét hình học thật.
    const b = t._bbox || refreshTerrain(t)._bbox;
    if (!Geom.rectsOverlap(b, rect)) continue;
    if (hitsRect(t, rect)) out.push(t);
  }
  return out;
}

/* =============================== undo ================================== */

/**
 * Lịch sử kiểu snapshot. Map thực tế cỡ vài trăm polygon nên một snapshot
 * JSON chỉ tốn vài chục KB và đổi lại là undo tuyệt đối chính xác.
 */
export const History = {
  past: [],
  future: [],
  current: null,
  LIMIT: 80,

  snapshot() {
    return JSON.stringify({
      mapSize: E.mapSize,
      meta: E.meta,
      terrains: serializeTerrains(),
      selection: E.selection.map((t) => t.id),
    });
  },

  reset() {
    this.past.length = 0;
    this.future.length = 0;
    this.current = this.snapshot();
    if (typeof UI !== "undefined") UI.syncHistory();
  },

  /** Ghi nhận một thay đổi đã hoàn tất. */
  push() {
    const snap = this.snapshot();
    if (snap === this.current) return false;
    if (this.current != null) {
      this.past.push(this.current);
      if (this.past.length > this.LIMIT) this.past.shift();
    }
    this.current = snap;
    this.future.length = 0;
    if (typeof UI !== "undefined") UI.syncHistory();
    return true;
  },

  restore(snap) {
    const d = JSON.parse(snap);
    E.mapSize = d.mapSize || E.mapSize;
    if (d.meta) E.meta = d.meta;
    E.terrains = (d.terrains || []).map(normalizeTerrain);
    const ids = new Set(d.selection || []);
    E.selection = E.terrains.filter((t) => ids.has(t.id));
    E.hoverVertex = null;
    E.hover = null;
    E.dragVertex = null;
    // restore() dựng terrain MỚI nên mọi tham chiếu tới đỉnh cũ đều chết.
    E.editing = null;
    E.vertexSel.clear();
    this.current = snap;
  },

  canUndo() { return this.past.length > 0; },
  canRedo() { return this.future.length > 0; },

  undo() {
    if (!this.past.length) return false;
    this.future.push(this.current);
    this.restore(this.past.pop());
    return true;
  },

  redo() {
    if (!this.future.length) return false;
    this.past.push(this.current);
    this.restore(this.future.pop());
    return true;
  },
};

/**
 * Chốt một thay đổi: đẩy vào undo, hẹn giờ autosave, đồng bộ UI, vẽ lại.
 * Mọi lệnh sửa map đều kết thúc bằng hàm này.
 */
export function commit() {
  History.push();
  Store.scheduleSave();
  if (typeof UI !== "undefined") UI.syncSelection();
  requestRender();
}
