# Killfeed, chuỗi hạ gục, và haptics — thiết kế

Ngày 2026-09-02. Trạng thái: đã duyệt chung ("làm tiếp những thứ khác"), làm thẳng.

Hai mục kế tiếp trong danh sách cải thiện cảm giác combat, sau
`2026-09-02-hit-feedback-design.md`. Cả hai đi qua cửa đã mở ở đó.

## Haptics

Một số trauma duy nhất điều khiển cả camera và tay: `feel(game, kind, trauma)`
trong `AttackableUnit` gọi `camera.shake(trauma)` rồi `feelHaptic(kind, trauma)`
(`src/game/input/haptics.ts`). Ba hình dạng ngón tay phân biệt được:

| Sự kiện | Rung |
|---|---|
| `hit` | một nhịp, `round(60ms × trauma/0.7)`, im lặng dưới trauma 0.1 |
| `kill` | hai nhịp ngắn `[15, 40, 15]` |
| `death` | một nhịp dài `[90, 60, 140]` |

Nút cảm ứng vẫn rung 10ms nhưng đi qua cùng `vibrate()`, nên toggle "Rung
máy" (pref `moba2d.haptics` trong `touchPreferences.ts`, đọc lúc rung, không
cần hàng trong `MatchConfigSource`) che cả nó. Hàng settings chỉ hiện khi
`navigator.vibrate` tồn tại — iOS Safari không có.

## Killfeed

### Cái thiếu

`MatchTally` cố tình là tổng cả trận, không reset khi chết. Nên "chuỗi", "song
sát", "máu đầu", "chấm dứt chuỗi" không tồn tại — và năm giây sau một cú hạ
gục hoàn toàn im lặng. `EventType.ON_DIE` được khai báo từ lâu mà chưa ai emit.

### `ON_DIE` được emit thật

`die()` emit `UnitDeathEvent { unit, killer?, credit }` **một lần, ở
transition, sau cùng**: sau tally, bounty, assist, và sau khi `deathData` đã
đặt, nên listener thấy một xác (`isDead` true) với kill đã được tính. `killer`
là bất cứ thứ gì ra đòn cuối (tướng, trụ, lính) hoặc absent; `credit` là
`killCredit` của nạn nhân để phân biệt tướng chết với lính chết mà không cần
biết class.

### `MatchAnnouncer` (`src/game/combat/Announcer.ts`)

Sống trên `Game.announcer`, nghe `ON_DIE`, giữ:

- `runs: WeakMap<unit, { streak, multi, lastKillAtMs }>` — streak reset khi
  chủ chết (kể cả do trụ); multi là số kill cách nhau ≤ 10s.
- `firstBloodTaken` — chỉ kill tướng-hạ-tướng mới là máu đầu; trụ không.
- `rows: Announcement[]` — một dòng cho mỗi **tướng** chết, có `killer|null`,
  `victim`, `firstBlood`, `multi`, `streak`, `shutdown` (streak nạn nhân vừa
  mất nếu ≥ 3), và tham chiếu unit local để tính "của mình".

`recent(now)`: dòng ≤ 6s, tối đa 3 (phone ẩn dòng thứ ba bằng CSS, còn 2).
`banner(now, player)`: dòng mới nhất ≤ 2.2s mà `deservesBanner`: của mình
luôn; của người khác chỉ khi First Blood, từ Triple Kill, Shutdown, hoặc
chuỗi lên bậc mới (3 đến 8).

