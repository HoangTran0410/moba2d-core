# Lịch sử trận và thông thạo theo tướng, lưu trên máy

**Ngày:** 2026-09-02 · **Trạng thái:** đã làm · Mục 9 của danh sách ý tưởng.

## Vấn đề
Game là phòng tập, trận kết thúc khi người chơi thoát, và mọi con số
`MatchTally` đếm được biến mất theo. Không gì nói "bạn đã chơi Yasuo mười một
buổi và KDA đang lên" — thứ tiến bộ duy nhất một sandbox có thể hứa thật lòng:
không có trận thắng để ghi, nhưng có một bản thân để so.

## Quyết định

### Kho (`config/matchHistory.ts`, `moba2d:matchHistory:v1`)
- `records`: vòng 40 trận gần nhất, mới trước. Ghi **theo id** (`Game.matchId`),
  nên recorder lưu cùng một trận nhiều lần mà chỉ ra một dòng.
- `archive[championId]`: trận rơi khỏi vòng được gộp vào đây. Thông thạo =
  archive + vòng (`masteryTable`/`masteryOf`), không bao giờ quên trận cũ.
- `qualifies`: ≥30 giây giờ trận, hoặc có kill/chết/hỗ trợ. Chơi lại sau 10 giây
  vì chọn nhầm bản đồ không thành một dòng lịch sử.
- Điểm một trận: `20 + 10·kill + 5·assist + 0.5·CS + 3·phút − 4·chết`, sàn 20.
  Bậc 1..7 theo `MASTERY_THRESHOLDS` = [0, 300, 800, 1600, 3000, 5000, 8000].
- Chỉ `localStorage`, không import `src/game/` → nằm trong chunk `pregame`
  (allowlist `pregameBootPath.test.ts`).

### Recorder (`combat/MatchRecorder.ts`, `Game.recorder`)
- Đọc `MatchTally` + `Wallet.earnedTotal` của người chơi, `announcer.onAnnounce`
  cho multi-kill/chuỗi tốt nhất của chính người chơi (announcer chỉ nhớ run
  đang sống), id/map/mode/clock của trận. Context 5 hàm, cùng khuôn với
  `MatchAnnouncer` và `DeathCamera`.
- **Autosave mỗi 30 giây giờ trận** (`tick()` trong `fixedUpdate`), rồi
  `save()` ở `Game.destroy()`, `GameScene._leavePage` (tab ẩn) và `pagehide`
  (đóng tab, vuốt PWA đi). Điện thoại giết PWA nền không báo — recorder chỉ
  ghi cuối trận sẽ mất đúng những buổi kết thúc đột ngột.
- Tắt trên LAN client: tally không đi qua dây, ghi số 0 là nói dối.

### UI
- `KitRoster.vue`: huy hiệu bậc góc dưới-trái ô tướng (`.kit-tile-mastery`,
  teal để không lẫn với dấu chọn vàng góc trên-phải), câu đầy đủ trên shelf
  đang mở (`.kit-mastery-line`). Đọc kho một lần mỗi mount. `KitShelf` thêm
  `championId` (id qualified) để khoá.
- `MatchTab.vue`: "Trận gần đây" dưới các control, trên nút thoát: tướng,
  K/D/A, CS, chế độ · bản đồ · thời lượng, "Hôm nay 17:20"/"Hôm qua"/"02/09".
  10 dòng một trang, "Xem thêm", "Xoá lịch sử" hai bước như các nút không
  hoàn tác khác trên tab.

## Không làm
Thử thách theo ngày (seed theo ngày qua `matchSeed`) — nằm trong ý tưởng gốc
nhưng người chơi chỉ gọi lịch sử + thông thạo. Ảnh tướng trong danh sách lịch
sử: cần catalog, để sau khi có nhu cầu.

## Kiểm chứng
`matchHistory.test.ts` (qualifies, upsert/cap/archive fold, điểm, bậc,
sanitize, store, format), `MatchRecorder.test.ts` (snapshot, chưa đủ không
ghi, ghi đè cùng id, multi/chuỗi chỉ của mình, cadence autosave, client tắt).
Lái trình duyệt: trận có một cái chết → thoát → tab Trận đấu có dòng → ô
tướng có huy hiệu 1.
