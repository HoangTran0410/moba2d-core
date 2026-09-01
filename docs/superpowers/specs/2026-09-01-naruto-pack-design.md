# Naruto content pack — thiết kế

Ngày 2026-09-01. Trạng thái: đã duyệt, chờ lập plan.

Hai thay đổi trong core, và một pack mới dùng chúng.

## Mục tiêu

Pack thứ ba (`naruto`) bên cạnh `lol` và `dota`: 12 tướng, một map, và hai
cơ chế mà engine chưa có — **vùng địa hình nguyên tố** và **tướng biến hình**.

Cả hai đều là thiếu sót thật của engine chứ không phải nhu cầu riêng của một
bộ anime, và cả hai đều được thiết kế để pack khác dùng lại được. Đó là tiêu
chuẩn để một thứ được vào core: `TerrainZone` không biết "cát" là gì, và
`Champion.enterStance` không biết "Kurama" là gì.

---

## Core #1 — vùng địa hình (terrain zone)

### Vấn đề

`MapGeometry.terrain` có đúng ba lớp cứng: `wall`, `bush`, `water`. Cả ba đều
mang ngữ nghĩa nặng — nav grid, chặn tầm nhìn, che giấu unit. Không có cách
nào cho một map nói "vùng này là cát, đi trên đó chậm hơn" mà không phải mở
cả ba.

### Hình dạng

Một mảng **tự chứa**, nằm **cạnh** `terrain` chứ không nằm trong nó:

```ts
// src/content/ContentPack.ts
export interface TerrainZone {
  /** Id cục bộ của pack. Core không diễn giải. */
  id: string;
  /** Tên editor và HUD hiển thị. Từ vựng của pack. */
  name: string;
  /** Nhân vào tốc độ chạy. Mặc định 1. */
  speedMultiplier?: number;
  render: { fill: string; stroke?: string };
  polygons: { x: number; y: number }[][];
}

export interface MapGeometry {
  terrain: { wall: …; bush: …; water: … };  // KHÔNG đổi
  zones?: TerrainZone[];                     // mới
  slots: …;
  lanes?: …;
}
```

**Vì sao cạnh chứ không trong `terrain`.** Giữ nguyên hợp đồng ba key thì
`TerrainMap.wallPolygonsOf`, kiểm tra "unknown layer" trong `validate.ts`,
`MonsterRoam.layer`, và `LEGACY_KEYS` của `mapEditor/storage.ts` không phải
sửa dòng nào. Định nghĩa đi cùng polygon trong một object nên không có hai
danh sách để lệch nhau.

**Vì sao không tách def ra `ContentPackData`.** `TerrainMap` nhận `ActiveMap`
(= `MapSummary & MapGeometry`), không nhận pack. Để def trong `MapGeometry`
thì map tự chứa: `PackRegistry` không phải nối gì thêm, và map editor —
vốn sửa đúng một map — đọc/ghi được trọn vẹn qua `localMaps.ts`.

### Zone đi vào quadtree riêng

Zone **không** vào `TerrainMap.obstacles`. Đó là quadtree mà `Vision`,
`NavigationSystem` và `DynamicTerrain.wallOutlinesInArea` cùng hỏi; thêm zone
vào đó là cho vùng cát chặn tầm nhìn và bị rasterize vào nav grid.

