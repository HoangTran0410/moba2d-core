# Chế độ chơi là bó knob, và camera khi chết

**Ngày:** 2026-09-02 · **Trạng thái:** đã làm

Hai mục còn lại trong danh sách 19 ý tưởng của phiên này mà không đụng tới
điều kiện thắng (người chơi muốn game vẫn là phòng tập: mục 8 và mục 11).

## 1. Chế độ chơi (`config/matchModes.ts`)

### Vấn đề
URF đã có (`manaFree` + CDR), "không rừng" đã có, số bot đã có. Nhưng mỗi
buổi tập muốn một kiểu phòng khác lại phải kéo bốn control trên hai tab.
Không có tên cho "tối nay chơi kiểu gì".

### Quyết định
Một chế độ là **macro rồi overlay**, không phải lớp mới:

- **Macro.** `rules`, `world`, `bots` của chế độ được ghi vào chính các knob
  hiện có. Ngoài trận: `applyMode(config, mode)` rồi sanitize. Trong trận:
  `MatchDirector.setMode(id)` seed rules (áp dụng ngay ở lần cast sau), gạt
  rừng/lính qua setter cũ, và **đổi hình đội** qua đúng đường roster tab đã
  đi (`removeBot` từ cuối, `addBotLoaded` với loadout + phe lưu ở slot đó).
  Sau đó các field là sự thật; id chế độ chỉ còn là nhãn.
- **Overlay.** Thứ không knob nào giữ được đi theo id khi boot:
  `MapTuning` của chế độ được `mergeTuning` phủ lên `map.tuning` thành
  `Game.mapTuning` (mọi reader đã resolve `game.mapTuning` lúc cần nên không
  thêm seam), và `allRandom` được `planMatchKits` đọc để roll tướng cho cả
  bàn (giữ summoner). Hai thứ này chờ trận sau, giống chọn bản đồ, và tab nói
  vậy bằng note vàng kèm nút "Chơi lại" hai bước.
- **Nhãn thật thà.** Chip vẫn sáng khi người chơi kéo CDR đi chỗ khác — id là
  fact đã lưu — nhưng `modeDrift` so knob hiện tại với knob chế độ khai và tab
  thêm "· đã chỉnh". Bấm lại chip đang sáng khi đã drift = "đưa URF về".

### Bảng
Cổ điển (mặc định, 3 bot) · Siêu tốc (vàng 2000, +6/s, hồi sinh 3s) · URF
(CDR 80, không mana, tốc chạy ×1.15, +4 vàng/s) · Loạn đấu (tướng ngẫu
nhiên, **không hồi thành**, không rừng, vàng 1400, hồi sinh 8s) · Tay đôi
(1 bot) · Đại chiến (9 bot = 5v5 vì `initialBotTeam` xen kẽ Đỏ trước).

Mọi chế độ khai **đủ** `rules` và `world` (không patch): "URF nhưng giữ luật
hồi thành của chế độ trước" không phải một trạng thái ai muốn.

### Hai đội phải đều (sửa sau báo lỗi 7 chọi 3)
Bản đầu, bot thêm giữa trận lấy phe từ slot đã lưu (`stored.ai.botTeams[i]`).
Slot quá số bot đang chạy giữ nguyên thứ những buổi trước để lại, nên "Đại
chiến" ra 7 chọi 3. Chế độ hứa một hình đội thì phải tự chia:
- Ngoài trận: `balancedBotTeams(playerTeam, count, current)` chia `count`
  slot đầu xen kẽ, bắt đầu từ phe **đối diện** người chơi (9 bot cạnh người
  chơi Xanh = 5 Đỏ 4 Xanh; 1 bot là đối thủ, không phải đồng đội). Slot sau
  `count` giữ nguyên.
- Trong trận: bot đến lấy phe từ `teamForAddedBot` (phe ít hơn), rồi
  `evenOutSides` dời bot từ phe đông sang phe ít cho tới khi lệch ≤ 1, dời từ
  cuối roster để bot đầu (đã tuỳ chỉnh) giữ phe khi có thể. Đây là lý do Tay
  đôi từ phòng 3 bot ra đúng một đối thủ chứ không phải một đồng đội.

