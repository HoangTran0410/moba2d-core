/* =========================================================================
   ui.js — toàn bộ phần DOM: thanh công cụ, bảng thuộc tính, thanh trạng
   thái, hộp thoại, menu và toast.

   Không dùng thư viện ngoài. Hộp thoại tự viết để đồng bộ với giao diện
   (SweetAlert2 nặng 71KB và mang theo phong cách riêng của nó).
   ========================================================================= */

import { Cmd } from './commands';
import { Geom } from './geom';
import { TUNING_SCHEMA } from '@/game/config/tuningSchema';
// Imported from core, not copied into the editor. `legRig.ts` and
// `creatureSpec.ts` are pure — no p5, no game state, no unit — which is what
// `creatureSeam.test.ts` exists to keep true, and what lets the same walk the
// player sees in a match run inside this inspector.
import { Creature } from '@/game/render/creature/creature';
import { Spine } from '@/game/render/creature/spine';
import { RIG_DEFAULTS, resolveRig } from '@/game/render/creature/creatureSpec';
import { MAP_BACKGROUND_GREY } from '@/game/render/palette';
import { requestRender } from './frame';
import { Cam, E, KIND, SLOT_KINDS, Sel, TERRAIN_KINDS, circleR, commit, countByType, factionColor, hasVerts, isLine, laneIds, newId } from './state';
import { Store } from './storage';