**Ngân sách che màn hình** (góp ý thứ hai của user: "chết nhiều là UI che hết
màn hình"): feed không nhận chạm (`pointer-events: none`) nên chỉ che tầm
nhìn; giới hạn là chiều cao — 3 dòng gọn trên monitor, 2 trên phone, nền
trong ~65-80%, sống 6s, banner 2.2s không nhấp nháy. Số lần chết không làm
stack cao hơn, chỉ làm dòng thay nhau nhanh hơn.

Tên callout dùng tiếng Anh quen tai (yêu cầu của user sau khi nghe "Tam
sát"): First Blood, Double / Triple / Quadra / Penta Kill, Shutdown, và chuỗi
theo bậc Killing Spree (3) → Rampage → Unstoppable → Dominating → Godlike (7)
→ Legendary (8+); mỗi bậc là một mốc banner. Câu văn quanh chúng vẫn tiếng
Việt: "Hạ gục", "Bạn đã bị hạ bởi X", "X hạ Y". Không từ nào là thương hiệu,
và `vocabularyBoundary.test.ts` chỉ cấm tên tướng/quái/chiêu.

Giao diện (sau vòng góp ý đầu): feed nằm **giữa trên**, dòng mới nhất trên
cùng đẩy dòng cũ xuống, chân dung vuông viền xanh lá/đỏ theo phe của người
chơi. Bốn họ màu nói loại kill trước khi đọc chữ: đỏ thẫm First Blood, vàng
đa sát, **lửa cho chuỗi** (nền ấm, viền cam, glow thở), tím Shutdown; kill
thường giữ tông tối. Banner nằm dưới feed, chữ gradient theo cùng họ màu,
banner chuỗi có hiệu ứng cháy.

### HUD

`HudState.feed = { rows, banner }` dựng trong `hudState.buildFeed`: ally/enemy
theo team của người chơi, `mine` theo tham chiếu, `fade` 1→0 trong 1.5s cuối.
`KillFeed.vue` mount một lần trong `InGameHUD.vue` cho cả hai layout, ẩn cùng
corner cluster khi có panel. Feed treo dưới corner cluster bên phải; banner
giữa màn hình ở 20%, vàng cho kill, đỏ khi mình chết. CSS trong `styles/hud.css`.

### LAN

Client không chạy `onDeath`: `die()` của nó đến từ cờ `dead` trong snapshot,
không có killer. Host forward mỗi announcement như sự kiện `ann` với
`WireAnnouncement` (bỏ tham chiếu unit, thêm `kid`/`vid`); client
`announcer.receive()` đóng dấu lại theo clock của mình và resolve id thành unit
local, nên "của mình" có cùng nghĩa hai đầu.

## Bảng điểm nhanh (Tab) và dải điểm

Yêu cầu thứ ba của user: "thêm cơ chế Tab để xem bảng điểm nhanh giống LMHT,
còn bảng đội thì để config/cheat thôi".

- **Tab giữ, không toggle** (`HotKeys.TAB` = 9): `Game.keyPressed` bật,
  `keyReleased` tắt, `GameScene._handleWindowBlur` cũng tắt vì phím giữ qua
  lúc mất focus không bao giờ báo nhả. Tab của trình duyệt (chuyển focus) bị
  chặn bằng một listener `keydown` capture riêng trong GameScene, vì
  `SceneManager` gọi `keyPressed` không kèm event; listener nhường khi đang gõ
  vào ô HUD.
- **Không nút góc thứ ba**: nút thứ ba đẩy Hồi Thành lên minimap mở rộng ở
  phone 667px (`TouchLayout.test.ts`). Thay bằng **dải điểm** giữa trên
  (`ScoreStrip.vue`): kill đội mình · đồng hồ · kill đội địch, chạm/click là
  toggle bảng. Killfeed dời xuống dưới dải.
- `HudState.scoreboard` (`buildScoreboard`): đọc mọi `killCredit === 'champion'`
  trong `objectManager.objects` — không qua director, để client LAN cũng có
  bảng — nhóm theo team, đội mình trước, trong đội xếp theo kill; mỗi dòng K/D/A,
  CS, vàng, damage, chuỗi (`announcer.streakOf`), 6 ô đồ. `HudState.clock` là
  m:ss từ `matchTimeMs`.
- `Scoreboard.vue`: hai đội cạnh nhau, đội mình bên trái, da hextech, không
  pause, không sửa gì; chạm viền mờ hoặc nút × là đóng; Escape đóng trước mọi
  lớp khác. Hai cột `auto-fit` (340px desktop, 300px touch) nên phone dọc xếp
  hai đội theo chiều dọc và cuộn trong bảng — không ép `1fr 1fr`, đó là lỗi
  tràn đầu tiên user báo. Mọi cấp grid có `min-width: 0`; ô đồ 18px desktop,
  14px touch, gập 3×2 dưới 720px.
- **Card đồ**: hover (chuột) hoặc chạm (touch) một ô đồ mở đúng card túi đồ
  của chủ nhân — `ItemSlotDisplay` từ `buildItems(unit)`, stat block + mô tả
  — vẽ trong Scoreboard.vue bằng lớp `.spell-info` vì panel hover của HUD chỉ
  có ở layout desktop. Chạm ô đồ không đóng bảng (backdrop chỉ đóng khi
  `target === currentTarget`).
- **Đếm ngược hồi sinh** phủ lên avatar xám của champ đang chết
  (`ScoreboardRow.reviveAfter`, giây làm tròn lên).

## Test

`Announcer.test.ts` (run, multi, first blood, shutdown, trụ kết thúc chuỗi,
feed có giới hạn, banner, receive, detach, từ ngữ), `unitDeathEvent.test.ts`,
`hudFeed.test.ts`, `hudScoreboard.test.ts` (nhóm/sắp xếp, cột, đồng hồ),
`hudInteractions.test.ts` (Tab giữ, toggle, Escape), `netProtocol` round-trip
`ann`, `haptics.test.ts`, TouchControls tôn trọng toggle, hitFlash rung cùng
trauma.

## Ngoài phạm vi

Âm thanh cho các sự kiện này (audio đang gác), thông báo rồng/baron, killfeed
cho quái lớn, lịch sử trận.
