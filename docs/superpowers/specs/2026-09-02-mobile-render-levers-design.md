# Mượt hơn trên điện thoại — bốn cần gạt nhỏ

Ngày 2026-09-02. Trạng thái: đã duyệt chung trong batch, làm thẳng. Mục 16–19
của danh sách cải thiện.

## Điều đã biết trước khi làm

- Fog composite là chi phí vẽ lớn nhất mỗi frame: ba lượt toàn màn hình (fill
  `copy` lên overlay, `erase` từng polygon, blit `image()` về), profile đổ 82%
  drawImage vào blit. Buffer *nhỏ hơn* đã đo là chậm hơn (constructor FogOfWar).
- Tier chất lượng chỉ có một cần gạt: particle.
- Catch-up 3 bước `fixedUpdate` trong một callback timer — quá nặng cho phone
  vừa hitch.
- FpsOverlay chỉ in FPS, không nói loop nào chậm.

## Bốn cần gạt

1. **Fog vẽ thẳng** (`FogOfWar.drawDirect`): khi Thấp, hoặc `auto` đang stress,
   bỏ overlay, một `fill('nonzero')` của hình chữ nhật viewport trừ mọi
   polygon tầm nhìn; mọi lỗ đo `signedArea` và đảo chiều để ngược với hình chữ
   nhật. Đo: **3.2× rẻ hơn mỗi lượt fog** (0.058ms so với 0.18ms, 844×390, CPU
   throttle 4×, 9 polygon, median của 5 vòng xen kẽ theo luật TRAPS). Đổi lại
   mất mép mềm — nên chỉ ở tier stress.
2. **Trail** thu về một nét khi stress (`ObjectManager.draw`, cùng cờ với
   particle). Hình dáng là trang trí, hướng thì không.
3. **Trần catch-up trên cảm ứng** = 2 (`TOUCH_MAX_CATCHUP_STEPS`), desktop giữ 3.
   `stepsToRun(elapsed, interval, maxSteps)`; đồng hồ vẫn tiến qua bước bị bỏ.
4. **FpsOverlay tách update/draw**: `FpsMeter.sampleUpdate/sampleDraw` (EMA cùng
   α, công bố cùng cửa sổ 500ms), `Game.update` và `Game.draw` đo bằng
   `performance.now`. Dòng hiện `58 FPS · min 41 · upd 2.3ms · draw 6.1ms`.

## Không làm

Half-res fog (đã đo chậm hơn), WebGL/OffscreenCanvas (quá lớn cho một mục),
đổi độ phân giải terrain (fill-bound, cache không giúp — TRAPS).