export const UI = (() => {
  const $ = (sel) => document.querySelector(sel);
  const modalRoot = () => $("#modal-root");

  const ico = (name, cls = "ico") =>
    `<svg class="${cls}" viewBox="0 0 24 24"><use href="#i-${name}"/></svg>`;

  /**
   * `attrs` and `html` are both optional, and saying so is the difference
   * between a helper and 98 compile errors: under `<script>` tags every call
   * site simply passed what it had, and nothing checked. The `?` marks state
   * the contract those call sites were already relying on.
   */
  function el(tag, attrs?, html?) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (html != null) n.innerHTML = html;
    return n;
  }

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtTime = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts);
    const now = Date.now();
    const diff = (now - ts) / 1000;
    if (diff < 60) return "vừa xong";
    if (diff < 3600) return Math.floor(diff / 60) + " phút trước";
    if (diff < 86400) return Math.floor(diff / 3600) + " giờ trước";
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  /* =============================== toast =============================== */

  function toast(msg, kind = "ok") {
    const icons = { ok: "check", warn: "alert", err: "x" };
    const n = el("div", { class: "toast" },
      `${ico(icons[kind] || "check", "ico ico-sm i-" + (kind === "err" ? "err" : kind === "warn" ? "warn" : "ok"))}<span>${esc(msg)}</span>`);
    $("#toast-root").appendChild(n);
    setTimeout(() => {
      n.classList.add("out");
      setTimeout(() => n.remove(), 220);
    }, 2200);
  }

  /**
   * Gợi ý có kèm hành động — khác `toast` ở chỗ nó ĐỢI.
   *
   * Một toast tự tắt sau 2.2 giây, đúng cho việc báo "đã xong". Cái này hỏi
   * một câu và người ta phải trả lời được, nên nó ở lại tới khi bị bấm hoặc bị
   * bỏ qua. Sinh ra vì lệnh gộp polygon nằm trong menu tràn và không ai tìm
   * thấy — chức năng không tìm ra được thì coi như không có.
   */
  function suggest({ text, actionLabel, onAction }) {
    const root = $("#toast-root");
    const existing = root.querySelector(".toast.suggest");
    if (existing) existing.remove();

    const bar = el("div", { class: "toast suggest" });
    bar.appendChild(el("span", {}, `${ico("help", "ico ico-sm i-warn")}<span>${esc(text)}</span>`));
    const dismiss = () => {
      bar.classList.add("out");
      setTimeout(() => bar.remove(), 220);
    };
    bar.append(
      el("button", {
        class: "btn primary sm",
        text: actionLabel,
        onclick: () => { dismiss(); onAction(); },
      }),
      el("button", { class: "btn sm ghost", text: "Bỏ qua", onclick: dismiss })
    );
    root.appendChild(bar);
    return dismiss;
  }

  /* ============================== hộp thoại ============================ */

  let modalDepth = 0;

  /**
   * Khung hộp thoại chung. `build(body, close)` dựng nội dung; `close(value)`
   * đóng và trả giá trị về cho Promise.
   */
  /**
   * The option bag is declared rather than inferred, and every key that a
   * caller may leave out says so. Inferred from the destructuring alone,
   * TypeScript reads all five as required and reports 28 perfectly good call
   * sites — which is the shape of most of what the move to a compiler turned
   * up: not bugs, but a contract that existed only in the heads of the people
   * writing the calls.
   *
   * `any` for the DOM handles and the resolved value is deliberate. These
   * dialogs build their bodies imperatively and resolve whatever their own
   * `close()` was handed; pretending otherwise would be a type that describes
   * a dialog system this file does not have.
   */
  function openModal({ icon, title, wide, build, onKey }: {
    icon?: string;
    title?: string;
    wide?: boolean;
    build?: (body: any, foot: any, close: (value?: any) => void) => void;
    onKey?: (event: KeyboardEvent, close: (value?: any) => void) => void;
  }): Promise<any> {
    return new Promise((resolve) => {
      modalDepth++;
      const scrim = el("div", { class: "scrim" });
      scrim.style.zIndex = String(100 + modalDepth);
      const modal = el("div", { class: "modal" + (wide ? " wide" : "") });

      const iconMap = { ok: ["check", "i-ok"], warn: ["help", "i-warn"], err: ["x", "i-err"], ask: ["help", "i-warn"] };
      const head = el("div", { class: "modal-head" },
        (icon && iconMap[icon] ? ico(iconMap[icon][0], "ico " + iconMap[icon][1]) : "") +
        `<h3>${esc(title || "")}</h3>`);
      // Nút đóng, trên MỌI hộp thoại. Trước đây chỉ có Escape và bấm ra ngoài
      // — hai thứ không nhìn thấy được, nên "Map của bạn" mở ra là trông như
      // không có đường nào thoát. Trên cảm ứng lại càng không: không có phím
      // Escape, và bấm ra ngoài là thứ phải đoán mới biết.
      head.appendChild(el("button", {
        class: "icon-btn modal-x",
        title: "Đóng (Esc)",
        "aria-label": "Đóng",
        onclick: () => close(undefined),
      }, ico("x", "ico ico-sm")));
      const body = el("div", { class: "modal-body" });
      const foot = el("div", { class: "modal-foot" });
      modal.append(head, body, foot);
      scrim.appendChild(modal);

      let done = false;
      const close = (value) => {
        if (done) return;
        done = true;
        modalDepth--;
        document.removeEventListener("keydown", key, true);
        scrim.remove();
        resolve(value);
      };

      const key = (e) => {
        if (scrim !== modalRoot().lastElementChild) return;
        if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(undefined); }
        else if (onKey) onKey(e, close);
      };
      document.addEventListener("keydown", key, true);
      scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim) close(undefined); });

      build?.(body, foot, close);
      modalRoot().appendChild(scrim);

      const focusable = modal.querySelector("input, textarea, select, .btn.primary");
      if (focusable) setTimeout(() => { focusable.focus(); if (focusable.select) focusable.select(); }, 30);
    });
  }

  const alertBox = ({ icon = "warn", title, text, html }: {
    icon?: string; title?: string; text?: string; html?: string;
  }) =>
    openModal({
      icon, title,
      build: (body, foot, close) => {
        body.innerHTML = html || `<p>${esc(text)}</p>`;
        foot.appendChild(el("button", { class: "btn primary", text: "Đã hiểu", onclick: () => close(true) }));
      },
      onKey: (e, close) => { if (e.key === "Enter") close(true); },
    });

  const confirmBox = ({ icon = "warn", title, text, confirmText = "Đồng ý", cancelText = "Huỷ", danger }: {
    icon?: string; title?: string; text?: string;
    confirmText?: string; cancelText?: string; danger?: boolean;
  }) =>
    openModal({
      icon, title,
      build: (body, foot, close) => {
        body.innerHTML = `<p>${esc(text)}</p>`;
        foot.append(
          el("button", { class: "btn", text: cancelText, onclick: () => close(false) }),
          el("button", { class: "btn " + (danger ? "danger" : "primary"), text: confirmText, onclick: () => close(true) })
        );
      },
      onKey: (e, close) => { if (e.key === "Enter") close(true); },
    });

  /** Hộp thoại nhiều ô nhập. Trả object theo key, hoặc undefined nếu huỷ. */
  const formBox = ({ icon, title, fields, confirmText = "Xong", note }: {
    icon?: string; title?: string; fields: any[]; confirmText?: string; note?: string;
  }) =>
    openModal({
      icon, title,
      build: (body, foot, close) => {
        for (const f of fields) {
          const wrap = el("div", { class: "fld" });
          wrap.appendChild(el("label", { text: f.label, for: "f-" + f.key }));
          let input;
          if (f.type === "select") {
            input = el("select", { class: "inp", id: "f-" + f.key });
            for (const o of f.options) {
              input.appendChild(el("option", { value: o.value, text: o.label }));
            }
            input.value = f.value;
          } else {
            input = el("input", {
              class: "inp", id: "f-" + f.key, type: f.type || "text",
              value: f.value == null ? "" : f.value,
              placeholder: f.placeholder || "",
              min: f.min, max: f.max, step: f.step,
            });
          }
          input.dataset.key = f.key;
          wrap.appendChild(input);
          body.appendChild(wrap);
        }
        if (note) body.appendChild(el("p", { class: "muted", text: note }));

        const submit = () => {
          const out = {};
          body.querySelectorAll("[data-key]").forEach((i) => {
            out[i.dataset.key] = i.type === "number" ? Number(i.value) : i.value;
          });
          close(out);
        };
        foot.append(
          el("button", { class: "btn", text: "Huỷ", onclick: () => close(undefined) }),
          el("button", { class: "btn primary", text: confirmText, onclick: submit })
        );
      },
      onKey: (e, close) => {
        if (e.key === "Enter" && (e.target as Element).tagName !== "TEXTAREA") {
          const btn = document.querySelector(".scrim:last-child .btn.primary");
          if (btn) (btn as HTMLElement).click();
        }
      },
    });

  /** Ô xem/copy JSON — thay cho textarea của SweetAlert2 ngày trước. */
  const textBox = ({ title, value, filename }: {
    title?: string; value?: string; filename?: string;
  }) =>
    openModal({
      title, wide: true,
      build: (body, foot, close) => {
        const ta = el("textarea", { class: "inp", spellcheck: "false", readonly: "" });
        ta.value = value;
        body.appendChild(el("p", { class: "muted", text: `${value.length.toLocaleString("vi-VN")} ký tự` }));
        body.appendChild(ta);
        foot.append(
          el("button", { class: "btn", text: "Đóng", onclick: () => close(false) }),
          filename ? el("button", {
            class: "btn", text: "Tải .json", onclick: () => Store.download(filename, value),
          }) : "",
          el("button", {
            class: "btn primary", text: "Copy",
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(value);
                toast("Đã copy vào clipboard");
              } catch (e) {
                ta.removeAttribute("readonly");
                ta.select();
                document.execCommand("copy");
                toast("Đã copy");
              }
            },
          })
        );
      },
    });

  /* ============================== menu thả =============================== */

  let openSheet = null;

  function closeSheet() {
    if (openSheet) { openSheet.remove(); openSheet = null; }
  }

  /**
   * Menu neo vào một nút. `groups` = [{title, items:[{icon,label,shortcut,
   * on, disabled, run}]}].
   */
  function sheet(anchor, groups) {
    closeSheet();
    const n = el("div", { class: "sheet" });
    for (const g of groups) {
      if (!g.items || !g.items.length) continue;
      if (n.childElementCount) n.appendChild(el("div", { class: "sheet-div" }));
      if (g.title) n.appendChild(el("div", { class: "sheet-title", text: g.title }));
      for (const it of g.items) {
        const b = el("button", {
          class: "sheet-item" + (it.on ? " on" : ""),
          onclick: () => { closeSheet(); it.run(); },
        }, `${ico(it.icon || "check")}<span>${esc(it.label)}</span>` +
        (it.shortcut ? `<span class="sk">${esc(it.shortcut)}</span>` : ""));
        if (it.disabled) b.setAttribute("disabled", "");
        n.appendChild(b);
      }
    }
    document.body.appendChild(n);

    const r = anchor.getBoundingClientRect();
    const w = n.offsetWidth, h = n.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    if (r.right > window.innerWidth - w - 8) left = Math.max(8, r.right - w);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    n.style.left = Math.max(8, left) + "px";
    n.style.top = top + "px";

    openSheet = n;
    setTimeout(() => {
      const off = (e) => {
        if (n.contains(e.target)) return;
        closeSheet();
        document.removeEventListener("pointerdown", off, true);
      };
      document.addEventListener("pointerdown", off, true);
    }, 0);
  }

  /* ============================ thanh công cụ =========================== */

  /**
   * Bố cục thanh công cụ. Nhóm `hide` sẽ ẩn ở màn hình hẹp — nhưng mọi lệnh
   * đều còn nguyên trong menu “…” nên điện thoại không mất chức năng nào.
   */
  const LEFT_GROUPS = [
    // Không có `min`, giống nhóm "Chơi thử" bên phải: đường ra khỏi editor
    // phải luôn nhìn thấy được. Trước đây nó không tồn tại, và cách duy nhất
    // để về game mà không mở một trận là bấm Back của trình duyệt.
    { items: ["file.backToGame"] },
    { items: ["tool.select", "tool.node", "tool.marquee", "tool.hand", "tool.pen", "tool.lane"], min: 860 },
    { items: ["tool.select", "tool.node", "tool.marquee", "tool.pen", "tool.lane"], min: 700, max: 860 },
    { items: ["tool.select", "tool.node", "tool.marquee", "tool.pen"], max: 700 },
    { items: ["ui.addMenu", "shape.duplicate", "shape.flipH", "shape.flipV", "shape.delete"], min: 1000 },
    { items: ["ui.addMenu", "shape.duplicate", "shape.delete"], min: 700, max: 1000 },
    { items: ["ui.addMenu"], max: 700 },
    { items: ["edit.undo", "edit.redo"], min: 560 },
    { items: ["edit.undo"], max: 560 },
  ];
  const RIGHT_GROUPS = [
    { items: ["view.grid", "view.snap", "view.bg", "view.minimap"], min: 940 },
    { items: ["file.save", "file.import", "file.exportGeometry"], min: 780 },
    // Riêng một nhóm, và không có `min`: "Chơi thử" là việc người ta làm
    // nhiều nhất trên màn hình này, nên nó không bao giờ bị thu gọn vào menu
    // "…" như mấy lệnh file bên trên.
    { items: ["file.playtest"] },
    { items: ["help.shortcuts"], min: 1080 },
  ];

  const btnRefs = new Map();
  let mqWired = false;

  /**
   * Thanh công cụ được dựng lại theo bề rộng màn hình thay vì ẩn bằng CSS —
   * như vậy không bao giờ còn vạch ngăn mồ côi cạnh một nhóm đã ẩn. Mọi lệnh
   * bị lược đi vẫn nằm đủ trong menu “…”.
   */
  function buildToolbar() {
    btnRefs.clear();
    const w = window.innerWidth;
    const mk = (host, groups) => {
      host.innerHTML = "";
      for (const g of groups) {
        if ((g.min && w < g.min) || (g.max && w >= g.max)) continue;
        const grp = el("div", { class: "tb-group" });
        for (const id of g.items) {
          const c = Cmd.get(id);
          if (!c) continue;
          const b = el("button", {
            class: "tb-btn" + (c.danger ? " danger" : ""),
            "data-cmd": id,
            title: c.label + (c.keyHint ? `  (${c.keyHint})` : ""),
            "aria-label": c.label,
          }, ico(c.icon) + (c.showLabel ? `<span class="lbl">${esc(c.label)}</span>` : ""));
          grp.appendChild(b);
          btnRefs.set(id, b);
        }
        host.appendChild(grp);
      }
    };
    mk($("#toolbar-groups"), LEFT_GROUPS);
    mk($("#toolbar-right"), RIGHT_GROUPS);

    if (!mqWired) {
      mqWired = true;
      let t = 0;
      window.addEventListener("resize", () => {
        clearTimeout(t);
        t = setTimeout(buildToolbar, 120) as unknown as number;
      }, { passive: true });
    }
    syncToolbar();
  }

  function syncToolbar() {
    btnRefs.forEach((b, id) => {
      const c = Cmd.get(id);
      if (!c) return;
      const on = c.isOn ? !!c.isOn() : false;
      b.classList.toggle("on", on);
      const dis = c.isEnabled ? !c.isEnabled() : false;
      if (dis) b.setAttribute("disabled", ""); else b.removeAttribute("disabled");
    });
  }

  /* ============================ bảng thuộc tính ========================== */

  // Các tham chiếu DOM trong inspector, gom theo tên. `Record` chứ không phải
  // một interface liệt kê 30 khoá: chúng được gán trong `buildInspector` theo
  // đúng thứ tự dựng DOM, và một danh sách viết tay ở đây sẽ là bản sao thứ
  // hai của cái danh sách đó.
  let R: Record<string, any> = {};

  /**
   * Two panes, one segmented control.
   *
   * The rules used to be an accordion wedged between *Phe* and *Ảnh nền*, in
   * the middle of a panel that scrolls — which is a fine place to put
   * something nobody needs to find. A whole subsystem cannot live below the
   * fold of a section about map metadata: a person here to draw walls has no
   * reason to scroll past the background picker, so for them the feature does
   * not exist.
   *
   * A tab is always visible, costs one row, and stays out of the way — `Vẽ` is
   * the default because drawing is still the job. The badge is what closes the
   * loop: a map that has rules says so on the tab, from the drawing pane,
   * without being opened.
   */
  const INSPECTOR_HTML = `
  <div class="seg center" id="inspector-tabs" style="grid-auto-flow:column;margin:0 0 10px">
    <button id="tab-draw" class="on">Vẽ</button>
    <button id="tab-rules">Luật chơi <span id="tab-rules-badge" class="mono"></span></button>
  </div>

  <div id="pane-rules" class="hidden">
    <div class="sec">
      <div class="sec-title">Luật chơi của map <span id="tuning-count" class="mono"></span></div>
      <div class="sec-body">
        <p class="muted" style="margin:0 0 8px">
          Chỉ số riêng của map này. Ô trống = dùng mặc định của core — số mờ trong
          ô chính là mặc định đó.
        </p>
        <div id="tuning-summary" class="muted" style="margin:0 0 10px"></div>
        <div id="tuning-groups"></div>
      </div>
    </div>
  </div>

  <div id="pane-draw">
  <div class="sec" id="s-obj">
    <div class="sec-title"><span id="obj-title">Đối tượng</span><span id="obj-sub" class="mono"></span></div>
    <div class="seg" id="obj-types" style="grid-template-columns:1fr 1fr"></div>
    <div class="grid2" style="margin-top:8px">
      <div class="field tagged"><span class="tag">X</span><input class="inp" id="obj-x" type="number" step="1"></div>
      <div class="field tagged"><span class="tag">Y</span><input class="inp" id="obj-y" type="number" step="1"></div>
    </div>
    <button class="btn block" id="obj-recenter" style="margin-top:6px">
      ${ico("target", "ico ico-sm")} <span>Căn tâm</span>
      <span class="mono" id="obj-center-off" style="color:var(--tx-3);font-size:11px"></span>
    </button>
    <div id="obj-props"></div>

    <div class="sec-title" data-sec="shape" style="margin-top:12px">Biến hình &amp; thứ tự</div>
    <div class="sec-body">
      <div id="obj-shape">
        <div class="row" id="obj-rot-row" style="margin-top:8px">
          <label>Xoay</label>
          <div class="field"><input class="inp" id="obj-rot" type="number" step="15" value="90"><span class="unit">°</span></div>
          <button class="btn" id="obj-rot-ccw" title="Xoay ngược chiều kim đồng hồ">↺</button>
          <button class="btn" id="obj-rot-cw" title="Xoay theo chiều kim đồng hồ">↻</button>
        </div>
        <div class="row" id="obj-flip-row">
          <label>Lật</label>
          <button class="btn" id="obj-flip-h" style="flex:1">${ico("flip-h", "ico ico-sm")} Ngang</button>
          <button class="btn" id="obj-flip-v" style="flex:1">${ico("flip-v", "ico ico-sm")} Dọc</button>
        </div>
        <div class="row" id="obj-scale-row">
          <label>Co giãn</label>
          <div class="field"><input class="inp" id="obj-scale" type="number" step="5" value="110"><span class="unit">%</span></div>
          <button class="btn" id="obj-scale-down" title="Thu nhỏ">−</button>
          <button class="btn" id="obj-scale-up" title="Phóng to">+</button>
        </div>
      </div>
      <div class="grid2" style="margin-top:8px">
        <button class="btn" id="obj-front">${ico("front", "ico ico-sm")} Lên trước</button>
        <button class="btn" id="obj-back">${ico("back", "ico ico-sm")} Ra sau</button>
      </div>
    </div>

    <div class="grid2" style="margin-top:8px">
      <button class="btn" id="obj-dup">${ico("copy", "ico ico-sm")} Nhân bản</button>
      <button class="btn danger" id="obj-del">${ico("trash", "ico ico-sm")} Xoá</button>
    </div>
    <p class="muted" id="obj-hint" style="margin:9px 0 0"></p>
  </div>

  <div class="sec">
    <div class="sec-title" data-sec="layers">Lớp hiển thị</div>
    <div class="sec-body"><div id="layer-toggles"></div></div>
  </div>

  <div class="sec">
    <div class="sec-title" data-sec="grid">Lưới &amp; hút điểm</div>
    <div class="sec-body">
      <button class="toggle" id="tg-grid"><span>Hiện lưới</span><span class="sw"></span></button>
      <button class="toggle" id="tg-snap"><span>Hút vào lưới</span><span class="sw"></span></button>
      <div class="row" style="margin-top:7px">
        <label>Bước lưới</label>
        <div class="field"><input class="inp" id="grid-size" type="number" min="1" step="10"><span class="unit">px</span></div>
      </div>
      <button class="toggle" id="tg-vidx"><span>Số thứ tự đỉnh</span><span class="sw"></span></button>
      <button class="toggle" id="tg-dummy"><span>Hiện tướng mẫu (60px)</span><span class="sw"></span></button>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title" data-sec="map">Map <span class="muted" style="text-transform:none;letter-spacing:0">moba2d</span></div>
    <div class="sec-body">
      <div class="row"><label>Tên</label><div class="field"><input class="inp" id="map-name" type="text" style="font-family:var(--font)"></div></div>
      <div class="row"><label>Map id</label><div class="field"><input class="inp" id="map-id" type="text" placeholder="proving-grounds"></div></div>
      <div class="row">
        <label>Kích thước</label>
        <div class="field tagged"><span class="tag">W</span><input class="inp" id="map-w" type="number" min="100" step="100"></div>
        <div class="field tagged"><span class="tag">H</span><input class="inp" id="map-h" type="number" min="100" step="100"></div>
      </div>
      <button class="btn block" id="map-resize" style="margin:0 0 7px">
        ${ico("scale", "ico ico-sm")} Đổi kích thước &amp; scale nội dung…
      </button>
      <p class="muted hidden" id="map-square-warn" style="margin:0 0 7px">
        MapSummary.size chỉ có một số — map moba2d là hình vuông.
        <a href="#" id="map-make-square" style="color:var(--accent)">Làm vuông</a>
      </p>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title" data-sec="factions">Phe <span id="faction-count" class="mono"></span></div>
    <div class="sec-body">
      <div id="faction-list"></div>
      <button class="btn block" id="faction-add" style="margin-top:6px">${ico("plus", "ico ico-sm")} Thêm phe</button>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title" data-sec="bg">Ảnh nền</div>
    <div class="sec-body">
      <button class="toggle" id="tg-bg"><span>Hiện ảnh nền</span><span class="sw"></span></button>
      <div class="row" style="margin-top:7px">
        <select class="inp" id="bg-select">
          <option value="">— không —</option>
          <option value="full-minimap.png">Minimap LMHT</option>
          <option value="full.jpg">Map thật</option>
          <option value="full-2d-hextech.png">Map 2D hextech</option>
          <option value="full-2d.png">Map 2D</option>
        </select>
      </div>
      <button class="btn block" id="bg-upload" style="margin-top:6px">${ico("image", "ico ico-sm")} Tải ảnh của bạn…</button>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title" data-sec="check">Kiểm tra</div>
    <div class="sec-body"><div id="check-box" class="muted">—</div></div>
  </div>
  </div>`;

  /** Các field thuộc tính của từng loại — bám đúng schema của moba2d. */
  const PROP_FIELDS = {
    spawn: [
      { key: "faction", label: "Phe", kind: "faction" },
      { key: "r", label: "Bán kính", kind: "number", unit: "px", min: 1 },
      { sec: "fountain-stats", group: "Ghi đè chỉ số cho bệ đá này", groupKey: "fountain" },
      { key: "stats.healPercent", label: "Hồi máu", kind: "number", unit: "×", min: 0, ph: "0.12" },
      { key: "stats.manaPercent", label: "Hồi mana", kind: "number", unit: "×", min: 0, ph: "0.12" },
      { key: "stats.tickInterval", label: "Nhịp hồi", kind: "number", unit: "ms", min: 0, ph: "500" },
      { key: "stats.shopRange", label: "Tầm mua đồ", kind: "number", unit: "px", min: 0, ph: "= bán kính bệ" },
    ],
    structure: [
      { key: "faction", label: "Phe", kind: "faction" },
      { key: "kind", label: "Kiểu", kind: "static", value: "turret" },
      { sec: "turret-stats", group: "Ghi đè chỉ số cho trụ này", groupKey: "turrets" },
      { key: "stats.health", label: "Máu", kind: "number", unit: "hp", min: 0, ph: "400" },
      { key: "stats.damage", label: "Sát thương", kind: "number", unit: "dmg", min: 0, ph: "12" },
      { key: "stats.attackRange", label: "Tầm bắn", kind: "number", unit: "px", min: 0, ph: "430" },
      { key: "stats.attackInterval", label: "Nhịp bắn", kind: "number", unit: "ms", min: 0, ph: "1300" },
      { key: "stats.rebuildTime", label: "Xây lại", kind: "number", unit: "ms", min: 0, ph: "30000" },
    ],
    minion: [
      { key: "faction", label: "Phe", kind: "faction" },
      { key: "lane", label: "Lane", kind: "lane" },
      { key: "scatter", label: "Tản ra", kind: "number", unit: "px", min: 0, hint: "để trống = không tản" },
      { sec: "minion-stats", group: "Ghi đè đội hình cho điểm này", groupKey: "minions" },
      {
        key: "stats.composition", label: "Đội hình", kind: "list",
        ph: "melee, melee, ranged",
        hint: "id các loại lính, cách nhau bằng dấu phẩy — để trống = theo đội hình chung của map",
      },
    ],
    neutral: [
      // `role` là từ vựng của pack, không phải của editor: core không bao giờ
      // diễn giải chuỗi này. Pack khớp nó theo hai đường — `fills` của một bãi
      // quái, hoặc `slotObjects` cho thứ không phải thân để đánh (pack lol có
      // `relic`, cục hồi máu). Nên đây là ô chữ tự do chứ không phải danh sách:
      // editor không thấy được pack nào đang cài.
      {
        key: "role", label: "Role", kind: "text", placeholder: "warden",
        hint: "tên do pack đặt — bãi quái (`fills`) hoặc vật thể (`slotObjects`, ví dụ `relic`)",
      },
      // Cái duy nhất trên điểm trung lập mà *map* nói chứ không phải pack, và
      // cũng là cách duy nhất để nói "chỗ này không bao giờ là bãi quái".
      // Editor không đọc được pack, nên nếu không có ô này thì mọi điểm đều
      // phải vẽ như bãi quái — kèm vòng tầm đuổi dựng từ mặc định của quái —
      // kể cả điểm đặt cục hồi máu.
      {
        key: "kind", label: "Loại điểm", kind: "choice",
        options: ["", "object"],
        hint: "để trống = bãi quái; object = vật thể pack đặt (`slotObjects`), ví dụ cục hồi máu",
      },
      { key: "r", label: "Bán kính", kind: "number", unit: "px", min: 1 },
      { key: "rotationDeg", label: "Xoay camp", kind: "number", unit: "°", hint: "xoay bố cục quái bên trong" },
      // Cả nhóm dưới đây chỉ tới được một *bãi quái*. Một role mà pack trả lời
      // bằng `slotObjects` không đọc `slot.stats` chút nào, nên điền vào đây
      // sẽ im lặng không có tác dụng gì — đúng kiểu hỏng mà `coreRange` trong
      // các pack vẫn ghi chú.
      { sec: "monster-stats", group: "Ghi đè chỉ số cho bãi quái này", groupKey: "monsters" },
      { key: "stats.healthMult", label: "Máu", kind: "number", unit: "×", min: 0, ph: "1" },
      { key: "stats.damageMult", label: "Sát thương", kind: "number", unit: "×", min: 0, ph: "1" },
      { key: "stats.aggroRange", label: "Tầm phát hiện", kind: "number", unit: "px", min: 0, hint: "số tuyệt đối, không phải hệ số" },
      { key: "stats.chaseMargin", label: "Tầm đuổi thêm", kind: "number", unit: "px", min: 0, ph: "350" },
      { key: "stats.reviveTime", label: "Hồi sinh", kind: "number", unit: "ms", min: 0 },
      {
        key: "stats.temperament", label: "Tính khí", kind: "choice",
        options: ["", "aggressive", "skittish"],
        hint: "để trống = theo pack khai",
      },
      {
        key: "stats.attackStyle", label: "Kiểu đánh", kind: "choice",
        options: ["", "melee", "ranged", "breath", "lash"],
        hint: "melee = vuốt, ranged = phun đạn, breath = phun lửa hình nón, lash = quật đuôi",
      },
      // Không có `groupKey`: hình dáng con vật không phải thứ chỉnh cho cả
      // map được, nên nhóm này không có nút "đổi cho tất cả". Nó ghi đè khai
      // báo của pack cho đúng bãi này thôi.
      // Xoá cả nhánh `stats.rig`, không phải từng ô: `rig.legs.spread`,
      // `rig.body.glow` và mọi thứ một pack hay một map viết tay để lại đều
      // không có ô nào trong inspector, nên xoá theo ô sẽ để chúng nằm lại và
      // con vật vẫn không về mặc định.
      { sec: "monster-rig", group: "Hình dáng con vật", clear: ["stats.rig"] },
      {
        key: "stats.rig.legs.count", label: "Số chân", kind: "number", min: 0,
        ph: "không mọc chân",
        hint: "chẵn, 2–12. Để trống = giữ nguyên hình pack khai.",
      },
      {
        key: "stats.rig.legs.reach", label: "Sải chân", kind: "number", unit: "×bk", min: 0, ph: "1.6",
        hint: "tính theo bán kính thân, nên một con to và một con nhỏ dùng chung được số này",
      },
      {
        key: "stats.rig.legs.bend", label: "Chiều gối", kind: "choice",
        options: ["", "up", "down"],
        hint: "up = gối vểnh ra ngoài như nhện, down = gối gập vào như thú",
      },
      { key: "stats.rig.legs.thickness", label: "Dày chân", kind: "number", unit: "px", min: 0, ph: "theo cỡ thân" },
      { key: "stats.rig.legs.color", label: "Màu chân", kind: "color", def: RIG_DEFAULTS.color },
      {
        key: "stats.rig.body.kind", label: "Thân", kind: "choice",
        options: ["", "orb", "chain"],
        hint: "để trống = ảnh của quái; orb = một khối tròn; chain = thân nhiều đốt (sâu, rắn, rết)",
      },
      { key: "stats.rig.body.color", label: "Màu thân", kind: "color", def: RIG_DEFAULTS.bodyColor },
      { kind: "spineEditor" },
      { key: "stats.rig.body.spacing", label: "Cách đốt", kind: "number", unit: "×bk", min: 0, ph: "0.9" },
      {
        key: "stats.rig.body.bend", label: "Độ mềm", kind: "number", unit: "rad", min: 0, ph: "0.45",
        hint: "mỗi đốt bẻ được tối đa bấy nhiêu so với đốt trước — nhỏ thì cứng như rết, lớn thì mềm như rắn",
      },
      {
        key: "stats.rig.legs.on", label: "Chân ở đốt", kind: "numlist", ph: "tự rải đều",
        hint: "số thứ tự đốt cho từng cặp chân, cách nhau bằng dấu phẩy — đốt đầu là 0",
      },
      { kind: "rigPreview" },
    ],
    // Lane KHÔNG có ô "từ phe / tới phe": engine không đọc hai field đó
    // (setActiveLanes chỉ lấy id + waypoints), và giá trị của chúng bị ràng
    // buộc hoàn toàn bởi quy ước "waypoint 0 nằm ở base của phe thứ nhất".
    // Cho gõ tay chỉ tạo thêm đường để dữ liệu tự mâu thuẫn với hình vẽ.
    lane: [
      { key: "id", label: "Lane id", kind: "text", placeholder: "mid" },
    ],
  };

  function buildInspector() {
    const body = $("#inspector-body");
    body.innerHTML = INSPECTOR_HTML;
    const g = (id) => body.querySelector("#" + id);

    R = {
      sObj: g("s-obj"), objTitle: g("obj-title"), objSub: g("obj-sub"),
      objTypes: g("obj-types"), objX: g("obj-x"), objY: g("obj-y"),
      objProps: g("obj-props"), objShape: g("obj-shape"),
      recenter: g("obj-recenter"), centerOff: g("obj-center-off"),
      objRotRow: g("obj-rot-row"), objScaleRow: g("obj-scale-row"),
      objFlipRow: g("obj-flip-row"),
      objRot: g("obj-rot"), objScale: g("obj-scale"), objHint: g("obj-hint"),
      layers: g("layer-toggles"),
      tgGrid: g("tg-grid"), tgSnap: g("tg-snap"), tgVidx: g("tg-vidx"),
      tgDummy: g("tg-dummy"), tgBg: g("tg-bg"),
      gridSize: g("grid-size"), mapName: g("map-name"), mapId: g("map-id"),
      mapW: g("map-w"), mapH: g("map-h"), bgSelect: g("bg-select"),
      squareWarn: g("map-square-warn"), factions: g("faction-list"),
      factionCount: g("faction-count"), check: g("check-box"),
      tuning: g("tuning-groups"), tuningCount: g("tuning-count"),
      tuningSummary: g("tuning-summary"), tabsBadge: g("tab-rules-badge"),
      paneDraw: g("pane-draw"), paneRules: g("pane-rules"),
      tabDraw: g("tab-draw"), tabRules: g("tab-rules"),
    };

    // các lớp bật/tắt, chia theo nhóm của MapGeometry
    const groups = [
      ["Địa hình", TERRAIN_KINDS],
      ["Slot", SLOT_KINDS],
      ["Lane", ["lane"]],
    ];
    for (const [title, kinds] of groups) {
      R.layers.appendChild(el("div", {
        class: "sec-title",
        style: "margin:8px 0 4px;font-size:9.5px",
        text: title,
      }));
      for (const k of kinds) {
        R.layers.appendChild(el("button", {
          class: "toggle", "data-layer": k,
          onclick: () => {
            E.visible[k] = !E.visible[k];
            if (!E.visible[k]) Sel.set(E.selection.filter((t) => E.visible[t.type]));
            syncLayers();
            requestRender();
          },
        }, `<span class="tdot ${k}"></span><span>${esc(KIND[k].label)}</span><span class="count" data-count></span><span class="sw"></span>`));
      }
    }

    const numCommit = (input, apply) => {
      const run = () => { const v = Number(input.value); if (Number.isFinite(v)) apply(v); };
      input.addEventListener("change", run);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { run(); input.blur(); } });
    };

    numCommit(R.objX, (v) => Cmd.run("shape.setPos", [v, null]));
    numCommit(R.objY, (v) => Cmd.run("shape.setPos", [null, v]));
    g("obj-rot-cw").onclick = () => Cmd.run("shape.rotate", Number(R.objRot.value) || 90);
    g("obj-rot-ccw").onclick = () => Cmd.run("shape.rotate", -(Number(R.objRot.value) || 90));
    g("obj-scale-up").onclick = () => Cmd.run("shape.scale", (Number(R.objScale.value) || 110) / 100);
    g("obj-scale-down").onclick = () => Cmd.run("shape.scale", 100 / (Number(R.objScale.value) || 110));
    R.recenter.onclick = () => Cmd.run("shape.recenter");
    g("obj-flip-h").onclick = () => Cmd.run("shape.flipH");
    g("obj-flip-v").onclick = () => Cmd.run("shape.flipV");
    g("obj-front").onclick = () => Cmd.run("shape.front");
    g("obj-back").onclick = () => Cmd.run("shape.back");
    g("obj-dup").onclick = () => Cmd.run("shape.duplicate");
    g("obj-del").onclick = () => Cmd.run("shape.delete");

    R.tgGrid.onclick = () => Cmd.run("view.grid");
    R.tgSnap.onclick = () => Cmd.run("view.snap");
    R.tgVidx.onclick = () => { E.showVertexIndex = !E.showVertexIndex; Store.savePrefs(); syncView(); requestRender(); };
    R.tgDummy.onclick = () => Cmd.run("view.dummy");
    R.tgBg.onclick = () => Cmd.run("view.bg");

    numCommit(R.gridSize, (v) => {
      E.gridSize = Geom.clamp(Math.round(v), 1, 5000);
      R.gridSize.value = E.gridSize;
      Store.savePrefs();
      requestRender();
    });

    R.mapName.addEventListener("change", () => {
      const v = R.mapName.value.trim();
      if (v && E.mapId) { Store.renameMap(E.mapId, v); toast("Đã đổi tên map"); }
      else R.mapName.value = E.mapName;
    });

    R.mapId.addEventListener("change", () => {
      const v = Store.slugify(R.mapId.value);
      E.meta.id = v;
      R.mapId.value = v;
      commit();
    });

    /**
     * Gõ thẳng vào ô W/H: ô làm đúng việc của nó (đổi khung), rồi hỏi thêm
     * có kéo nội dung theo không — đây đúng là lúc người dùng đang nghĩ tới
     * chuyện đó. Map trống thì khỏi hỏi.
     */
    const applySize = async () => {
      const w = Geom.clamp(Math.round(Number(R.mapW.value) || 0), 100, 200000);
      const h = Geom.clamp(Math.round(Number(R.mapH.value) || 0), 100, 200000);
      const [ow, oh] = E.mapSize;
      R.mapW.value = w; R.mapH.value = h;
      if (w === ow && h === oh) return;

      if (!E.terrains.length) { Cmd.resizeMap(w, h, false); return; }

      const kx = w / ow, ky = h / oh;
      const same = Math.abs(kx - ky) < 1e-6;
      const ok = await confirmBox({
        title: "Kéo nội dung theo khung mới?",
        confirmText: "Scale nội dung",
        cancelText: "Chỉ đổi khung",
        text: `Khung ${ow}×${oh} → ${w}×${h}` +
          (same ? ` (×${(+kx.toFixed(4))})` : ` (×${+kx.toFixed(4)} ngang, ×${+ky.toFixed(4)} dọc)`) +
          `. ${E.terrains.length} đối tượng đang vẽ theo khung cũ.`,
      });
      Cmd.resizeMap(w, h, ok === true);
    };
    R.mapW.addEventListener("change", applySize);
    R.mapH.addEventListener("change", applySize);
    g("map-make-square").onclick = (e) => {
      e.preventDefault();
      const n = Math.max(E.mapSize[0], E.mapSize[1]);
      Cmd.resizeMap(n, n, false);
    };
    g("map-resize").onclick = () => Cmd.run("map.resize");
    g("faction-add").onclick = () => Cmd.run("map.addFaction");
    R.tabDraw.onclick = () => showTab("draw");
    R.tabRules.onclick = () => showTab("rules");

    R.bgSelect.addEventListener("change", () => {
      const v = R.bgSelect.value;
      Store.applyBackground(v ? { kind: "asset", value: v } : null, true)
        .then(() => { Store.scheduleSave(0); syncView(); });
    });
    g("bg-upload").onclick = () => Cmd.run("view.bgUpload");

    // Sau cùng, khi mọi id đã được nhặt: gập panel lại thành các mục.
    wireSections(body);

    syncAll();
  }

  /* ------------------------ thuộc tính theo loại ----------------------- */

  let propsKey = "";

  /* ---------------------- sửa cột sống ------------------------- */

  /** Pixel cho mỗi "bán kính thân" — mọi số trong rig đều là tỉ lệ theo nó. */
  const SPINE_SCALE = 22;
  /** Bắt được tay nắm trong khoảng này (px logic). */
  const SPINE_GRAB = 11;
  /** Cột sống mặc định khi bật thân đốt lần đầu: một con thằn lằn. */
  const DEFAULT_WIDTHS = [0.9, 1, 0.9, 0.75, 0.6, 0.45, 0.3];
  const MAX_VERTEBRAE = 24;

  const SpineEd = { box: null, canvas: null, draft: null, drag: -1 };

  const propsOf = () => (Sel.one || E.selection[0] || {}).props || {};

  /**
   * Bề rộng từng đốt đang hiệu lực: bản nháp nếu đang kéo, rồi tới thứ slot đã
   * khai, rồi tới bộ mặc định.
   */
  function spineWidths() {
    if (SpineEd.draft) return SpineEd.draft;
    const own = readDeep(propsOf(), "stats.rig.body.widths");
    return Array.isArray(own) && own.length ? own.map(Number) : DEFAULT_WIDTHS.slice();
  }

  /**
   * Ghi khi **thả tay**, không phải mỗi lần chuột nhúc nhích.
   *
   * `Cmd.run("shape.prop")` đẩy một bước vào lịch sử undo; ghi theo từng frame
   * kéo thì một lần chỉnh đốt tốn ba chục lần Ctrl+Z mới lùi hết. Trong lúc kéo
   * thì bản nháp lo phần nhìn — cả ô này lẫn ô xem trước đều đọc nó.
   */
  function commitSpine(widths) {
    SpineEd.draft = null;
    Cmd.run("shape.prop", [
      "stats.rig.body.widths",
      widths.map((w) => Math.round(w * 100) / 100),
    ]);
  }

  /** Cột sống duỗi thẳng, đầu bên phải — dùng đúng hình học của bản game. */
  function spineLayout() {
    const widths = spineWidths();
    const spacing = Number(readDeep(propsOf(), "stats.rig.body.spacing")) || 0.9;
    const spine = new Spine({
      widths: widths.map((w) => Math.max(0, w) * SPINE_SCALE),
      spacing: spacing * SPINE_SCALE,
      bend: 0.45,
    });
    const canvas = SpineEd.canvas;
    const height = canvas ? canvas.height / 2 : 110;
    const width = canvas ? canvas.width / 2 : 240;
    spine.replant(width - 26, height / 2);
    return { spine, widths };
  }

  function paintSpineEditor() {
    const canvas = SpineEd.canvas;
    if (!canvas || !canvas.isConnected) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const w = canvas.width / 2;
    const h = canvas.height / 2;
    ctx.clearRect(0, 0, w, h);

    const { spine, widths } = spineLayout();
    const colour = readDeep(propsOf(), "stats.rig.body.color");
    const body = { color: Array.isArray(colour) ? colour : [150, 110, 255], glow: 0 };

    // Trục thân, để thấy tay nắm đang cách tâm bao xa.
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, h / 2);
    ctx.lineTo(w - 6, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    paintOutline(ctx, spine, body);

    for (let i = 0; i < widths.length; i++) {
      const grip = spine.edge(i, -Math.PI / 2);
      ctx.beginPath();
      ctx.arc(grip.x, grip.y, SpineEd.drag === i ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = SpineEd.drag === i ? "#ffd479" : "#e6e6e6";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Toạ độ logic trong canvas, đã bù cho việc vẽ ở gấp đôi độ phân giải. */
  function spinePoint(e) {
    const canvas = SpineEd.canvas;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * (canvas.width / 2),
      y: ((e.clientY - rect.top) / rect.height) * (canvas.height / 2),
    };
  }

  function buildSpineEditor() {
    const box = el("div", { style: "margin-top:9px" });
    box.appendChild(el("p", { class: "muted", style: "margin:0 0 4px" },
      "Kéo tay nắm để đổi bề ngang từng đốt. Đầu ở bên phải."));

    const canvas = el("canvas", {
      width: 480, height: 220,
      style: "width:100%;height:auto;border-radius:8px;background:#0e1218;display:block;touch-action:none",
    });
    box.appendChild(canvas);

    const row = el("div", { class: "grid2", style: "margin-top:6px" });
    row.appendChild(el("button", { class: "btn", onclick: () => {
      const widths = spineWidths();
      if (widths.length <= 2) return toast("Cần ít nhất 2 đốt", "warn");
      commitSpine(widths.slice(0, -1));
    } }, "− Bớt đốt"));
    row.appendChild(el("button", { class: "btn", onclick: () => {
      const widths = spineWidths();
      if (widths.length >= MAX_VERTEBRAE) return toast(`Tối đa ${MAX_VERTEBRAE} đốt`, "warn");
      commitSpine([...widths, Math.max(0.05, widths[widths.length - 1] * 0.8)]);
    } }, "+ Thêm đốt"));
    box.appendChild(row);

    // Chỉ trả riêng cột sống về mặc định.
    //
    // Nút × của cả mục thì xoá `stats.rig` — mất luôn chân và màu đã chỉnh —
    // nên "kéo hỏng hình rồi, làm lại từ đầu" mà phải hi sinh mọi thứ khác là
    // một lựa chọn không ai muốn phải cân nhắc.
    const reset = el("button", {
      class: "btn block", style: "margin-top:6px",
      title: "Bỏ hình cột sống đã vẽ, quay về bộ đốt mặc định",
      onclick: () => { SpineEd.draft = null; Cmd.run("shape.prop", ["stats.rig.body.widths", ""]); },
    }, `${ico("undo", "ico ico-sm")} Cột sống về mặc định`);
    reset.dataset.spineReset = "";
    box.appendChild(reset);

    SpineEd.box = box;
    SpineEd.canvas = canvas;
    SpineEd.draft = null;
    SpineEd.drag = -1;

    canvas.addEventListener("pointerdown", (e) => {
      const { spine, widths } = spineLayout();
      const at = spinePoint(e);
      let best = -1;
      let near = SPINE_GRAB;
      for (let i = 0; i < widths.length; i++) {
        const grip = spine.edge(i, -Math.PI / 2);
        const away = Math.hypot(grip.x - at.x, grip.y - at.y);
        if (away < near) { near = away; best = i; }
      }
      if (best < 0) return;
      SpineEd.drag = best;
      SpineEd.draft = widths.slice();
      canvas.setPointerCapture(e.pointerId);
      paintSpineEditor();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (SpineEd.drag < 0 || !SpineEd.draft) return;
      const at = spinePoint(e);
      const centre = canvas.height / 4;
      // Kéo lên là dày ra. Chặn dưới ở 0 chứ không âm: 0 là cái đuôi nhọn hoắt,
      // số âm thì đường bao lộn từ trong ra ngoài.
      SpineEd.draft[SpineEd.drag] = Math.min(2.5, Math.max(0, (centre - at.y) / SPINE_SCALE));
      paintSpineEditor();
    });

    const release = () => {
      if (SpineEd.drag < 0) return;
      SpineEd.drag = -1;
      if (SpineEd.draft) commitSpine(SpineEd.draft);
      paintSpineEditor();
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    paintSpineEditor();
    return box;
  }

  /* --------------------- xem trước con vật --------------------- */

  const hexToRgb = (hex) => {
    const n = parseInt(String(hex).replace("#", ""), 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : "";
  };

  const rgbToHex = (rgb) =>
    "#" + rgb
      .map((c) => Math.max(0, Math.min(255, Math.round(Number(c) || 0))).toString(16).padStart(2, "0"))
      .join("");

  /**
   * Bán kính thân dùng để xem trước.
   *
   * Một con số cố định, không phải `size` thật của bãi quái: mọi thứ trong rig
   * đều là **tỉ lệ theo bán kính thân**, nên xem ở cỡ nào cũng ra đúng hình —
   * và một con quái to bằng nửa ô xem trước thì chẳng thấy chân đâu.
   */
  const PREVIEW_RADIUS = 13;
  const PREVIEW_ORBIT = 34;
  /** Radian mỗi frame 16ms. Đủ nhanh để thấy chân bước, đủ chậm để nhìn kịp. */
  const PREVIEW_TURN = 0.05;

  const Preview = { canvas: null, raf: 0, last: 0, key: "", rig: null, creature: null, angle: 0 };

  /**
   * `render.ts` cố ý **không** có vòng lặp 60fps — "máy đứng yên = 0% CPU" là
   * nguyên tắc của cả file đó, và một cái editor làm nóng điện thoại khi không
   * ai chạm vào là thứ nó tồn tại để tránh.
   *
   * Nên ô xem trước chạy rAF **của riêng nó**, bắt đầu khi dựng ra và dừng hẳn
   * ngay khi bảng thuộc tính bị dựng lại hoặc canvas rời khỏi DOM. Canvas map
   * chính không hề biết chuyện này xảy ra.
   */
  function stopRigPreview() {
    if (Preview.raf) cancelAnimationFrame(Preview.raf);
    Preview.raf = 0;
    Preview.canvas = null;
    Preview.creature = null;
    Preview.key = "";
  }

  function startRigPreview(canvas) {
    Preview.canvas = canvas;
    Preview.last = 0;
    Preview.angle = 0;
    Preview.key = "";
    if (Preview.raf) cancelAnimationFrame(Preview.raf);
    Preview.raf = requestAnimationFrame(stepRigPreview);
  }

  /** Mở lại một mục đã gập: nếu trong đó có ô xem trước thì cho nó chạy lại. */
  function resumeRigPreview(body) {
    const canvas = body.querySelector("[data-rig-preview]");
    if (canvas) startRigPreview(canvas);
  }

  function buildRigPreview(collapsed) {
    const box = el("div", { style: "margin-top:9px" });
    box.appendChild(el("p", { class: "muted", style: "margin:0 0 4px" },
      "Đi thử theo đúng số đang gõ ở trên."));
    // Nền đúng bằng nền map trong trận (`Game.draw` -> `background(30)`), chứ
    // không phải màu của bảng bên cạnh: cả điểm của ô này là thấy trước con vật
    // sẽ trông thế nào ở chỗ nó thật sự đứng. Một nền khác màu đã từng cho một
    // bộ chân "nhìn rõ" ở đây mà tàng hình trong trận.
    const floor = `rgb(${MAP_BACKGROUND_GREY},${MAP_BACKGROUND_GREY},${MAP_BACKGROUND_GREY})`;
    const canvas = el("canvas", {
      width: 480, height: 240,
      style: `width:100%;height:auto;border-radius:8px;background:${floor};display:block`,
    });
    canvas.setAttribute("data-rig-preview", "");
    box.appendChild(canvas);
    // Mục đang gập thì không chạy vòng lặp nào cả — cùng lý do `render.ts`
    // không có vòng lặp 60fps: thứ không ai nhìn thì không được đốt CPU.
    if (!collapsed) startRigPreview(canvas);
    return box;
  }

  /**
   * Rig đang được mô tả trong inspector, có tính cả cột sống đang kéo dở.
   *
   * Trong lúc kéo tay nắm thì đọc bản nháp của spine editor chứ không đọc props
   * — props chỉ được ghi khi thả tay, và một ô xem trước chỉ nhúc nhích sau khi
   * thả thì không giúp gì cho việc chỉnh hình.
   */
  function previewSpec() {
    const spec = readDeep((Sel.one || E.selection[0] || {}).props || {}, "stats.rig");
    if (!SpineEd.draft) return spec;
    const body = { ...(spec && spec.body), kind: "chain", widths: SpineEd.draft };
    return { ...spec, body };
  }

  /** Dựng lại rig chỉ khi số thực sự đổi, không phải mỗi frame. */
  function syncPreviewRig() {
    const spec = previewSpec();
    const resolved = spec ? resolveRig(spec, PREVIEW_RADIUS) : undefined;
    const key = JSON.stringify(resolved || null);
    if (key === Preview.key) return;
    Preview.key = key;
    Preview.rig = resolved || null;
    Preview.creature = resolved ? new Creature(resolved) : null;
  }

  function stepRigPreview(now) {
    const canvas = Preview.canvas;
    if (!canvas || !canvas.isConnected) return stopRigPreview();

    const dt = Preview.last ? Math.min(64, now - Preview.last) : 16;
    Preview.last = now;
    syncPreviewRig();
    Preview.angle += (dt / 16) * PREVIEW_TURN;

    const ctx = canvas.getContext("2d");
    // Không có ngữ cảnh 2D thì dừng hẳn, đừng ném lỗi mỗi frame: `getContext`
    // trả null trong jsdom và trong vài chế độ tiết kiệm của trình duyệt, mà
    // một ngoại lệ trong callback rAF thì không ai bắt.
    if (!ctx) return stopRigPreview();
    // Vẽ ở nửa độ phân giải khung nền, tức là ảnh nét gấp đôi trên màn hình
    // retina mà toạ độ vẫn là số người đọc được.
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const w = canvas.width / 2;
    const h = canvas.height / 2;
    ctx.clearRect(0, 0, w, h);

    const bx = w / 2 + Math.cos(Preview.angle) * PREVIEW_ORBIT;
    const by = h / 2 + Math.sin(Preview.angle) * PREVIEW_ORBIT * 0.6;

    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, PREVIEW_ORBIT, PREVIEW_ORBIT * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();

    const creature = Preview.creature;
    if (creature) creature.follow(bx, by, dt);
    // Chân trước, thân sau: chân phải chui ra từ *dưới* thân, không dán lên
    // trên. Cùng thứ tự với `Monster.drawRig`.
    if (creature && creature.legRig && Preview.rig.legs) {
      paintPreviewLegs(ctx, creature.legRig, Preview.rig.legs);
    }
    if (creature && creature.spine) paintOutline(ctx, creature.spine, Preview.rig.body);
    // Thân đốt là thứ vẽ *thêm* — ảnh quái vẫn nằm trên đầu nó trong trận, nên
    // ô xem trước vẫn vẽ chỗ của ảnh.
    paintPreviewBody(ctx, bx, by);

    Preview.raf = requestAnimationFrame(stepRigPreview);
  }

  /**
   * Cùng hình học với `drawCreature.ts` trong game, khác đúng mỗi lệnh vẽ —
   * bên kia là p5, bên này là Canvas2D. Chỗ khó (IK, nhịp bước) chỉ có một bản,
   * nằm ở `legRig.ts`.
   */
  function paintPreviewLegs(ctx, rig, style) {
    const rgb = `rgb(${style.color[0]},${style.color[1]},${style.color[2]})`;
    ctx.strokeStyle = rgb;
    ctx.fillStyle = rgb;
    ctx.lineCap = "round";
    for (const leg of rig.legs) {
      const hip = rig.hipOf(leg);
      const knee = rig.kneeOf(leg);
      ctx.lineWidth = style.thickness;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.stroke();
      ctx.lineWidth = style.thickness * 0.72;
      ctx.beginPath();
      ctx.moveTo(knee.x, knee.y);
      ctx.lineTo(leg.footX, leg.footY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(leg.footX, leg.footY, style.thickness * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Đường bao thân đốt, vẽ bằng Canvas2D.
   *
   * Cùng bộ điểm mà bản game vẽ bằng `curveVertex` của p5 — `spine.outline()`
   * trả điểm, mỗi bên tự nối theo cách của mình. Canvas2D không có Catmull-Rom
   * nên nối bằng đường bậc hai qua trung điểm: cùng một hình mềm, không phải
   * cùng một API.
   */
  function paintOutline(ctx, spine, body) {
    const ring = spine.outline();
    if (ring.length < 3) return;
    const rgb = (a) => `rgba(${body.color[0]},${body.color[1]},${body.color[2]},${a})`;

    ctx.beginPath();
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    let from = mid(ring[ring.length - 1], ring[0]);
    ctx.moveTo(from.x, from.y);
    for (let i = 0; i < ring.length; i++) {
      const next = mid(ring[i], ring[(i + 1) % ring.length]);
      ctx.quadraticCurveTo(ring[i].x, ring[i].y, next.x, next.y);
    }
    ctx.closePath();
    ctx.fillStyle = rgb(1);
    ctx.fill();
    ctx.strokeStyle = `rgb(${Math.round(body.color[0] * 0.45)},${Math.round(body.color[1] * 0.45)},${Math.round(body.color[2] * 0.45)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function paintPreviewBody(ctx, x, y) {
    const body = Preview.rig && Preview.rig.body;
    // Chỉ `orb` mới thay chỗ của ảnh quái. Thân đốt vẽ thêm ở dưới, ảnh vẫn
    // nằm trên đầu nó — nên ở đây vẫn phải vẽ chỗ của ảnh.
    if (body && body !== "avatar" && body.kind === "orb") {
      const rgb = `rgb(${body.color[0]},${body.color[1]},${body.color[2]})`;
      if (body.glow > 0) {
        ctx.fillStyle = `rgba(${body.color[0]},${body.color[1]},${body.color[2]},${0.22 * body.glow})`;
        ctx.beginPath();
        ctx.arc(x, y, PREVIEW_RADIUS * (1 + body.glow * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgb;
      ctx.beginPath();
      ctx.arc(x, y, PREVIEW_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Chỗ của ảnh quái, vẽ bằng nét đứt: editor không nạp asset của pack, và
    // một cái đĩa xám đặc sẽ đọc thành "thân màu xám" chứ không phải "chỗ này
    // là ảnh".
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, PREVIEW_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Mục nào đang gập, giữ theo tên.
   *
   * Ở ngoài `buildProps` vì bảng thuộc tính bị dựng lại mỗi lần đổi loại đối
   * tượng đang chọn — trạng thái để bên trong thì cứ chọn sang thứ khác rồi
   * quay lại là mọi mục bung ra hết.
   */
  /**
   * Mục nào đang mở, sống trong `E.openSections` nên nó đi qua `savePrefs` và
   * còn nguyên sau khi tải lại trang — cùng đường với lưới, hút điểm và bảng
   * thuộc tính đóng/mở.
   *
   * **Mặc định là gập hết.** Panel này dài vì phần lớn nội dung của nó là thứ
   * đặt một lần rồi quên; ai cần cái gì thì mở cái đó, và lần sau vào vẫn thấy
   * đúng như mình để lại.
   */
  const isOpen = (name) => E.openSections.includes(name);

  function setSectionOpen(name, open) {
    const rest = E.openSections.filter((n) => n !== name);
    E.openSections = open ? [...rest, name] : rest;
    Store.savePrefs();
  }

  /**
   * Biến mọi cặp `.sec-title[data-sec]` + `.sec-body` thành một mục gập được.
   *
   * Chạy một lần trên panel dựng sẵn, không đụng vào node nào — chỉ thêm mũi
   * tên, gắn sự kiện và ẩn phần thân. `buildInspector` giữ tham chiếu tới hàng
   * chục id bên trong các phần thân đó, nên chuyển hay nhân bản node là hỏng;
   * ở nguyên chỗ cũ thì mọi tham chiếu vẫn đúng.
   *
   * Cặp title/body là markup tường minh chứ không phải đoán theo "tới tiêu đề
   * kế tiếp": trong khối Đối tượng, hai nút Nhân bản/Xoá nằm *sau* mục Biến
   * hình mà phải luôn hiện, và không luật đoán nào nói được điều đó.
   */
  function wireSections(root) {
    root.querySelectorAll("[data-sec]").forEach((title) => {
      const name = title.dataset.sec;
      const body = title.nextElementSibling;
      if (!body || !body.classList.contains("sec-body")) return;

      const collapsed = !isOpen(name);

      title.style.cursor = "pointer";
      title.style.display = "flex";
      title.style.alignItems = "center";
      title.style.gap = "6px";
      // `.sec-title` mang sẵn `justify-content: space-between`, hợp lý khi tiêu
      // đề chỉ có [chữ][đếm]. Thêm mũi tên vào là thành [mũi tên][chữ][đếm] —
      // và space-between đẩy chữ ra *giữa*, lệch hẳn so với mọi field bên dưới.
      // Căn trái, rồi đẩy riêng cái đuôi (số phe, chữ "moba2d") sang phải bằng
      // margin tự động, nên vẫn thẳng mép như cũ.
      title.style.justifyContent = "flex-start";
      const tail = title.lastElementChild;
      if (tail) tail.style.marginLeft = "auto";
      title.insertAdjacentHTML("afterbegin", ico("chevron-down", "ico ico-sm sec-caret"));
      title.querySelector("svg").style.transform = collapsed ? "rotate(-90deg)" : "";
      body.style.display = collapsed ? "none" : "";
      title.addEventListener("click", () => toggleSection(name, title, body));
    });
  }

  /** Gập/mở kéo dài bao lâu. Đủ để mắt bám được mục nào vừa mở, chưa đủ để chờ. */
  const SECTION_ANIM_MS = 170;

  /**
   * Gập/mở một phần thân có chuyển động: cao 0 ↔ cao thật, rồi trả về `auto`.
   *
   * Chiều cao phải do JS đo rồi ghi ra: `height: auto` không nội suy được, còn
   * cách thuần CSS (`grid-template-rows: 0fr` → `1fr`) đòi bọc thân vào một node
   * mới — mà `buildInspector` giữ tham chiếu tới hàng chục id nằm *bên trong*
   * các thân này, nên càng ít đụng vào cây DOM càng an toàn.
   *
   * Đo **sau khi** đã đặt `overflow:hidden`: thân không có padding lẫn viền, nên
   * bình thường margin của con trên/dưới cùng chảy xuyên ra ngoài và số đo hụt
   * đúng bằng chỗ margin đó. `overflow:hidden` mở một BFC, margin nằm gọn bên
   * trong, và số đo khớp với thứ thật sự hiện ra trong lúc chạy.
   *
   * Trả `height` về rỗng khi xong, không giữ số px: nội dung của thân đổi chiều
   * cao liên tục — thêm một chân vào cột sống, một dòng lỗi mới trong Kiểm tra —
   * và một chiều cao cố định sẽ cắt mất phần thừa ra mà không ai thấy.
   */
  function animateSection(body, open) {
    // Bấm nhanh hai lần: lần sau bắt đầu từ chiều cao *đang* có, không phải từ 0
    // hay từ chiều cao cuối, nên phải gỡ lần chạy trước rồi mới đo.
    if (body._secCancel) body._secCancel();

    const start = body.style.display === "none" ? 0 : body.getBoundingClientRect().height;
    body.style.display = "";
    body.style.transition = "";
    body.style.overflow = "hidden";
    body.style.height = "";
    const end = open ? body.scrollHeight : 0;

    body.style.height = `${start}px`;
    // Đọc lại layout để trình duyệt chốt mốc đầu; không có dòng này thì hai lần
    // ghi `height` gộp làm một và không có gì để nội suy.
    void body.offsetHeight;
    body.style.transition = `height ${SECTION_ANIM_MS}ms ease`;
    body.style.height = `${end}px`;

    const finish = () => {
      body._secCancel();
      body.style.height = "";
      body.style.overflow = "";
      if (!open) body.style.display = "none";
    };
    // `transitionend` nổi bọt lên từ con — trong thân có `.check-row` mang
    // transition riêng — nên lọc đúng thân này và đúng thuộc tính height.
    const onEnd = (e) => {
      if (e.target === body && e.propertyName === "height") finish();
    };
    // Lưới an toàn: tab ẩn, `prefers-reduced-motion`, hay một transition bị cắt
    // ngang đều có thể không bao giờ bắn `transitionend` — và khi đó thân kẹt ở
    // `overflow:hidden` cộng một chiều cao chết.
    const timer = setTimeout(finish, SECTION_ANIM_MS + 80);
    body._secCancel = () => {
      clearTimeout(timer);
      body.removeEventListener("transitionend", onEnd);
      body.style.transition = "";
      body._secCancel = null;
    };
    body.addEventListener("transitionend", onEnd);
  }

  function toggleSection(name, head, body) {
    const collapsed = isOpen(name);
    setSectionOpen(name, !collapsed);
    animateSection(body, !collapsed);
    head.querySelector("svg").style.transform = collapsed ? "rotate(-90deg)" : "";
    if (collapsed) {
      if (Preview.canvas && body.contains(Preview.canvas)) stopRigPreview();
    } else {
      resumeRigPreview(body);
    }
  }

  /**
   * Một mục gập được: cái đầu bấm được, phần thân chứa mọi field tới mục sau.
   *
   * Panel này từng đổ thẳng mọi field ra một cột — toạ độ, rồi năm ô ghi đè chỉ
   * số, rồi bảy ô hình dáng cộng ô xem trước. Trên điện thoại nằm ngang thì
   * phần trên cùng, thứ người ta dùng nhiều nhất, bị đẩy khuất.
   */
  function openSection(f) {
    // Khoá bền, không phải dòng chữ hiển thị: đổi nhãn một mục thì không được
    // làm mất trạng thái đã lưu của nó.
    const name = f.sec;
    const collapsed = !isOpen(name);

    // Một `div`, không phải `button`: nút Xoá nhóm nằm *bên trong* cái đầu này,
    // và button lồng trong button là HTML không hợp lệ.
    const head = el("div", {
      style: "display:flex;align-items:center;gap:6px;margin:12px 0 2px;cursor:pointer",
    });
    head.innerHTML =
      ico("chevron-down", "ico ico-sm sec-caret") +
      `<span class="sec-title" style="margin:0">${esc(f.group)}</span>` +
      `<span class="muted" data-section-count style="margin-left:auto;font-size:10.5px"></span>`;
    head.querySelector("svg").style.transform = collapsed ? "rotate(-90deg)" : "";

    /**
     * Xoá cả nhóm về mặc định.
     *
     * Nằm trên đầu mục chứ không dưới đáy thân, nên nó vẫn bấm được khi mục
     * đang gập — chỗ duy nhất nhìn thấy "3 đang đặt" cũng chính là chỗ nên có
     * cách bỏ ba cái đó đi. `stopPropagation` để bấm nó không gập mục lại.
     */
    const clear = el("button", {
      class: "btn", title: "Xoá hết ghi đè trong mục này, về mặc định",
      style: "padding:1px 5px",
      onclick: (e) => {
        e.stopPropagation();
        const keys = JSON.parse(clear.dataset.clearKeys || "[]");
        Cmd.run("shape.propClear", [keys]);
      },
    }, ico("x", "ico ico-sm"));
    clear.dataset.sectionClear = "";
    if (f.clear) clear.dataset.clearKeys = JSON.stringify(f.clear);
    head.appendChild(clear);

    const body = el("div", { style: collapsed ? "display:none" : "" });
    head.addEventListener("click", () => toggleSection(name, head, body));

    R.objProps.appendChild(head);
    R.objProps.appendChild(body);
    return { head, body };
  }

  function buildProps(kind) {
    stopRigPreview();
    SpineEd.box = null;
    SpineEd.canvas = null;
    SpineEd.draft = null;
    SpineEd.drag = -1;
    R.objProps.innerHTML = "";
    const fields = PROP_FIELDS[kind];
    if (!fields) return;

    // Mọi field trước mục đầu tiên nằm thẳng trong panel — toạ độ và phe thì
    // luôn phải thấy. Từ mục đầu tiên trở đi, field rơi vào thân của mục đang
    // mở gần nhất.
    let target = R.objProps;
    // Khoá của mục đang mở, gom lại trong lúc chạy chứ không liệt kê tay ở
    // bảng field. Liệt kê tay chính là thứ đã làm rơi sạch `stats` của slot ở
    // ba chỗ khác nhau và không chỗ nào báo gì.
    let head = null;
    let keys = [];
    const flush = () => {
      if (!head) return;
      head.setAttribute("data-section-keys", JSON.stringify(keys));
      // Nhóm nào khai sẵn nhánh cần xoá thì giữ nguyên; còn lại thì xoá đúng
      // những ô nó đang hiện.
      const clear = head.querySelector("[data-section-clear]");
      if (clear && !clear.dataset.clearKeys) clear.dataset.clearKeys = JSON.stringify(keys);
    };

    for (const f of fields) {
      // Một dải ngăn cách, không phải một ô: mấy field bên dưới nó ghi đè chỉ
      // số của core, khác hẳn về ý nghĩa với toạ độ và phe ở trên.
      if (f.group) {
        flush();
        const section = openSection(f);
        head = section.head;
        keys = [];
        target = section.body;
        if (!f.groupKey) continue;
        target.appendChild(el("p", { class: "muted", style: "margin:0 0 2px" },
          "Chỉ riêng cái này. Để trống = theo chỉ số của map, rồi tới của core."));
        // The link is what keeps the two halves from reading as two features.
        // Someone editing one turret is exactly the person who might mean
        // "every turret", and this is the only place they will think of it.
        target.appendChild(el("button", {
          class: "btn block", style: "margin:4px 0 2px",
          onclick: () => openRules(f.groupKey),
        }, `${ico("settings", "ico ico-sm")} Đổi cho tất cả ở tab Luật chơi…`));
        continue;
      }

      if (f.kind === "rigPreview") {
        target.appendChild(buildRigPreview(target.style.display === "none"));
        continue;
      }

      if (f.kind === "spineEditor") {
        target.appendChild(buildSpineEditor());
        continue;
      }

      if (f.key) keys.push(f.key);

      const row = el("div", { class: "row", style: "margin-top:7px" });
      row.appendChild(el("label", { text: f.label, title: f.hint || f.label }));

      let input;
      if (f.kind === "faction" || f.kind === "lane") {
        input = el("select", { class: "inp" });
      } else if (f.kind === "choice") {
        input = el("select", { class: "inp" });
        input.innerHTML = f.options
          .map((o) => `<option value="${esc(o)}">${esc(o || "— mặc định —")}</option>`)
          .join("");
      } else if (f.kind === "color") {
        input = el("input", { class: "inp", type: "color", style: "padding:2px;height:26px" });
        // Mặc định của core đi kèm element: `fillProps` duyệt DOM chứ không
        // duyệt bảng field, nên nó không với tới descriptor được.
        if (f.def) input.dataset.defColor = rgbToHex(f.def);
      } else if (f.kind === "static") {
        input = el("input", { class: "inp", type: "text", value: f.value, disabled: "" });
      } else {
        input = el("input", {
          class: "inp",
          type: f.kind === "number" ? "number" : "text",
          // Số mặc định của core làm placeholder: người vẽ map thấy ngay mình
          // đang đi lệch khỏi cái gì mà không phải mở mã nguồn ra tra.
          placeholder: f.placeholder || f.ph || "",
          min: f.min,
        });
        if (f.kind === "text" || f.kind === "list" || f.kind === "numlist") {
          input.style.fontFamily = "var(--font)";
        }
      }
      input.dataset.prop = f.key;
      input.dataset.pkind = f.kind;

      if (f.kind !== "static") {
        const send = () => {
          let v = input.value;
          if (f.kind === "number") v = v === "" ? "" : Number(v);
          // Core reads colours as `[r, g, b]` everywhere (`attackColor` set the
          // shape); `<input type="color">` only speaks hex.
          if (f.kind === "color") v = hexToRgb(v);
          // Mảng rỗng ("[]") là một khai báo thật — điểm này không ra con lính
          // nào — nên nó phải phân biệt được với ô để trống, vốn nghĩa là
          // "theo đội hình chung". Xem `MinionSlot.stats.composition`.
          // Số thứ tự đốt, không phải tên: "1, 3" phải ra [1, 3] chứ không
          // phải ["1", "3"] — core đọc nó làm chỉ số mảng.
          if (f.kind === "numlist") {
            const parts = v.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
            v = v.trim() === "" ? "" : parts;
          }
          if (f.kind === "list") {
            const trimmed = v.trim();
            v = trimmed === "" ? ""
              : trimmed === "[]" ? []
              : trimmed.split(",").map((x) => x.trim()).filter(Boolean);
          }
          Cmd.run("shape.prop", [f.key, v]);
        };
        input.addEventListener("change", send);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { send(); input.blur(); } });
      }

      const field = el("div", { class: "field" });
      field.appendChild(input);
      if (f.unit) field.appendChild(el("span", { class: "unit", text: f.unit }));
      row.appendChild(field);

      // Ô màu là field duy nhất không tự xoá được. Số và chữ thì bỏ trống là
      // về mặc định, ô chọn có mục "— mặc định —", còn `<input type="color">`
      // thì *luôn* có một giá trị — chọn nhầm một cái là kẹt luôn với nó.
      if (f.kind === "color") {
        const clear = el("button", {
          class: "btn", title: "Bỏ ghi đè, dùng lại màu mặc định của core",
          onclick: () => Cmd.run("shape.prop", [f.key, ""]),
        }, ico("x", "ico ico-sm"));
        clear.dataset.clear = f.key;
        row.appendChild(clear);
      }

      target.appendChild(row);
    }
    flush();

    if (kind === "lane") {
      const row = el("div", { class: "row", style: "margin-top:7px" });
      row.appendChild(el("label", { text: "Hai đầu", title: "Hai phe cùng đi con đường này" }));
      row.appendChild(el("div", { id: "lane-ends", class: "field", style: "display:flex;align-items:center;gap:6px;font-size:12px" }));
      R.objProps.appendChild(row);

      R.objProps.appendChild(el("button", {
        class: "btn block", style: "margin-top:7px",
        title: "Đổi xem đầu nào là waypoint 0 — core cho phe thứ nhất đi xuôi danh sách",
        onclick: () => Cmd.run("lane.reverse"),
      }, `${ico("reverse", "ico ico-sm")} Đảo chiều lane`));

      R.objProps.appendChild(el("p", { class: "muted", style: "margin:7px 0 0" },
        "Một lane phục vụ cả hai phe — core tự cho phe thứ hai đi ngược danh sách waypoint. Chỉ cần đúng đầu nào là waypoint 0."));
    }
  }

  /** `obj.a.b.c`, hoặc `undefined` nếu bất kỳ tầng nào chưa tồn tại. */
  function readDeep(obj, path) {
    let node = obj;
    for (const k of path.split(".")) {
      if (!node || typeof node !== "object") return undefined;
      node = node[k];
    }
    return node;
  }

  function fillProps(kind) {
    const fields = PROP_FIELDS[kind];
    if (!fields) return;
    const src = (Sel.one || E.selection[0] || {}).props || {};

    R.objProps.querySelectorAll("[data-prop]").forEach((input) => {
      const key = input.dataset.prop;
      const pkind = input.dataset.pkind;

      if (key.includes(".")) {
        if (document.activeElement === input) return;
        const v = readDeep(src, key);
        if (pkind === "color") {
          const set = Array.isArray(v);
          // Chưa đặt thì hiện đúng màu core sẽ dùng, không phải một màu xám bâng
          // quơ: người ta cần thấy trước cái mình đang được cho, và một ô xám
          // không phân biệt được "chưa đặt" với "đặt màu xám".
          input.value = set ? rgbToHex(v) : input.dataset.defColor || "#808080";
          const clear = R.objProps.querySelector(`[data-clear="${key}"]`);
          if (clear) {
            clear.disabled = !set;
            clear.style.opacity = set ? "" : ".35";
          }
          return;
        }
        // `String([])` là chuỗi rỗng, tức là một đội hình rỗng đã khai báo sẽ
        // hiện y hệt ô chưa khai gì — hai trạng thái khác hẳn nhau. `[]` là
        // cách nó tự nói ra, và `send` ở trên đọc lại đúng chuỗi đó.
        input.value =
          v == null ? ""
          : Array.isArray(v) ? (v.length ? v.join(", ") : "[]")
          : v;
        return;
      }

      if (pkind === "faction" || pkind === "lane") {
        const opts = pkind === "faction" ? E.meta.factions : laneIds();
        const want = opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
        if (input.dataset.opts !== want) { input.innerHTML = want; input.dataset.opts = want; }
        if (src[key] != null && !opts.includes(src[key])) {
          input.insertAdjacentHTML("afterbegin", `<option value="${esc(src[key])}">${esc(src[key])} (không tồn tại)</option>`);
        }
      }
      if (document.activeElement === input) return;
      input.value = src[key] == null ? "" : src[key];
    });

    // Bộ sửa cột sống chỉ có nghĩa với thân nhiều đốt. Ẩn/hiện ở đây chứ không
    // ở `buildProps`: kiểu thân đổi được mà không dựng lại cả bảng.
    if (SpineEd.box) {
      const chain = readDeep(src, "stats.rig.body.kind") === "chain";
      SpineEd.box.style.display = chain ? "" : "none";
      const reset = SpineEd.box.querySelector("[data-spine-reset]");
      if (reset) {
        const own = Array.isArray(readDeep(src, "stats.rig.body.widths"));
        reset.disabled = !own;
        reset.style.opacity = own ? "" : ".3";
      }
      if (chain) paintSpineEditor();
    }

    // Một mục gập phải tự nói ra là bên trong nó có gì, không thì người ta
    // phải mở từng mục mới biết mình đã đặt gì cho bãi này.
    R.objProps.querySelectorAll("[data-section-keys]").forEach((head) => {
      let set = 0;
      for (const key of JSON.parse(head.dataset.sectionKeys)) {
        const v = key.includes(".") ? readDeep(src, key) : src[key];
        if (v != null && v !== "") set++;
      }
      head.querySelector("[data-section-count]").textContent = set ? `${set} đang đặt` : "";
      const clear = head.querySelector("[data-section-clear]");
      if (clear) {
        clear.disabled = !set;
        clear.style.opacity = set ? "" : ".3";
      }
    });

    if (kind === "lane") {
      const box = R.objProps.querySelector("#lane-ends");
      if (box) {
        const chip = (f) =>
          `<span class="tdot" style="background:${factionColor(f)}"></span>` +
          `<span style="color:var(--tx-2)">${esc(f || "?")}</span>`;
        box.innerHTML = `${chip(src.from)}<span style="color:var(--tx-3);margin:0 2px">⇄</span>${chip(src.to)}`;
      }
    }
  }

  function syncProps() {
    if (!R.objProps) return;
    const kinds = new Set(E.selection.map((t) => t.type));
    const kind = kinds.size === 1 ? [...kinds][0] : null;
    const key = kind ? kind + ":" + E.selection.length : "";
    if (key !== propsKey) { propsKey = key; buildProps(kind); }
    fillProps(kind);
  }

  /* ------------------------------ đồng bộ ------------------------------ */

  function syncSelection() {
    if (!R.sObj) return;
    const n = E.selection.length;
    R.sObj.classList.toggle("hidden", n === 0);
    $("#inspector-title").textContent = n === 0 ? "Thuộc tính" : n === 1 ? "Đối tượng" : `${n} đối tượng`;
    syncToolbar();
    syncLayers();
    scheduleCheck();
    if (n === 0) { propsKey = ""; return; }

    const one = Sel.one;
    const kinds = new Set(E.selection.map((t) => t.type));
    R.objTitle.textContent = one ? KIND[one.type].label : `${n} đối tượng`;

    if (E.editing) {
      R.objSub.textContent = `${E.vertexSel.size}/${E.editing.polygon.length} đỉnh`;
    } else if (one) {
      const shape = KIND[one.type].shape;
      R.objSub.textContent =
        shape === "poly" ? `${one.polygon.length} đỉnh · ${one.polygons.length} mảnh`
          : shape === "line" ? `${one.polygon.length} waypoint`
            : shape === "circle" ? `r ${Math.round(circleR(one))}`
              : "điểm";
    } else {
      R.objSub.textContent = "";
    }

    // chỉ cho đổi loại trong cùng nhóm — polygon không thể thành điểm hồi sinh
    const group = kinds.size === 1 ? KIND[[...kinds][0]].group : null;
    const choices = group === "terrain" ? TERRAIN_KINDS : group === "slot" ? SLOT_KINDS : [];
    const want = choices.join(",");
    if (R.objTypes.dataset.kinds !== want) {
      R.objTypes.dataset.kinds = want;
      R.objTypes.innerHTML = "";
      R.objTypes.classList.toggle("hidden", choices.length === 0);
      for (const k of choices) {
        R.objTypes.appendChild(el("button", {
          "data-type": k, onclick: () => Cmd.run("shape.type", k),
        }, `<span class="tdot ${k}"></span>${esc(KIND[k].label)}`));
      }
    }
    R.objTypes.querySelectorAll("[data-type]").forEach((b) => {
      b.classList.toggle("on", kinds.size === 1 && kinds.has(b.dataset.type));
    });

    const c = one ? one.position : Sel.center();
    if (document.activeElement !== R.objX) R.objX.value = Math.round(c[0]);
    if (document.activeElement !== R.objY) R.objY.value = Math.round(c[1]);

    // Gốc lệch bao nhiêu — nói thẳng ra để biết có cần bấm hay không. Nút vẫn
    // hiện khi đã căn, vì chính dòng chữ "đã căn" mới là thông tin cần thấy.
    const anyShape = E.selection.some(hasVerts);
    R.recenter.classList.toggle("hidden", !anyShape);
    if (anyShape) {
      const off = one ? Cmd.centerOffset(one) : null;
      R.centerOff.textContent = !off ? "" : (off[0] || off[1]) ? `lệch ${off[0]}, ${off[1]}` : "đã căn";
    }

    syncProps();

    // Xoay hình chỉ có nghĩa khi có đỉnh để xoay, hoặc khi chọn nhiều (lúc đó
    // cả nhóm quay quanh tâm chung). Co giãn thêm trường hợp vòng tròn: nó
    // đổi bán kính. Ẩn hẳn thay vì để nút bấm không ra gì.
    const many = n > 1;
    const anyVerts = E.selection.some(hasVerts);
    const anyCircle = E.selection.some((t) => KIND[t.type].shape === "circle");
    R.objRotRow.classList.toggle("hidden", !(anyVerts || many));
    R.objFlipRow.classList.toggle("hidden", !(anyVerts || many));
    R.objScaleRow.classList.toggle("hidden", !(anyVerts || anyCircle || many));
    R.objShape.classList.toggle("hidden", !(anyVerts || anyCircle || many));

    R.objHint.innerHTML = E.editing
      ? `Đang sửa đỉnh — kéo trên nền để quét chọn nhiều đỉnh · <kbd>⌫</kbd> xoá đỉnh đã chọn · <kbd>Ctrl</kbd><kbd>A</kbd> chọn hết · <kbd>Esc</kbd> thoát`
      : one && hasVerts(one)
        ? `<kbd>E</kbd> hoặc nháy đúp để sửa nhiều đỉnh · <kbd>A</kbd> thêm ${isLine(one) ? "waypoint" : "đỉnh"} · <kbd>D</kbd> xoá đỉnh`
        : `Kéo để di chuyển · <kbd>⌫</kbd> xoá`;
  }

  function syncLayers() {
    if (!R.layers) return;
    const counts = countByType();
    R.layers.querySelectorAll("[data-layer]").forEach((b) => {
      const k = b.dataset.layer;
      b.classList.toggle("on", !!E.visible[k]);
      b.querySelector("[data-count]").textContent = counts[k] || 0;
    });
  }

  function syncFactions() {
    if (!R.factions) return;
    R.factionCount.textContent = E.meta.factions.length;
    R.factions.innerHTML = "";
    E.meta.factions.forEach((f, i) => {
      const row = el("div", { class: "row" });
      row.appendChild(el("span", { class: "tdot", style: `background:${factionColor(f)}` }));
      const input = el("input", { class: "inp", type: "text", value: f, style: "font-family:var(--font)" });
      input.addEventListener("change", () => Cmd.run("map.renameFaction", [f, input.value.trim()]));
      const field = el("div", { class: "field" });
      field.appendChild(input);
      row.appendChild(field);
      row.appendChild(el("button", {
        class: "icon-btn", title: "Xoá phe",
        onclick: () => Cmd.run("map.removeFaction", f),
      }, ico("trash", "ico ico-sm")));
      R.factions.appendChild(row);
    });
  }

  let checkTimer = 0;
  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(syncCheck, 320) as unknown as number;
  }

  /**
   * Bay tới chỗ hỏng và nháy một vòng ở đó.
   *
   * Một dòng chữ tả chỗ hỏng rồi bắt người ta tự đi tìm trong khung
   * 6400×6400 là bắt người ta làm việc mà máy đã biết câu trả lời — và với
   * mấy lỗi hình học mới (lane cọ tường, waypoint nằm trong trụ) thì "chỗ đó"
   * còn không phải một hình nào bấm chọn được, nó là một điểm giữa quãng đi.
   *
   * `fitRect` chứ không phải `moveTo`: nó biết né thanh công cụ và bảng thuộc
   * tính, nên chỗ hỏng rơi vào giữa phần màn hình còn *trống* thay vì nằm sau
   * cái bảng người ta vừa đọc lỗi trên đó.
   */
  function focusIssue(at) {
    if (!at) return;
    const pad = 260;
    Cam.fitRect([at[0] - pad, at[1] - pad, at[0] + pad, at[1] + pad], 90);
    E.checkFocus = { x: at[0], y: at[1], since: performance.now() };
    // Không có dòng này thì không có gì xảy ra cả: editor chỉ vẽ khi có ai đó
    // yêu cầu, và `fitRect` chỉ đặt đích cho camera chứ không tự khởi động
    // vòng lặp. Frame đầu tiên là thứ bắt đầu cả cú bay lẫn vòng nháy.
    requestRender();
  }

  function syncCheck() {
    if (!R.check) return;
    const issues = Store.validate();
    R.check.innerHTML = "";
    if (!issues.length) {
      R.check.innerHTML = `<span style="color:var(--accent)">${ico("check", "ico ico-sm")} Map hợp lệ với schema moba2d.</span>`;
      return;
    }
    const errs = issues.filter((i) => i.level === "error");
    R.check.appendChild(
      el("div", { style: "margin-bottom:5px" },
        `<b style="color:${errs.length ? "var(--danger)" : "var(--gold)"}">` +
        `${errs.length} lỗi · ${issues.length - errs.length} cảnh báo</b>`)
    );

    for (const issue of issues.slice(0, 8)) {
      const colour = issue.level === "error" ? "var(--danger)" : "var(--gold)";
      const row = el("div", {
        class: issue.at ? "check-row" : "",
        style: `color:${colour};margin-bottom:3px` + (issue.at ? ";cursor:pointer" : ""),
        title: issue.at ? "Bấm để bay tới chỗ này" : "",
      }, `• ${esc(issue.text)}` + (issue.at
        ? ` <span style="color:var(--tx-3)">(${Math.round(issue.at[0])}, ${Math.round(issue.at[1])})</span>`
        : ""));
      if (issue.at) row.addEventListener("click", () => focusIssue(issue.at));
      R.check.appendChild(row);
    }
    if (issues.length > 8) {
      R.check.appendChild(el("div", { text: `… và ${issues.length - 8} mục nữa` }));
    }
  }

  function syncView() {
    if (!R.tgGrid) return;
    R.tgGrid.classList.toggle("on", E.showGrid);
    R.tgSnap.classList.toggle("on", E.snap);
    R.tgVidx.classList.toggle("on", E.showVertexIndex);
    R.tgDummy.classList.toggle("on", E.showDummy);
    R.tgBg.classList.toggle("on", E.showBg);
    if (document.activeElement !== R.gridSize) R.gridSize.value = E.gridSize;
    R.bgSelect.value = E.background && E.background.kind === "asset" ? E.background.value : "";
    if (E.background && E.background.kind === "upload") {
      if (!R.bgSelect.querySelector('option[value="__up"]')) {
        R.bgSelect.appendChild(el("option", { value: "__up", text: "Ảnh của bạn" }));
      }
      R.bgSelect.value = "__up";
    }
    $("#minimap-card").classList.toggle("hidden", !E.showMinimap);
    syncToolbar();
  }

  function syncMapName() {
    $("#brand-name").textContent = E.mapName || "Map";
    document.title = (E.mapName ? E.mapName + " — " : "") + "MOBA2D Map Editor";
    if (R.mapName && document.activeElement !== R.mapName) R.mapName.value = E.mapName || "";
  }

  function syncMap() {
    if (!R.mapW) return;
    if (document.activeElement !== R.mapW) R.mapW.value = E.mapSize[0];
    if (document.activeElement !== R.mapH) R.mapH.value = E.mapSize[1];
    if (document.activeElement !== R.mapId) R.mapId.value = E.meta.id || "";
    R.squareWarn.classList.toggle("hidden", E.mapSize[0] === E.mapSize[1]);
    syncFactions();
    syncMapName();
  }

  function syncHistory() { syncToolbar(); }

  /**
   * Mọi ô trong "Cấu hình map", theo đúng thứ tự `MapTuning` khai báo chúng.
   *
   * `ph` là số mặc định của core, hiện làm placeholder. Đó không phải trang
   * trí: người vẽ map cần thấy mình đang đi lệch khỏi cái gì ngay tại ô đang
   * gõ, chứ không phải mở mã nguồn engine ra tra.
   */
  /**
   * Bảng tuning, đọc từ core (`src/game/config/tuningSchema.ts`).
   *
   * Trước đây nó nằm ngay ở đây, và đó là một bản ý kiến thứ hai viết tay về
   * `MapTuning` — sai một khoá thì map bị từ chối lúc cài, sau một dòng
   * console không ai đọc. Giờ trình biên dịch giữ hai bên khớp nhau: thiếu
   * một nhóm là lỗi build, gõ sai một khoá cũng vậy.
   */

  /** Các ô số của một loại lính, dùng lại cho mọi loại map khai ra. */
  const MINION_TYPE_FIELDS: { key: string; label: string; unit?: string; hint?: string }[] = [
    { key: "health", label: "Máu", unit: "hp" },
    { key: "damage", label: "Sát thương", unit: "dmg" },
    { key: "speed", label: "Tốc chạy", unit: "px/frame" },
    { key: "size", label: "Kích thước", unit: "px" },
    { key: "attackRange", label: "Tầm đánh", unit: "px" },
    { key: "attackInterval", label: "Nhịp đánh", unit: "ms" },
    { key: "aggroRange", label: "Tầm phát hiện", unit: "px" },
    { key: "goldBounty", label: "Vàng", unit: "g" },
  ];

  let tuningOpen = new Set();
  /**
   * Which pane is showing. Module state rather than persisted: this is a
   * drawing tool, so every session should open on the drawing pane no matter
   * where the last one ended.
   */
  let inspectorTab = "draw";

  function showTab(tab) {
    inspectorTab = tab;
    if (!R.paneDraw) return;
    R.paneDraw.classList.toggle("hidden", tab !== "draw");
    R.paneRules.classList.toggle("hidden", tab !== "rules");
    R.tabDraw.classList.toggle("on", tab === "draw");
    R.tabRules.classList.toggle("on", tab === "rules");
    requestRender();
  }

  /** Jump to the rules pane — used by the cross-link on a slot's own overrides. */
  function openRules(groupKey) {
    if (groupKey) tuningOpen.add(groupKey);
    showTab("rules");
    syncTuning();
  }

  /**
   * The map's rules as a sentence, not a form.
   *
   * A count of touched groups tells you *that* something is different; this
   * tells you **what**, which is the difference between a badge and an
   * answer. It reads off the same object the fields write to, so it cannot
   * describe a rule the map does not have.
   */
  function tuningSummary(tuning) {
    const bits = [];
    const n = (v) => (Math.round(v * 100) / 100).toString();

    const c = tuning.champions || {};
    if (c.reviveTime != null) bits.push(`hồi sinh ${n(c.reviveTime / 1000)}s`);
    if (c.reviveCurve) bits.push("hồi sinh tăng dần");

    const e = tuning.economy || {};
    if (e.startingGold != null) bits.push(`vàng đầu ${n(e.startingGold)}`);
    if (e.passiveGoldPerSecond != null) bits.push(`${n(e.passiveGoldPerSecond)} vàng/giây`);
    if (e.assistWindowMs != null) bits.push(`hỗ trợ trong ${n(e.assistWindowMs / 1000)}s`);
    if (e.assistGoldShare != null) bits.push(`hỗ trợ ${n(e.assistGoldShare * 100)}% tiền mạng`);
    if (e.killCreditWindowMs != null) bits.push(`ăn mạng trong ${n(e.killCreditWindowMs / 1000)}s`);
    for (const [key, label] of [
      ["minionBounty", "lính"],
      ["monsterBounty", "quái"],
      ["championBounty", "tướng"],
      ["turretBounty", "trụ"],
    ]) {
      if (e[key] != null) bits.push(`${label} ${n(e[key])}g`);
    }

    const t = tuning.turrets || {};
    if (t.damage != null) bits.push(`trụ ${n(t.damage)} sát thương`);
    if (t.attackRange != null) bits.push(`trụ tầm ${n(t.attackRange)}`);
    if (t.health != null) bits.push(`trụ ${n(t.health)} máu`);

    const f = tuning.fountain || {};
    if (f.healPercent != null) bits.push(`bệ đá hồi ${n(f.healPercent * 100)}%`);
    if (f.shopRange != null) bits.push(`mua đồ trong ${n(f.shopRange)}px`);

    const m = tuning.monsters || {};
    for (const [key, label] of [
      ["healthMult", "máu"],
      ["damageMult", "sát thương"],
      ["speedMult", "tốc"],
    ]) {
      if (m[key] != null) bits.push(`quái ×${n(m[key])} ${label}`);
    }
    if (m.chaseMargin != null) bits.push(`quái đuổi +${n(m.chaseMargin)}`);

    const terrain = tuning.terrain || {};
    if (terrain.bush && terrain.bush.speedMultiplier != null) {
      bits.push(`bụi ×${n(terrain.bush.speedMultiplier)} tốc`);
    }
    if (terrain.water && terrain.water.speedMultiplier != null) {
      bits.push(`sông ×${n(terrain.water.speedMultiplier)} tốc`);
    }

    const mi = tuning.minions || {};
    const typeCount = mi.types ? Object.keys(mi.types).length : 0;
    if (typeCount) bits.push(`lính: ${typeCount} loại riêng`);
    if (mi.waves && mi.waves.intervalMs != null) {
      bits.push(`wave mỗi ${n(mi.waves.intervalMs / 1000)}s`);
    }

    const v = tuning.vision || {};
    // 0 said in words, not as "lộ 0s": that number reads as a rounding error
    // when it is in fact the most map-defining thing on the whole list.
    if (v.attackRevealMs != null) {
      bits.push(v.attackRevealMs > 0 ? `đánh trong bụi lộ ${n(v.attackRevealMs / 1000)}s` : "bụi tàng hình thật");
    }
    if (v.attackRevealRadius != null) bits.push(`lộ rộng ${n(v.attackRevealRadius)}px`);

    return bits;
  }

  function tuningRow(label, hint, path, value, unit?, ph?) {
    const row = el("div", { class: "row", style: "margin-top:6px" });
    row.appendChild(el("label", { text: label, title: hint || label }));
    const input = el("input", {
      class: "inp", type: "number", min: 0, placeholder: ph || "",
      value: value == null ? "" : value,
    });
    const send = () => {
      const raw = input.value;
      Cmd.run("map.tuning", [path, raw === "" ? "" : Number(raw)]);
      syncTuning();
    };
    input.addEventListener("change", send);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { send(); input.blur(); } });
    const field = el("div", { class: "field" });
    field.appendChild(input);
    if (unit) field.appendChild(el("span", { class: "unit", text: unit }));
    row.appendChild(field);
    return row;
  }

  /**
   * "Mỗi wave mấy con" — a count that writes an ordered list.
   *
   * `tuningRow` cannot serve this: it writes one value at one path, and this
   * writes a whole `composition` array rebuilt from every type's count (see
   * `map.waveCount`). Same markup, same commit-on-change/Enter, so the two
   * rows are indistinguishable to whoever is filling the form.
   */
  function waveCountRow(typeId, label, count) {
    const row = el("div", { class: "row", style: "margin-top:6px" });
    row.appendChild(el("label", {
      text: label,
      title: "Bỏ trống hoặc 0 thì loại lính này không bao giờ ra sân.",
    }));
    const input = el("input", { class: "inp", type: "number", min: 0, placeholder: "0", value: count || "" });
    const send = () => {
      Cmd.run("map.waveCount", [typeId, input.value]);
      syncTuning();
    };
    input.addEventListener("change", send);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { send(); input.blur(); } });
    const field = el("div", { class: "field" });
    field.appendChild(input);
    field.appendChild(el("span", { class: "unit", text: "con" }));
    row.appendChild(field);
    return row;
  }

  /**
   * Vẽ lại toàn bộ panel cấu hình.
   *
   * Dựng lại từ đầu chứ không vá tại chỗ: panel này không nằm trên đường vẽ
   * mỗi frame, số ô thì thay đổi theo số loại lính map khai, và một cây DOM
   * dựng lại được là cây không bao giờ lệch khỏi `E.meta.tuning`.
   */
  function syncTuning() {
    if (!R.tuning) return;
    const tuning = (E.meta && E.meta.tuning) || {};
    const groups = Object.keys(tuning).length;
    R.tuningCount.textContent = groups ? `${groups} nhóm` : "";

    // The badge is the whole discoverability story from the drawing pane: a
    // map with rules says so without being opened.
    R.tabsBadge.textContent = groups ? String(groups) : "";
    R.tabsBadge.style.color = groups ? "var(--accent)" : "";

    const bits = tuningSummary(tuning);
    if (!bits.length) {
      R.tuningSummary.textContent = "Map này đang chơi bằng chỉ số mặc định của core.";
    } else {
      // Capped: a summary that runs to twenty phrases is a form again.
      const shown = bits.slice(0, 6);
      const rest = bits.length - shown.length;
      R.tuningSummary.innerHTML =
        `<span style="color:var(--tx)">${esc(shown.join(" · "))}</span>` +
        (rest > 0 ? `<span style="color:var(--tx-3)"> · +${rest} nữa</span>` : "");
    }

    R.tuning.innerHTML = "";

    for (const group of TUNING_SCHEMA) {
      const body = tuning[group.key] || {};
      const touched = Object.keys(body).length;
      const open = tuningOpen.has(group.key);

      // `div`, không phải `button`: nút Về mặc định nằm bên trong nó, và
      // button lồng button là HTML không hợp lệ. Giống hệt các mục trong
      // inspector.
      const head = el("div", {
        class: "btn block",
        style: "margin-top:6px;text-align:left;display:flex;align-items:center;gap:6px;cursor:pointer",
        onclick: () => {
          if (open) tuningOpen.delete(group.key); else tuningOpen.add(group.key);
          syncTuning();
        },
      });
      head.innerHTML =
        `<span style="display:inline-block;transition:transform .12s${open ? "" : ";transform:rotate(-90deg)"}">` +
        `${ico("chevron-down", "ico ico-sm")}</span><span>${esc(group.label)}</span>` +
        (touched ? `<span class="mono" style="color:var(--accent);margin-left:auto">${touched}</span>` : "");
      if (touched) {
        // Trên đầu nhóm, không phải dưới đáy thân: chỗ duy nhất nhìn thấy "7 ô
        // đã đặt" cũng phải là chỗ bỏ được bảy ô đó — nếu không thì phải mở
        // nhóm ra mới reset được nó.
        head.appendChild(el("button", {
          class: "btn", style: "padding:1px 5px;margin-left:6px",
          title: `Bỏ ${touched} ghi đè của nhóm này, quay về mặc định của core`,
          onclick: (e) => {
            e.stopPropagation();
            Cmd.run("map.tuningResetGroup", [group.key]);
            syncTuning();
          },
        }, ico("undo", "ico ico-sm")));
      }
      R.tuning.appendChild(head);
      if (!open) continue;

      const box = el("div", { style: "padding:0 0 6px 8px;border-left:1px solid var(--line)" });
      // A one-line answer to "what is this group for", inside the group rather
      // than in a doc nobody opens while drawing.
      if (group.hint) {
        box.appendChild(el("p", { class: "muted", style: "margin:6px 0 2px" }, esc(group.hint)));
      }
      for (const f of group.fields) {
        box.appendChild(tuningRow(f.label, f.hint, `${group.key}.${f.key}`, readDeep(body, f.key), f.unit, f.ph));
      }
      if (group.minions) box.appendChild(minionTypesBox(body));
      R.tuning.appendChild(box);
    }
  }

  /**
   * Danh sách loại lính của map.
   *
   * `MinionTuning.types` **thay hẳn** ba loại của core chứ không trộn vào, nên
   * nút "Chép 3 loại mặc định" không phải tiện tay: nó là cách duy nhất để
   * "map này chỉ muốn lính cận chiến trâu hơn" không biến thành chép tay 24
   * con số. Đó cũng là lý do bảng này trống mặc định — trống nghĩa là dùng
   * lính của core, chứ không phải map không có lính.
   */
  function minionTypesBox(body) {
    const box = el("div", { style: "margin-top:8px" });
    const types = body.types || {};
    const ids = Object.keys(types);

    box.appendChild(el("div", { class: "sec-title", style: "margin:8px 0 2px" }, "Loại lính"));
    box.appendChild(el("p", { class: "muted", style: "margin:0 0 6px" },
      ids.length
        ? "Bảng này thay hẳn 3 loại của core."
        : "Trống = dùng 3 loại của core."));

    // Read once for the whole panel — `Cmd.waveCounts` derives it from the
    // exported `composition` array, which is the only copy of this fact.
    const counts = Cmd.waveCounts();
    for (const id of ids) {
      const def = types[id] || {};
      const head = el("div", { class: "row", style: "margin-top:8px" });
      head.appendChild(el("label", { text: id, title: id }));
      head.appendChild(el("button", {
        class: "btn", title: "Xoá loại này",
        onclick: () => { Cmd.run("map.tuningRemoveMinion", [id]); syncTuning(); },
      }, ico("trash", "ico ico-sm")));
      box.appendChild(head);

      const nameRow = el("div", { class: "row", style: "margin-top:6px" });
      nameRow.appendChild(el("label", { text: "Tên" }));
      const nameInput = el("input", { class: "inp", type: "text", value: def.name || "" });
      nameInput.style.fontFamily = "var(--font)";
      nameInput.addEventListener("change", () => {
        Cmd.run("map.tuning", [`minions.types.${id}.name`, nameInput.value]);
      });
      const nameField = el("div", { class: "field" });
      nameField.appendChild(nameInput);
      nameRow.appendChild(nameField);
      box.appendChild(nameRow);

      const styleRow = el("div", { class: "row", style: "margin-top:6px" });
      styleRow.appendChild(el("label", {
        text: "Kiểu", title: "Quyết định đánh gần hay bắn, và vẽ ra sao — không phải id",
      }));
      const styleSelect = el("select", { class: "inp" });
      styleSelect.innerHTML = ["melee", "ranged", "cannon"]
        .map((o) => `<option value="${o}"${(def.style || "melee") === o ? " selected" : ""}>${o}</option>`)
        .join("");
      styleSelect.addEventListener("change", () => {
        Cmd.run("map.tuning", [`minions.types.${id}.style`, styleSelect.value]);
      });
      const styleField = el("div", { class: "field" });
      styleField.appendChild(styleSelect);
      styleRow.appendChild(styleField);
      box.appendChild(styleRow);

      // **Mỗi wave mấy con.** Ô đầu tiên chứ không phải ô cuối, vì nó là ô
      // duy nhất mà bỏ trống thì loại lính này *không bao giờ ra sân*: đội
      // hình wave là một danh sách id, `MinionSpawner.spawn` bỏ qua id không
      // có trong danh sách, và không có gì báo. Khai một loại lính rồi quên
      // ô này là làm ra một con lính tồn tại trong file và không tồn tại
      // trong trận.
      box.appendChild(
        waveCountRow(id, `Mỗi wave (${def.name || id})`, counts[id] || 0)
      );

      for (const f of MINION_TYPE_FIELDS) {
        box.appendChild(tuningRow(f.label, f.hint, `minions.types.${id}.${f.key}`, def[f.key], f.unit));
      }
    }

    const addRow = el("div", { class: "row", style: "margin-top:8px" });
    const newId = el("input", { class: "inp", type: "text", placeholder: "siege" });
    newId.style.fontFamily = "var(--font)";
    addRow.appendChild(newId);
    addRow.appendChild(el("button", {
      class: "btn",
      onclick: () => { Cmd.run("map.tuningAddMinion", [newId.value]); syncTuning(); },
    }, `${ico("plus", "ico ico-sm")} Thêm`));
    box.appendChild(addRow);

    if (!ids.length) {
      box.appendChild(el("button", {
        class: "btn block", style: "margin-top:6px",
        onclick: () => { Cmd.run("map.tuningSeedMinions"); syncTuning(); },
      }, `${ico("plus", "ico ico-sm")} Chép 3 loại mặc định`));
    }

    const compRow = el("div", { class: "row", style: "margin-top:8px" });
    compRow.appendChild(el("label", { text: "Đội hình", title: "id các loại, cách nhau bằng dấu phẩy" }));
    const comp = el("input", {
      class: "inp", type: "text", placeholder: "melee, melee, ranged",
      value: ((body.waves && body.waves.composition) || []).join(", "),
    });
    comp.style.fontFamily = "var(--font)";
    comp.addEventListener("change", () => {
      const list = comp.value.split(",").map((x) => x.trim()).filter(Boolean);
      Cmd.run("map.tuning", ["minions.waves.composition", list.length ? list : ""]);
      syncTuning();
    });
    const compField = el("div", { class: "field" });
    compField.appendChild(comp);
    compRow.appendChild(compField);
    box.appendChild(compRow);

    return box;
  }

  function syncAll() {
    syncMap();
    syncTuning();
    syncView();
    syncLayers();
    syncSelection();
    syncInspectorOpen();
    scheduleCheck();
  }

  function syncInspectorOpen() {
    $("#inspector").classList.toggle("closed", !E.inspectorOpen);
    requestRender();
  }

  /* --------------------------- thanh trạng thái ------------------------ */

  const last = { coord: "", sel: "", count: "", zoom: "", hint: "" };

  function syncStatus() {
    const coord = `${Math.round(E.mouse[0])}, ${Math.round(E.mouse[1])}`;
    if (coord !== last.coord) { $("#st-coord").textContent = coord; last.coord = coord; }

    const n = E.selection.length;
    const sel = n === 0 ? "Chưa chọn" : n === 1
      ? KIND[E.selection[0].type].label
      : `${n} đối tượng`;
    if (sel !== last.sel) { $("#st-sel").textContent = sel; last.sel = sel; }

    const count = `${E.terrains.length} terrain`;
    if (count !== last.count) { $("#st-count").textContent = count; last.count = count; }

    const zoom = Math.round(Cam.scale * 100) + "%";
    if (zoom !== last.zoom) { $("#zoom-value").textContent = zoom; last.zoom = zoom; }

    const hint = hintText();
    if (hint !== last.hint) { $("#st-hint").textContent = hint; last.hint = hint; }
  }

  function hintText() {
    if (E.pen) return "Nháy để thêm đỉnh · Enter/nháy đỉnh đầu để đóng · Esc huỷ";
    if (E.editing) {
      return E.vertexSel.size
        ? `${E.vertexSel.size} đỉnh đang chọn — kéo để di chuyển, ⌫ để xoá`
        : "Sửa đỉnh — kéo trên nền để quét chọn nhiều đỉnh · Esc để thoát";
    }
    switch (E.tool) {
      case "hand": return "Kéo để di chuyển khung nhìn";
      case "marquee": return "Kéo một vùng để chọn nhiều polygon";
      case "pen": return "Nháy từng điểm để vẽ polygon";
      default: return E.selection.length ? "Kéo để di chuyển · kéo chấm vàng để sửa đỉnh" : "Kéo trên nền trống để quét chọn";
    }
  }

  let saveTimer = 0;
  function setSaveState(s) {
    const box = $("#st-save"), txt = $("#st-save-text");
    if (!box) return;
    clearTimeout(saveTimer);
    if (s === "saving") {
      box.classList.add("saving");
      txt.textContent = "Đang lưu…";
    } else if (s === "error") {
      box.classList.remove("saving");
      txt.textContent = "Lưu lỗi";
    } else {
      box.classList.remove("saving");
      txt.textContent = "Đã lưu";
    }
  }

  /* ============================ menu chọn map =========================== */

  function drawMapThumb(canvas, record) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 190, h = 104;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#0a0d12";
    c.fillRect(0, 0, w, h);

    const ms = Array.isArray(record.mapSize) ? record.mapSize : [6400, 6400];
    const k = Math.min(w / ms[0], h / ms[1]) * 0.86;
    c.save();
    c.translate((w - ms[0] * k) / 2, (h - ms[1] * k) / 2);
    c.scale(k, k);
    c.fillStyle = "#111823";
    c.fillRect(0, 0, ms[0], ms[1]);

    const data = Store.toList(record.data);
    for (let i = 0; i < data.length && i < 900; i++) {
      const raw = data[i];
      let type = raw.type === "brush" ? "bush" : raw.type;
      if (type === "turret1" || type === "turret2") type = "structure";
      if (!KIND[type]) type = "wall";
      let pos = raw.position, poly = raw.polygon;
      if (typeof pos === "string") { try { pos = JSON.parse(pos); } catch (e) { pos = [0, 0]; } }
      if (typeof poly === "string") { try { poly = JSON.parse(poly); } catch (e) { poly = []; } }
      if (!Array.isArray(pos)) pos = [0, 0];
      c.fillStyle = KIND[type].color;
      c.globalAlpha = 0.55;
      const shape = KIND[type].shape;
      if (shape === "circle" || shape === "point") {
        c.beginPath();
        c.arc(pos[0], pos[1], shape === "circle" ? ((raw.props && raw.props.r) || 150) : 90, 0, Geom.TAU);
        c.fill();
      } else if (shape === "line" && Array.isArray(poly) && poly.length >= 2) {
        c.beginPath();
        c.moveTo(poly[0][0] + pos[0], poly[0][1] + pos[1]);
        for (let j = 1; j < poly.length; j++) c.lineTo(poly[j][0] + pos[0], poly[j][1] + pos[1]);
        c.strokeStyle = KIND[type].color;
        c.lineWidth = 30;
        c.stroke();
      } else if (Array.isArray(poly) && poly.length >= 3) {
        c.beginPath();
        c.moveTo(poly[0][0] + pos[0], poly[0][1] + pos[1]);
        for (let j = 1; j < poly.length; j++) c.lineTo(poly[j][0] + pos[0], poly[j][1] + pos[1]);
        c.closePath();
        c.fill();
      }
    }
    c.globalAlpha = 1;
    c.restore();
  }

  function mapMenu() {
    return openModal({
      title: "Map của bạn",
      wide: true,
      build: (body, foot, close) => {
        const grid = el("div", { class: "maps-grid" });

        const render = () => {
          grid.innerHTML = "";
          const index = Store.readIndex().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          if (!index.length) {
            grid.appendChild(el("div", { class: "empty", text: "Chưa có map nào — tạo map mới để bắt đầu." }));
            return;
          }
          for (const entry of index) {
            const card = el("div", { class: "map-card" + (entry.id === E.mapId ? " current" : "") });
            const cvs = el("canvas");
            card.appendChild(cvs);

            const size = entry.mapSize ? entry.mapSize.join("×") : "?";
            card.appendChild(el("div", { class: "mc-info" },
              `<div class="mc-name">${esc(entry.name)}</div>
               <div class="mc-meta">${entry.count || 0} terrain · ${esc(size)} · ${esc(fmtTime(entry.updatedAt))}</div>`));

            if (entry.id === E.mapId) card.appendChild(el("div", { class: "mc-badge", text: "đang mở" }));

            const acts = el("div", { class: "mc-acts" });
            acts.append(
              el("button", {
                class: "icon-btn", title: "Đổi tên",
                onclick: async (e) => {
                  e.stopPropagation();
                  const r = await formBox({
                    title: "Đổi tên map", confirmText: "Lưu",
                    fields: [{ key: "name", label: "Tên map", value: entry.name }],
                  });
                  if (r && r.name.trim()) { Store.renameMap(entry.id, r.name.trim()); render(); }
                },
              }, ico("edit", "ico ico-sm")),
              el("button", {
                class: "icon-btn", title: "Nhân bản",
                onclick: (e) => { e.stopPropagation(); Store.duplicateMap(entry.id); render(); toast("Đã nhân bản map"); },
              }, ico("copy", "ico ico-sm")),
              el("button", {
                class: "icon-btn del", title: "Xoá",
                onclick: async (e) => {
                  e.stopPropagation();
                  const ok = await confirmBox({
                    title: "Xoá map?", danger: true, confirmText: "Xoá vĩnh viễn",
                    text: `Xoá “${entry.name}” khỏi trình duyệt, không khôi phục được. Nên bấm “Lưu file” trước.`,
                  });
                  if (ok) { Store.deleteMap(entry.id); render(); toast("Đã xoá map"); }
                },
              }, ico("trash", "ico ico-sm"))
            );
            card.appendChild(acts);

            card.addEventListener("click", () => { close(); Store.openMap(entry.id); });
            grid.appendChild(card);

            const rec = Store.readRecord(entry.id);
            requestAnimationFrame(() => { if (rec) drawMapThumb(cvs, rec); });
          }
        };

        body.appendChild(grid);
        render();

        // Map game đang có, xếp NGAY DƯỚI bản nháp trong cùng một màn hình.
        //
        // Trước đây danh sách này nằm ở menu chính của game, tách hẳn khỏi
        // đây — thành ra hai danh sách chứa hai tập map khác nhau, không cái
        // nào thấy cái kia, và map xoá bên này vẫn nằm bên kia. Một màn hình
        // "map" phải cho thấy mọi map, không thì nó chỉ là một nửa.
        const packMaps = Store.readPackMaps();
        if (packMaps.length) {
          body.appendChild(el("p", { class: "muted section-head", text: "Từ game — mở ra một bản sao để sửa" }));
          const packGrid = el("div", { class: "maps-grid" });
          for (const map of packMaps) {
            const card = el("div", { class: "map-card pack" });
            // Đếm theo hình SẼ MỞ RA, không phải theo `terrain`.
            //
            // Map có `authoring` mở ra ở dạng người ta vẽ, nên đọc `terrain`
            // của nó là đọc nửa còn lại: Twisted Treeline hiện "121 tường"
            // trong khi mở lên chỉ có 23. Còn map không có `authoring` thì
            // `terrain` đúng là thứ mở ra — và gộp xong sẽ ít hơn, nên câu
            // sau nói rõ điều đó thay vì hứa một con số.
            const authoredWalls =
              map.authoring && map.authoring.terrain && Array.isArray(map.authoring.terrain.wall)
                ? map.authoring.terrain.wall.length
                : null;
            const walls = authoredWalls != null
              ? authoredWalls
              : (map.terrain && map.terrain.wall ? map.terrain.wall.length : 0);
            card.appendChild(el("div", { class: "mc-info" },
              `<div class="mc-name">${esc(map.name)}</div>
               <div class="mc-meta">${walls} tường · ${esc(String(map.size || "?"))}${authoredWalls != null ? "" : " · dạng đã cắt"}</div>`));
            card.addEventListener("click", () => {
              close();
              Store.openPackMap(map.id);
              syncAll();
              requestRender();
            });
            packGrid.appendChild(card);
          }
          body.appendChild(packGrid);
        }

        foot.append(
          el("button", { class: "btn", onclick: () => { close(); Cmd.run("file.open"); } },
            `${ico("folder", "ico ico-sm")} Mở file .json`),
          el("button", { class: "btn primary", onclick: async () => { close(); await Cmd.run("map.new"); } },
            `${ico("plus", "ico ico-sm")} Map mới`)
        );
      },
    });
  }

  /* ============================== nhập JSON ============================= */

  /**
   * Hộp thoại nhập: dán JSON hoặc chọn file, xem trước nội dung đọc được,
   * rồi chọn mở thành map mới hay gộp vào map đang mở.
   */
  function importDialog(initialText) {
    return openModal({
      title: "Nhập JSON",
      wide: true,
      build: (body, foot, close) => {
        body.appendChild(el("p", { class: "muted" }, `Dán JSON vào ô dưới hoặc chọn một file <code>.json</code>.
          Nhận <code>MapGeometry</code> của moba2d, file “Lưu file” của editor,
          export MOBA2D đời trước (<code>{"wall":…}</code>), “Export raw”, mảng
          terrain trần và cả file từ bản Firebase ngày xưa.`));

        const pick = el("button", { class: "btn", style: "margin:8px 0 10px" },
          `${ico("folder", "ico ico-sm")} Chọn file .json…`);
        body.appendChild(pick);

        const ta = el("textarea", {
          class: "inp", spellcheck: "false",
          placeholder: '{"terrain":{"wall":[[{"x":0,"y":0}]],"bush":[],"water":[]},"slots":{…}}',
        });
        ta.style.height = "200px";
        // Ở đây người dùng dán vào là chính, nên cho xuống dòng để nhìn được
        // toàn bộ nội dung (ô Export thì giữ pre để copy ra đúng nguyên bản).
        ta.style.whiteSpace = "pre-wrap";
        ta.style.wordBreak = "break-all";
        body.appendChild(ta);

        const status = el("div", { class: "muted", style: "min-height:34px;padding-top:8px" });
        body.appendChild(status);

        const modeBox = el("div", { class: "seg center", style: "grid-template-columns:1fr 1fr;margin-top:2px" });
        const modes = [
          { key: "new", label: "Mở thành map mới" },
          { key: "merge", label: "Thêm vào map đang mở" },
        ];
        let mode = "new";
        for (const m of modes) {
          modeBox.appendChild(el("button", {
            "data-mode": m.key, class: m.key === mode ? "on" : "",
            onclick: () => {
              mode = m.key;
              modeBox.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
            },
          }, esc(m.label)));
        }
        body.appendChild(modeBox);

        const okBtn = el("button", { class: "btn primary", text: "Nhập" });
        okBtn.setAttribute("disabled", "");
        foot.append(el("button", { class: "btn", text: "Huỷ", onclick: () => close(false) }), okBtn);

        let doc = null;
        const FORMATS = {
          geometry: "MapGeometry của moba2d",
          game: "dữ liệu export MOBA2D đời trước",
          editor: "file map của editor",
          array: "mảng terrain trần",
        };

        const validate = () => {
          const text = ta.value.trim();
          doc = null;
          if (!text) {
            status.className = "muted";
            status.textContent = "Chưa có dữ liệu.";
            okBtn.setAttribute("disabled", "");
            return;
          }
          try {
            doc = Store.parseMapJSON(text, "Map nhập vào");
            status.className = "muted";
            status.style.color = "var(--accent)";
            status.innerHTML =
              `Nhận ra ${esc(FORMATS[doc.format] || doc.format)} — <b>${doc.terrains.length} terrain</b>` +
              (Store.describe(doc.terrains) ? ` (${esc(Store.describe(doc.terrains))})` : "") +
              (doc.format === "game" || doc.format === "geometry"
                ? `<div style="color:var(--tx-3);margin-top:4px">Lưu ý: dữ liệu đã export bị cắt sẵn thành mảnh lồi, nên polygon lõm ban đầu sẽ về thành nhiều mảnh rời. Kích thước map: ${doc.mapSize.join("×")}${doc.meta ? ` · phe ${doc.meta.factions ? doc.meta.factions.join(", ") : "?"}` : ""}.</div>`
                : "");
            okBtn.removeAttribute("disabled");
          } catch (e) {
            status.className = "muted";
            status.style.color = "var(--danger)";
            status.textContent = String(e.message || e);
            okBtn.setAttribute("disabled", "");
          }
        };

        let timer = 0;
        ta.addEventListener("input", () => {
          clearTimeout(timer);
          timer = setTimeout(validate, 220) as unknown as number;
        });

        pick.onclick = () => {
          const input = el("input", { type: "file", accept: ".json,application/json", style: "display:none" });
          document.body.appendChild(input);
          input.addEventListener("change", () => {
            const f = input.files && input.files[0];
            input.remove();
            if (!f) return;
            Store.readFileText(f).then((text) => {
              ta.value = text;
              validate();
            }).catch(() => UI.alert({ icon: "err", title: "Lỗi", text: "Không đọc được file." }));
          });
          input.click();
        };

        okBtn.onclick = () => {
          if (!doc) return;
          if (mode === "merge" && !E.mapId) {
            status.style.color = "var(--danger)";
            status.textContent = "Chưa mở map nào để gộp vào.";
            return;
          }
          close(true);
          Store.importParsed(doc, mode);
        };

        if (initialText) { ta.value = initialText; validate(); }
        else validate();
      },
    });
  }

  /* ============================= chơi thử ============================== */

  /**
   * Đẩy map đang mở sang game rồi vào trận luôn.
   *
   * Thay cho vòng: export JSON → nhét vào pack → serve pack → dán link →
   * cài → tìm map trong picker. Không bước nào trong đó nói gì về cái map cả;
   * chúng là cái giá phải trả cho việc map đến từ NƠI KHÁC. Map vẽ ngay trên
   * origin này thì chưa từng đi đâu.
   *
   * Chặn ở lỗi schema chứ không để game tự từ chối: `installData` bên kia
   * cũng soi đúng bộ luật này (`content/validate.ts`), nhưng nó soi sau khi
   * người dùng đã rời khỏi editor — nghe "map bị loại" lúc đang đứng ở màn
   * hình menu thì không sửa được gì. Cảnh báo thì cho đi tiếp: map thiếu lane
   * vẫn chạy được, chỉ là không có lính.
   */
  async function playtest() {
    const errs = Store.validate().filter((i) => i.level === "error");
    if (errs.length) {
      await alertBox({
        icon: "err",
        title: "Map chưa chơi được",
        html: `<p>Game sẽ từ chối map này. Sửa xong mấy chỗ sau rồi bấm lại:</p>` +
          `<ul style="margin:8px 0 0 18px;color:var(--tx-2);font-size:13px">` +
          errs.slice(0, 8).map((e) => `<li style="margin-top:4px">${esc(e.text)}</li>`).join("") +
          (errs.length > 8 ? `<li style="margin-top:4px">… và ${errs.length - 8} lỗi nữa</li>` : "") +
          `</ul>`,
      });
      return;
    }

    let id;
    try {
      id = Store.publishLocal();
    } catch (e) {
      await alertBox({
        icon: "err",
        title: "Không đẩy được map sang game",
        text: "Bộ nhớ trình duyệt đã đầy hoặc đang bị chặn. Xoá bớt ảnh nền của "
          + "các map cũ rồi thử lại — ảnh nền là thứ chiếm chỗ nhiều nhất.",
      });
      return;
    }

    // Ghi nốt map vào kho riêng của editor: bấm chơi thử là một mốc, và tab
    // này có thể bị đóng bất cứ lúc nào sau đây.
    Store.saveNow();

    // Editor nằm ở `<game>/map-editor/`, nên `../` là game. Đường dẫn tương đối
    // vì game được phục vụ từ subpath trên mọi host nó từng ở.
    const href = "../?playtest=local:" + encodeURIComponent(id);

    // TAB MỚI, không phải điều hướng tại chỗ.
    //
    // `History` sống hoàn toàn trong bộ nhớ, nên rời trang là mất sạch undo:
    // đi chơi thử rồi quay lại, map vẫn còn (autosave) nhưng mọi bước lùi thì
    // không. Với map mở từ game, cái mất đó nặng hơn — bước gộp tự động là
    // một bước undo, và qua một vòng chơi thử thì nó thành vĩnh viễn.
    //
    // Mở tab mới thì document này không bị huỷ, nên lịch sử còn nguyên và
    // người ta sửa tiếp được ngay trong lúc tab game vẫn đang mở.
    const opened = window.open(href, "moba2d-playtest");
    if (opened) {
      opened.focus();
      toast("Đang mở game ở tab mới — tab này giữ nguyên lịch sử sửa");
      return;
    }
    // Trình duyệt chặn popup (hiếm, vì đây là cú bấm của người dùng, nhưng
    // một số cấu hình vẫn chặn). Đi tại chỗ còn hơn không đi được — mất undo
    // vẫn hơn là bấm "Chơi thử" mà không có gì xảy ra.
    toast("Trình duyệt chặn tab mới — mở tại chỗ, lịch sử sửa sẽ mất", "warn");
    window.location.href = href;
  }

  /* ========================= export cho moba2d ========================== */

  /**
   * Ba dạng đầu ra của cùng một map: JSON thuần để dán vào đâu cũng được, và
   * hai module TypeScript dán thẳng vào pack. Kết quả kiểm tra hiện ngay trên
   * đầu vì đây là lúc cuối cùng còn kịp sửa.
   */
  function exportMoba2d() {
    return openModal({
      title: "Export cho moba2d",
      wide: true,
      build: (body, foot, close) => {
        const issues = Store.validate();
        const errs = issues.filter((i) => i.level === "error");

        if (issues.length) {
          const box = el("div", {
            style: `border:1px solid ${errs.length ? "rgba(242,85,90,.35)" : "rgba(200,170,110,.35)"};
                    background:${errs.length ? "var(--danger-fade)" : "rgba(200,170,110,.10)"};
                    border-radius:var(--r);padding:9px 11px;margin-bottom:12px;font-size:12px`,
          });
          box.innerHTML =
            `<b style="color:${errs.length ? "var(--danger)" : "var(--gold)"}">` +
            `${errs.length} lỗi · ${issues.length - errs.length} cảnh báo</b>` +
            issues.slice(0, 6).map((i) =>
              `<div style="color:var(--tx-2);margin-top:4px">• ${esc(i.text)}</div>`).join("") +
            (issues.length > 6 ? `<div style="color:var(--tx-3);margin-top:4px">… và ${issues.length - 6} mục nữa</div>` : "");
          body.appendChild(box);
        } else {
          body.appendChild(el("p", {
            style: "color:var(--accent);margin-bottom:12px",
          }, `${ico("check", "ico ico-sm")} Map hợp lệ với schema moba2d.`));
        }

        const sum = Store.mapSummary();
        const base = Store.camel(sum.id);
        const VIEWS = [
          { key: "json", label: "MapGeometry (JSON)", file: `${sum.id}.json`, make: () => Store.exportMapGeometry() },
          { key: "geo", label: `${base}Geometry.ts`, file: `${base}Geometry.ts`, make: () => Store.exportGeometryTS() },
          { key: "map", label: `${base}Map.ts`, file: `${base}.ts`, make: () => Store.exportMapTS() },
        ];
        let view = VIEWS[0];

        const tabs = el("div", { class: "seg center", style: "grid-template-columns:repeat(3,1fr);margin-bottom:10px" });
        const ta = el("textarea", { class: "inp", spellcheck: "false", readonly: "" });
        ta.style.height = "260px";
        const meta = el("p", { class: "muted", style: "margin:8px 0 0" });

        const paint = () => {
          ta.value = view.make();
          tabs.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === view.key));
          const g = Store.mapGeometry();
          const n = TERRAIN_KINDS.reduce((a, k) => a + g.terrain[k].length, 0);
          meta.textContent =
            `${sum.id} · ${sum.size}×${sum.size} · ${sum.factions.map((f) => f.id).join(", ")} — ` +
            `${n} mảnh lồi, ${g.slots.spawn.length + g.slots.structure.length + g.slots.minion.length + g.slots.neutral.length} slot, ` +
            `${(g.lanes || []).length} lane · ${ta.value.length.toLocaleString("vi-VN")} ký tự`;
        };

        for (const v of VIEWS) {
          tabs.appendChild(el("button", {
            "data-v": v.key, onclick: () => { view = v; paint(); },
          }, esc(v.label)));
        }
        body.append(tabs, ta, meta);
        paint();

        foot.append(
          el("button", { class: "btn", text: "Đóng", onclick: () => close(false) }),
          el("button", {
            class: "btn", onclick: () => Store.download(view.file, ta.value,
              view.key === "json" ? "application/json" : "text/plain"),
          }, `${ico("save", "ico ico-sm")} Tải ${view.file}`),
          el("button", {
            class: "btn primary", text: "Copy",
            onclick: async () => {
              try { await navigator.clipboard.writeText(ta.value); toast("Đã copy"); }
              catch (e) { ta.removeAttribute("readonly"); ta.select(); document.execCommand("copy"); toast("Đã copy"); }
            },
          })
        );
      },
    });
  }

  /* ============================== phím tắt ============================== */

  function shortcutsModal() {
    const rows = [
      ["Chọn / kéo đối tượng", ["V"]],
      ["Công cụ quét chọn vùng", ["M"]],
      ["Công cụ kéo khung nhìn", ["H", "Space"]],
      ["Sửa đỉnh (chọn nhiều dot)", ["E", "Nháy đúp"]],
      ["Vẽ polygon tự do", ["P"]],
      ["Vẽ lane (đường gấp khúc)", ["L"]],
      ["Thêm polygon nhanh", ["N"]],
      ["Copy / Cắt / Dán", ["Ctrl+C", "Ctrl+X", "Ctrl+V"]],
      ["Dán tại chỗ (giữ nguyên toạ độ)", ["Ctrl+Shift+V"]],
      ["Nhân bản", ["Ctrl", "D"]],
      ["Xoá", ["Del"]],
      ["Chọn tất cả", ["Ctrl", "A"]],
      ["Bỏ chọn / huỷ thao tác", ["Esc"]],
      ["Hoàn tác / Làm lại", ["Ctrl", "Z"]],
      ["Thêm đỉnh tại con trỏ", ["A"]],
      ["Xoá đỉnh dưới con trỏ", ["D"]],
      ["Chèn đỉnh lên cạnh", ["Nháy đúp"]],
      ["Quét chọn nhiều đỉnh", ["E", "rồi kéo"]],
      ["Xoá các đỉnh đang chọn", ["Del"]],
      ["Lật ngang / lật dọc", ["Shift+H", "Shift+V"]],
      ["Căn tâm", ["Shift+C"]],
      ["Dịch 1px / 10px", ["←↑→↓", "Shift"]],
      ["Vừa màn hình", ["F"]],
      ["Phóng to / thu nhỏ", ["+", "−"]],
      ["Bật tắt lưới / hút lưới", ["G", "Shift+G"]],
      ["Đóng mở bảng thuộc tính", ["Tab"]],
      ["Danh sách map", ["Ctrl", "M"]],
      ["Lưu file .json", ["Ctrl", "S"]],
      ["Nhập JSON (dán hoặc file)", ["Ctrl", "I"]],
      ["Export cho moba2d", ["Ctrl", "E"]],
    ];
    return openModal({
      title: "Phím tắt & cách dùng",
      wide: true,
      build: (body, foot, close) => {
        body.innerHTML =
          `<p class="muted" style="margin-bottom:12px">
             Chuột: cuộn để zoom <b>ngay tại con trỏ</b>, giữ chuột giữa hoặc phím Space để kéo khung nhìn,
             kéo trên nền trống để quét chọn nhiều polygon.<br>
             Touchpad: hai ngón để cuộn ngang/dọc, chụm để zoom.<br>
             Cảm ứng: một ngón kéo để di chuyển, hai ngón để chụm zoom, chạm để chọn.
           </p>` +
          `<div class="keys">` +
          rows.map(([label, keys]) =>
            `<div class="k"><span>${esc(label)}</span><em>${[keys].flat().map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</em></div>`
          ).join("") +
          `</div>`;
        foot.appendChild(el("button", { class: "btn primary", text: "Đóng", onclick: () => close(true) }));
      },
    });
  }

  return {
    ico, el, esc, toast,
    alert: alertBox, confirm: confirmBox, form: formBox, text: textBox, suggest,
    sheet, closeSheet,
    buildToolbar, syncToolbar, buildInspector,
    syncSelection, syncLayers, syncView, syncMap, syncMapName, syncHistory,
    syncFactions, syncCheck, scheduleCheck,
    syncAll, syncStatus, syncInspectorOpen, setSaveState,
    mapMenu, shortcutsModal, drawMapThumb, importDialog, exportMoba2d, playtest,
  };
})();
