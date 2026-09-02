# Bot đi rừng và tranh mục tiêu — thiết kế

Ngày 2026-09-02. Trạng thái: đã duyệt chung trong batch "12, 13, 16-19", làm thẳng.

## Vấn đề

Bot chưa từng nghe đến quái: `src/game/ai/` không có một chữ `Monster`,
`TeamBlackboard` bỏ qua mọi thứ không phải lính/trụ/tướng, `findObjectiveTarget`
chỉ trả lính trong lane và chỉ khi PUSH. Pack lol có Baron, Dragon, Vilemaw
nhưng với bot chúng là địa hình. Trận không có nhịp: không ai đi rừng, không ai
gọi nhau ăn rồng.

## Ba mảnh, đúng chỗ chúng thuộc về

### 1. Từ vựng: `MonsterDef.tier`

Core không được biết "rồng" là gì (`vocabularyBoundary`), nên pack nói bằng một
từ của core: `tier?: 'camp' | 'epic'`, mặc định `'camp'`. `validate.ts` kiểm
tra hai giá trị; `monsterBodyPreset` chép lên từng thân; `Monster.tier` là thứ
brain đọc. Pack lol gắn `epic` cho baron, dragon, vilemaw — ba dòng data.

### 2. Blackboard: camp, lời gọi, và jungler — trong đúng một lượt duyệt

Luật cứng của thư mục ai: chỉ **một** lượt `objectManager.objects` cho cả game
(`TeamBlackboard.lanes.test.ts` đếm). Nên quái được gom **trong** lượt đó, và
**trước** dòng bỏ qua xác — camp đã bị dọn vẫn là thông tin (bao lâu nữa mọc
lại là nửa câu hỏi của jungler):

- `CampState { camp, tier, alive, total, respawnInMs }`, nhóm theo *tham chiếu*
  slot mà mọi thân trong camp cùng giữ (`Monster.camp`, cũng là cách `alertCamp`
  nhận nhau). Chung cho hai đội.
- `ObjectiveCall { camp, monster }` từ `pickObjective`: một camp `epic` còn thân
  đứng, và số địch đội **đã thấy** trong 4s gần pit (`memory`, không quét) phải
  ít hơn số đồng minh còn ≥ 50% máu ít nhất một người. Bằng trí nhớ, nên pit
  chưa ai nhìn được coi là trống — đúng cái đội không có tầm nhìn thực sự biết.
  Cố tình không xét ai đang đánh nhau: chuỗi posture của từng bot đặt FIGHT trên
  OBJECTIVE, bot đang có địch trước mặt tự bỏ lời gọi.
- `jungler`: đội có từ 4 bot thì bot cuối theo thứ tự roster ra khỏi
  `laneAssignments` và sống trong rừng. Thứ tự roster để không nhấp nháy.

Ba trường đều **optional** trên `TeamView` để mười file test dựng view tay không
phải đổi.

### 3. Brain: hai posture

```
DISENGAGE → RECOVER/RETREAT → FIGHT → FIGHT → SEARCH → ENGAGE
  → OBJECTIVE → PUSH → FARM → ROAM
```

- **OBJECTIVE** (trên PUSH): có lời gọi, tier cho phép, thân còn sống, và bot
  trong `OBJECTIVE_CALL_PX` = 2600 của pit. Đi tới thân qua `safely()`.
- **FARM** (dưới PUSH, trên ROAM): `pushApproach` không có gì để đẩy, và có camp
  `tier: 'camp'` còn thân trong tầm — `CAMP_DETOUR_PX` = 700 với laner,
  `JUNGLE_ROUTE_PX` = 3200 với jungler. Không bao giờ farm epic một mình.
- `findObjectiveTarget` mở cho hai posture: trả thân đang đi tới khi đã trong
  `aggroRange` và nhìn thấy — cùng phép chia PUSH giữ giữa `pushApproach` và
  `nearestLaneMinion`. Không thêm lượt duyệt nào.
- Knob độ khó: `farmsJungle`, `contestsObjectives` — easy tắt cả hai.

## Chưa làm, có chủ ý

- Bot **không tung chiêu** vào quái: `maybeCast` nhận `Champion | null`. Jungler
  dọn camp bằng đánh thường, chậm nhưng đúng. Mở sau khi có bằng chứng cần.
- Không cắm mắt: core không có ward; lol có `StealthWard` nhưng bot chưa mua.
- Không smite, không tranh cướp (steal) — không có chiêu smite trong core.
- Camp không phải địa hình: đường đi lane vẫn có thể lướt qua pit, nhưng quái
  ở đây "chờ bị đánh" nên đi ngang không kéo aggro.

## Test

`TeamBlackboard.camps.test.ts` (gom camp, respawn, lời gọi theo số, đội bị
thương, jungler ở 4 và không ở 3), `BotBrain.jungle.test.ts` (FARM trong detour,
jungler với xa, không farm epic/camp trống, easy tắt, quỹ đạo tới camp không
pacing, chỉ đánh trong aggroRange; OBJECTIVE trong tầm gọi, quá xa, easy, boss
đã chết), `tests/content/monsterTier.test.ts`.
