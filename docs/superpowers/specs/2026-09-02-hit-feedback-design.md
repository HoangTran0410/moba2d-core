# Cảm giác trúng đòn — thiết kế

Ngày 2026-09-02. Trạng thái: đã duyệt hướng A, làm thẳng không qua plan riêng.

## Vấn đề

Lớp *thông tin* của combat đã đầy đủ: số damage theo màu loại, death recap,
vòng tầm, telegraph. Lớp *cảm giác* thì gần như trống — một cú đánh trúng
champion/minion/monster chỉ nổi một con số cỡ 20px, không flash, không rung,
crit trông y như đòn thường. Turret là unit duy nhất có `_hitFlash`.

Ba thứ, một cửa:

1. **Flash trúng đòn** trên mọi `AttackableUnit`.
2. **Rung camera nhẹ** khi *người chơi* bị đánh đau, chết, hoặc hạ gục.
3. **Số damage có trọng lượng**: cỡ chữ theo tỉ lệ máu tối đa, crit to hơn và
   có nhịp "punch".

## Một cửa: `AttackableUnit.presentHit`

```ts
interface HitPresentation { amount: number; type: DamageType; crit?: boolean }
presentHit(hit: HitPresentation): void
```

Nổi số, bật flash, xin camera rung nếu nạn nhân là `game.player`, và vẽ tia
lửa crit (chuyển từ `BasicAttack.showCritSpark` sang đây, chủ là nạn nhân).

- **Host / offline**: `takeDamage` gọi nó đúng chỗ đang gọi `CombatText.show`.
- **Client LAN**: `takeDamage` bị chặn (`isNetClient`), nên handler `dmg` trong
  `ClientSession` gọi nó — chỗ hiện đang gọi `CombatText.show`. Sự kiện `dmg`
  thêm cờ `c?: 1` cho crit, vì client không có cách nào biết crit.

`takeDamage` nhận tham số thứ năm tuỳ chọn `presentation?: { crit?: boolean }`.
Chỉ để trình diễn, không đụng số học. `takeDamageSignature.test.ts` nâng từ
bốn lên năm tên bắt buộc, và mọi `super.takeDamage` phải forward đủ năm.
`DamageNumberEvent` mang thêm `crit?`.

## Luật số học: `src/game/render/hitFeedback.ts`

Thuần, không p5. Đầu vào là `fraction = amount / maxHealth` (kẹp 0..1) và cờ crit.

| Hàm | Ý nghĩa |
|---|---|
| `hitFlashMs(fraction, crit)` | 120ms nền, lên 200ms ở ≥15% máu; crit +40 |
| `damageTextScale(fraction, crit)` | 1.0 → 1.5 ở ≥25% máu; crit ×1.3; trần 1.9 |
| `hitShakeTrauma(fraction, crit)` | 0 dưới 5% máu, tuyến tính tới 0.45 ở 30%; crit +0.1 |
| `DEATH_SHAKE_TRAUMA`, `KILL_SHAKE_TRAUMA` | 0.7 và 0.3 |

## Flash

`hitFlashMs`/`hitFlashTotalMs` trên `AttackableUnit`, giảm theo `deltaTime`
trong `update()` như `_recentAttackerTtl` (đóng băng khi pause — đúng ý).
Vẽ bằng `drawHitFlash(x, y, size)`: một đĩa trắng phủ lên thân, alpha
`(còn lại / tổng) × 150`, gọi trong `drawAvatar` sau `drawBody` và trước vòng
đội, nên Champion/Monster/đơn vị sprite nhận tự động; `Minion.draw` gọi nó trong
khung quay của mình. Trắng, không màu loại: màu loại chỉ sống trong chữ
(`VFX_STANDARD.md` luật 1). Vẽ trong `draw()` của unit nên tự chịu fog.
Turret giữ vòng đỏ riêng của nó.

## Rung camera

Mô hình *trauma*: `Camera.shake(t)` cộng dồn kẹp 1; `advanceShake(deltaMs)`
chạy mỗi frame **vẽ** với render `deltaTime` (hiệu ứng thuần hình ảnh, không
phải sim — đúng cái mà §2.2 của render-interpolation cấm cho *lerp camera*,
nhưng không cấm cho một offset chỉ tồn tại lúc vẽ), trauma giảm về 0 trong
~400ms, offset = `trauma² × 10px` đổi ra đơn vị thế giới bằng `constantSize`
nên không lệ thuộc zoom, hướng ngẫu nhiên mỗi frame.