Lý do này `DynamicTerrain` đã ghi trong doc của chính nó ("Deliberately *not*
folded into `TerrainMap.getObstaclesInArea`"), và ở đây là cùng một lý do.

### API

```ts
// TerrainMap
zones: ZoneRegion[];
zoneIdsAt(x: number, y: number): string[];
inZone(x: number, y: number, id: string): boolean;
```

- `speedFactorAt` nhân thêm hệ số của mọi zone chứa điểm đó — cùng quy tắc
  "các lớp chồng nhau thì nhân" mà `bush`/`water` đang dùng.
- `ResolvedTerrainTuning.affectsSpeed` phải bật khi **bất kỳ** zone nào có
  `speedMultiplier !== 1`, nếu không cả cơ chế bị cổng chặn không chạy.
- Vẽ: zone nằm **dưới cùng**, trước water/bush/wall. Style gom theo nhóm như
  `Obstacle.applyStyle` — cache `p5.Color` mỗi zone, không parse chuỗi CSS
  mỗi obstacle mỗi frame (lý do đã ghi trong `Obstacle.applyStyle`).

Spell hỏi qua seam, không với thẳng vào `game`:

```ts
// ContentApi TERRAIN
api.terrain.inZone(game, x, y, 'sand')
api.terrain.zoneIdsAt(game, x, y)
```

### Cố tình cắt khỏi v1

- **`damagePerSecond` trên zone.** Đẻ ra câu hỏi "ai được tính mạng khi vùng
  lửa giết người". Đất cháy là việc của một `SpellObject` — nó có `owner` sẵn
  nên bounty tự đúng. Zone trên map chỉ là địa hình.
- **Zone speed trong `MapTuning`.** Tốc độ nằm trên chính zone; tránh phải mở
  `TerrainTuning` (đang là closed key list `bush`/`water`) và tránh sửa HUD
  `mapRuleLines`.

### Phạm vi

Sửa: `content/ContentPack.ts`, `content/validate.ts` (`checkMapGeometry`),
`content/localMaps.ts`, `game/gameObject/map/TerrainMap.ts`,
`content/ContentApi.ts`, `mapEditor/{state,commands,ui,render,storage}.ts`.

Không đụng: `enums/TerrainType.ts`, `map/Obstacle.ts`, `combat/Vision.ts`,
`map/FogOfWar.ts`, `nav/NavGrid.ts`, `nav/NavigationSystem.ts`,
`config/mapTuning.ts`, `MonsterRoam`, `hud/config/mapRuleLines.ts`.

Việc nặng nhất là map editor: `KIND` trong `state.ts` là bảng cứng một màu
mỗi type, còn zone thì pack khai báo động. Giải pháp: một kind `zone` duy
nhất mang `props.zoneId`, cộng một panel quản lý palette zone của map.

---

## Core #2 — biến hình (stance)

### Cái đã có sẵn

- `hudState.ts:266` dựng thanh chiêu từ `player.spells.map(...)` — **instance
  sống, mỗi frame**. Đổi spell trong slot thì icon/tên/cooldown tự theo.
- `HostSession.ts:54,445` và `ClientSession.ts:329,522` đánh **theo chỉ số
  slot**, không theo class. Cast và cooldown sync qua biến hình miễn phí.
- Mỗi `Spell` tự mang `name` / `image` / `description`.

### Cái bẫy

`Champion.replaceSpell` (đã có, **chưa ai gọi**) đi qua `removeSpell`, gọi cả
`deactivate()` lẫn `onRemoved()`. Với toggle thì cả hai đều sai:

- `onRemoved()` gỡ mọi buff nhận spell đó làm `sourceSpell` — chiêu quay về
  mất buff vĩnh viễn của nó.
- `deactivate()` gọi `resetCoolDown()` → **về 0**. Bắn Q, biến hình, thoát,
  Q lại sẵn sàng. Exploit hồi chiêu miễn phí.

### Hình dạng

```ts
// Spell.ts — deactivate() hiện tại = suspend() + resetCoolDown()
suspend(): void { this.runtime.cancel('STANCE_SWAP'); this.spellVfx?.dispose(); }

// Champion.ts
stance: string | null = null;
enterStance(id: string, spells: Spell[]): void;
exitStance(): void;
```

Luật:

1. **Cả hai bộ chiêu sống song song.** Bộ ngoài `spells[]` ngủ đông: không
   `update()`, không `drawVfx()` (hai vòng lặp đó duyệt `this.spells`).
2. **Cooldown đóng băng, không reset.** Mỗi form giữ `currentCooldown` riêng
   — đúng mô hình Nidalee/Jayce, và miễn phí vì mỗi instance tự giữ.
3. `enterStance` gọi `suspend()` lên bộ đi ra, **không bao giờ** `onRemoved()`.
4. Thêm lý do interrupt `STANCE_SWAP`.
5. `enterStance` khi **đã** ở trong một stance khác: thoát cái cũ trước
   (trả slot về bộ gốc), rồi vào cái mới. Không chồng stance lên stance —
   `exitStance` chỉ biết một bộ gốc, nên chồng là mất bộ ở giữa.
   `enterStance` với đúng id đang mang là no-op, không phải gia hạn.
6. Net: event `stance` host→client (`{ unit, id, slots }`) để puppet và
   champion của client đổi form đồng bộ. Ngoài ra không đụng gì.

`replaceSpell` giữ nguyên, không đụng — nó là seam cho "đổi kit vĩnh viễn",
một việc khác hẳn.

### Kit tự ghép

Người chơi có thể lấy R của Naruto mà không lấy Q/W/E của Naruto. Vào form
thay slot 0–2, thoát form trả lại **đúng instance cũ** — chạy được vì cả hai
bộ còn sống. Cần một test riêng cho case này.

### Bot

`BotBrain` đọc `SpellRole`. Chiêu form phải gắn role, nếu không bot đứng hình
sau khi biến hình.

---

## Pack `naruto`

Repo mới `moba2d-packs/naruto`, checkout tại `moba2d/naruto/`, scaffold bằng
`npx moba2d-pack-new`. `coreRange: '>=1.19.0'`.

### Roster — 12 tướng

Konoha: Naruto, Sasuke, Kakashi, Sakura, Neji, Shikamaru.
Suna: Gaara, Temari. Kiri: Zabuza, Haku. Akatsuki: Itachi, Deidara.

Naruto và Sasuke là hai con biến hình; mười con còn lại có bốn chiêu như
thường. Tổng **54 spell** (12×4 + 2×3 chiêu form).

Hai form cố tình khác nhau ở **cách kết thúc**, để không cảm giác trùng nhau:

- **Naruto — Kurama Mode**: hết theo *đồng hồ*, đốt chakra mỗi giây. Vào là
  phải xông lên, ép giao tranh.
- **Sasuke — Susanoo**: hết theo *máu*, một lớp shield riêng bọc ngoài. Địch
  tập trung đánh vỡ được → tạo mục tiêu ưu tiên. Recast R để tự thoát, hoàn
  lại một phần cooldown.

### Quy ước id chiêu form

`Naruto_Q2` / `W2` / `E2`. `displayData()` lọc `/[QWER]\d$/` để chúng không
hiện trong màn chọn kit — đúng vấn đề mà `Item_` đã giải, cùng cách giải.

### Ngũ hành

Mỗi tướng một hệ (Katon/Suiton/Fūton/Raiton/Doton), spell gắn tag, vòng khắc
Hoả→Phong→Lôi→Thổ→Thuỷ→Hoả cho ±10% sát thương. Helper trong `packApi.ts`,
**hoàn toàn phía pack** — core không biết gì.

### Map — Thung Lũng Tận Cùng

Point-symmetric, hai base. Sông giữa (`water` thật), hai tượng đá làm `wall`
mốc. Jungle chia bốn lùm nguyên tố **đối xứng** dùng `TerrainZone`: Lửa, Gió,
Nước, Cát.

Camp: ba vùng tiên nhân (Myōbokuzan / Ryūchidō / Shikkotsu) thay bùa
xanh-đỏ; hố giữa là Cửu Vĩ, tương đương Baron.

Vẽ tay trong map editor rồi export — không trace. `mapRules` bắt buộc lane
nối hai base khác nhau và camp đối xứng, nên bố cục "5 làng ở 5 góc" không
hợp lệ và đã bị loại từ đầu.

### Art

- **12 chân dung**: fetch từ `naruto.fandom.com` qua MediaWiki API, theo đúng
  pipeline `import-art.mjs` của pack dota (hash + `source-manifest.json` +
  `art:check`). Bảng file title viết tay, không đoán — `prop=pageimages` trả
  về bản Part I hoặc render nền trắng cho 6/12 con.
- **54 icon chiêu**: gen AI từ `naruto-icon-prompts.md`. Ảnh wiki là khung
  hình 1920x1080; cắt vuông 128px thì 3/4 ra vệt đen hoặc vệt cam — đã đo.

---

## Thứ tự triển khai

1. Core #1 zone: contract + validate + TerrainMap + tests
2. Core #1 zone: map editor
3. Core #2 stance: `Spell.suspend` + `Champion.enterStance/exitStance` + tests
4. Core #2 stance: net event
5. `contract:bump` → 1.19.0, `npm run verify`
6. Scaffold pack `naruto`, import 12 chân dung
7. 10 tướng thường (40 spell)
8. Naruto + Sasuke (14 spell, gồm 2 stance)
9. Map Thung Lũng Tận Cùng
10. Ngũ hành + cân bằng

Bước 1–5 phải xong và `verify` xanh trước khi bước 6 bắt đầu: pack cần core
1.19 đã publish để `coreRange` có nghĩa.

**Spec này lớn hơn một implementation plan và được tách làm hai**, cắt đúng
ở ranh giới repo:

- **Plan A — core 1.19** (bước 1–5): hai cơ chế engine, trong `moba2d-core`,
  không có gì của Naruto trong đó. Nghiệm thu là `npm run verify` xanh cộng
  một map thử có zone và một tướng thử có stance dựng bằng `testing/spell`.
- **Plan B — pack `naruto`** (bước 6–10): repo riêng, chỉ bắt đầu sau khi
  Plan A đã publish.

Cắt như vậy vì Plan A có gate riêng (`contract:bump`, `publicSurface`,
`check-seams`) và vì mọi thứ ở Plan B đều chặn sau nó.
