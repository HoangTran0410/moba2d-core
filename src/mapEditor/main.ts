/* =========================================================================
   main.js — khởi động và nối các mảnh lại với nhau.
   ========================================================================= */

import { Cmd } from './commands';
import { Input } from './input';
import { requestRender } from './frame';
import { Renderer } from './render';
import { E } from './state';
import { Store } from './storage';
import { UI } from './ui';

(function boot() {
  function start() {
    Store.loadPrefs();

    Renderer.init();
    UI.buildToolbar();
    UI.buildInspector();
    Input.init();

    // Mọi nút có data-cmd đều chạy qua sổ đăng ký lệnh — không còn onclick
    // rải rác trong HTML như bản cũ.
    document.addEventListener("click", (e) => {
      const btn = (e.target as Element | null)?.closest("[data-cmd]") as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      Cmd.run(btn.dataset.cmd, btn);
    });

    // Ảnh tướng mẫu để ước lượng kích thước — tải nền, không chặn gì cả.
    Store.loadImage("asset/dummy.png")
      .then((img) => { E.images.dummy = img; requestRender(); })
      .catch(() => { });

    openInitialMap();

    // Không để mất dữ liệu khi đóng tab hay chuyển sang app khác.
    const flush = () => Store.flush();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });

    // Chặn zoom cả trang khi người dùng chụm/ctrl+lăn ngoài canvas.
    document.addEventListener("wheel", (e) => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });

    UI.syncAll();
    requestRender();

    // Sau khi màn hình đã dựng xong, không phải trong `openInitialMap`: gợi ý
    // là một thanh trong UI, và UI lúc đó chưa tồn tại.
    Cmd.offerMerge();
  }

  /** Mở thẳng map đang làm dở — khỏi bắt người dùng qua màn hình chọn map. */
  function openInitialMap() {
    Store.migrateLegacy();

    const index = Store.readIndex();
    const lastId = localStorage.getItem(Store.CURRENT_KEY);

    if (lastId && index.some((m) => m.id === lastId) && Store.openMap(lastId)) return;

    if (index.length) {
      const newest = index.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      if (Store.openMap(newest.id)) return;
    }

    const id = Store.createMap("Map mới", [6400, 6400], []);
    if (id) {
      Store.openMap(id);
      UI.toast("Đã tạo map trống — bấm N để thêm polygon đầu tiên");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