### Luật mới: `rules.recall`
Loạn đấu cần một luật thật: không có đường về nhà thì chết là cách duy nhất
tới shop. `MatchRulesConfig.recall` (mặc định true, blob cũ → true),
`MatchRules.recall`. Đọc lúc bấm như CDR/URF: `Recall.isCastableNow`,
`Game.recall()` (chặn cả net client để không gửi lệnh host sẽ từ chối),
`BotBrain.manageRecall` (bot RECOVER không đứng bấm chiêu bị từ chối),
`buildRecall` và `touchRecallView` trả null → nút biến mất thay vì xám.

### Dây mạng
`hello.rules.recall?` và `hello.mode?` (thiếu = on / classic). Client đặt
`mode` lên `MatchPlan` để `Game` phủ cùng tuning lên cùng bản đồ — số
hồi sinh trên bảng điểm, vàng ở shop là phòng đang vào chứ không phải config
của máy mình. Đổi luật giữa trận vẫn chưa qua dây (như CDR trước giờ).

### Không làm
ARAM một lane: không pack nào có bản đồ một lane, và core không được gọi tên
bản đồ của pack. "Loạn đấu" là phiên bản thật thà của ý đó. Tay đôi không ép
bot cùng lane; độ khó bot để roster tab quyết.

## 2. Camera khi chết (`render/deathCamera.ts`)

### Vấn đề
`camera.target = player.position` đặt một lần lúc boot; chết là ngồi nhìn xác
5s tới 60s (nếu bản đồ có `reviveCurve`), khúc duy nhất trong trận không có
gì để làm lại nhìn vào chỗ duy nhất không có gì xảy ra.

### Quyết định
- `DeathCamera<T>` là máy trạng thái thuần trên context 5 hàm (không biết
  `Game`, `Camera`, `Champion`), cùng khuôn với `MatchAnnouncer` vì không có
  `Game` headless để test.
- Nằm lại xác `DEATH_CAMERA_LINGER_MS`=1500 (để rung chết và recap kịp
  đến), rồi bám **đồng minh đang đánh** (dấu `lastCombatMs` mới, đóng ở
  `takeDamage` cho cả hai bên, cửa sổ 4s, gần nhất thắng), không ai đánh thì
  **gần xác nhất**. Đổi khi người được xem chết; về người chơi đúng tick sống
  lại; không ai để xem thì để yên xác (không "follow null" vô nghĩa).
- `next()` xoay theo thứ tự roster (không theo khoảng cách để không nhảy qua
  lại giữa hai người gần nhất); bấm sớm = bỏ qua linger.
- **Tôn trọng free camera:** `Game.followForDeathCamera` không đụng khi
  `camera.target === null` (Space).
- HUD: `HudState.spectating` (tên), `SpectateBar.vue` đáy giữa (desktop trên
  thanh chiêu, touch sát đáy) gồm đếm ngược hồi sinh + nút tên đồng minh
  (bấm = người tiếp); `HudInteractions.spectateNext`. Thế giới xám bằng
  `#game-scene.dead-view canvas { filter: grayscale(.8) brightness(.85) }`
  — chỉ canvas, HUD giữ màu để pill đọc là "đang xem" chứ không phải màn
  hình hỏng. Class gạt từ `InGameHUD.vue`, gỡ khi unmount. **Chỉ desktop:**
  người chơi báo lần chết đầu trên điện thoại bị giật — filter trên canvas
  toàn màn hình bắt GPU biên dịch shader và tách layer lần đầu, rồi lọc lại
  mỗi frame suốt lúc chết. Cảm ứng dùng `.dead-tint`: một quad mờ tối phủ
  canvas, dưới HUD, fade bằng opacity qua `<Transition>`. Tối đi thay vì xám,
  đó là cái đổi.

### Bẫy đã gặp
Test `DeathCamera` phải tick một lần lúc chết trước khi nhảy thời gian:
`deathAtMs` được ghi ở tick chết đầu tiên, không phải lúc `isDead` đổi.

## Kiểm chứng
`matchModes.test.ts` (bảng, applyMode, drift, describe, mergeTuning kể cả
nested và thay roster lính nguyên khối, tuning mỗi chế độ qua
`checkMapTuning`), contract `mode` cho cả hai source (ghi luật, đổi hình
đội 1→3→1, reset về classic), `netClientMatchSettings` từ chối `setMode`,
`recallRule.test.ts`, `hudSpectate.test.ts` (kể cả nút recall biến mất),
`preset.modes.test.ts` (allRandom giữ summoner, kit tự ghép thành tướng),
`modeWire.test.ts`, `deathCamera.test.ts` (13 test).