Offset cộng vào `position` **trong `applyRenderOrigin`**, không phải trong
`push()`: fog, minimap và mọi thứ đọc `camera.position` lúc vẽ phải rung cùng
thế giới, nếu không mép fog lệch khỏi thân người. `Game.draw` vì thế luôn
substitute/restore, không chỉ khi `alpha < 1`. `restoreRenderOrigin` trả vị
trí thật, nên `fixedUpdate` và `screenToWorld` không bao giờ thấy rung.

Kích: người chơi bị đánh (`hitShakeTrauma`), người chơi chết
(`DEATH_SHAKE_TRAUMA`, trong `Champion.die` khi là player), người chơi hạ gục
tướng (`KILL_SHAKE_TRAUMA`, cùng chỗ tính kill credit). Không rung cho việc
của người khác.

Toggle "Rung màn hình" trong Settings › Hiển thị. Pref `moba2d.screenShake`
trong `renderPreferences.ts`; mặc định bật, trừ khi
`prefers-reduced-motion: reduce`. Phải phục vụ qua cả hai `MatchConfigSource`
(`screenShake` / `setScreenShake`) — contract test mở rộng theo.

## Số damage

`CombatText.show(owner, kind, amount, color, options?: { crit?: boolean })`.
Khoá merge không đổi, nên `COMBAT_TEXT_PERF.md` vẫn đúng; đổi là *một object
nói hai con số*:

- **Headline** (`recent`, vẽ qua `text`): tổng các cú trong cùng một cụm
  `HEADLINE_WINDOW_MS` = 150ms tính từ cú đầu của cụm; cú tới sau đó mở cụm
  mới và headline *thay* chứ không cộng. Cỡ chữ và crit theo headline:
  `damageTextScale(recent / maxHealth, critCủaCụm)`, viền 3 khi crit. Chỉ kind
  `'damage'` scale theo máu.
- **Tổng** (`amount`, vẽ qua `totalText`): mọi thứ từ lúc text sinh ra, vẽ
  nhỏ 0.6×, mờ 0.75, phía trên headline, tiền tố `∑`, và chỉ từ cụm thứ hai
  trở đi (`showsTotal`). Text vẫn tắt sau 1s không bị đánh, nên "khoảng" là
  chính đợt combat.

`punchMs` = 120 đặt lại mỗi lần tạo/merge, `draw` phóng headline
`1 + 0.35 × (punch/120)`; dòng tổng không punch, không viền crit.

Lý do không chọn "crit tách merge" hay "cửa sổ merge ngắn": cái đầu vẫn mất
"cú vừa rồi" cho đòn thường, cái sau tăng số object lên tới 5 mỗi nạn nhân
mỗi loại dưới DoT, đúng vấn đề perf mà merge sinh ra để giải.

## Test

- `tests/game/render/hitFeedback.test.ts`: bảng số cho bốn hàm.
- `tests/game/map/Camera.test.ts`: shake cộng dồn kẹp 1, tắt dần, tắt theo
  toggle, offset vào `applyRenderOrigin` và ra khỏi `restoreRenderOrigin`.
- `tests/game/helpers/CombatText.test.ts`: cỡ theo tỉ lệ, crit dính khi merge.
- `tests/game/combat/damageNumberEvent.test.ts`: `crit` đi qua event.
- `tests/game/attackableUnits/hitFlash.test.ts`: `presentHit` bật flash, tắt
  dần, `drawAvatar` vẽ đĩa khi còn flash.
- `tests/game/net/netProtocol.test.ts`: `dmg` round-trip với `c`.
- `tests/game/config/matchConfigSource.contract.test.ts`: `screenShake` ở cả
  hai nguồn.
- `takeDamageSignature.test.ts`: năm tên.

## Ngoài phạm vi

Âm thanh (đã gác), killfeed/streak, knockback micro-offset, đổi màu chữ crit
(cấm bởi luật màu).
