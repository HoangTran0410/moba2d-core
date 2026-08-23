# Core becomes a pack SDK, and the riot pack leaves

Trạng thái: **design, chờ duyệt**. Đây là giai đoạn cuối của chương trình tách
content: `packs/riot/` ra repo riêng, và core trở thành thứ người khác viết pack
mới lên được. Hai việc này là **một** thiết kế, không phải hai — vì thứ duy nhất
chứng minh core đủ để viết pack là một pack thật sự sống ngoài nó.

**Không phải mục tiêu, đã chốt:** viết lại lịch sử git (`git filter-repo`) —
để sau, quyết định riêng. Đẩy pack lên npm registry công khai — spec trước đã
loại. Đổi tên hiển thị cho người chơi.

## 1. Đo đạc — cái đã đúng, và cái chưa

Bốn khảo sát chạy trên cây nguồn, không phải phỏng đoán. Hai cái mới nằm ở
`docs/superpowers/surveys/2026-08-23-*`.

### 1.1 Mã nguồn sản xuất của pack: delta bằng 0

Cả `packs/riot/` lẫn `packs/reference/` chỉ import đúng **ba subpath** core đã
công bố (`content/ContentApi`, `content/ContentPack`, `content/types`), toàn bộ
là `import type`. Không một import giá trị nào. Đem chương trình pack ra
`tsc --outDir` cho ra 374 file JS **không có một cạnh runtime nào** tới core.

Nghĩa là: **phần khó nhất đã xong.** Một pack đã tiêu thụ core đúng cách.

### 1.2 Cây test: toàn bộ khoảng trống nằm ở đây

69 file test của pack sống ở `tests/packs/riot/` — trong cây của core, không
phải trong pack — và import **55 module core bằng đường dẫn tương đối**, chạy
được chỉ vì chúng nằm vật lý trong checkout của core.

Phân loại từng specifier theo khả năng lấy qua `ContentApi`:

| | |
|---|---:|
| REACHABLE — lấy được qua `api` | 34 |
| TYPE-ONLY | 4 |
| TEST-ONLY — hạ tầng test của core | 3 |
| **GAP** — từ vựng engine `ContentApi` không phát | **15** |

**Không file mẫu nào chỉ cần `api` là đủ.** Đó là kết quả quan trọng nhất của
khảo sát, và nó bác bỏ phương án "test cứ dùng API như spell" ở dạng thuần.

### 1.3 Ba lý do mang tính cấu trúc

**`vi.mock()` lên `AssetManager`, 48/69 file.** `AssetManager` không có trong
`exports` của core. Khi pack là package riêng, `vi.mock()` lên đường dẫn đó
**bất khả về cấu trúc** — không phải "thiếu một export", mà là mock một đường
dẫn không tồn tại. Thêm gì vào `ContentApi` cũng không chữa được.

**Fixture dựng thế giới, spell nhận thế giới.** `tests/game/spell/fixtures.ts`
(47 file dùng) và `tests/game/fixtures.ts` (12 file) được dựng *từ* `ObjectManager`,
`EventManager`, `NavGrid`, `TerrainType` — ruột core mà `ContentApi` không bao
giờ phát ra, và đúng ra là không nên phát. Một spell **được đưa** cho một thế
giới đã dựng; việc của fixture là **dựng** nó. Hai vai khác nhau không dùng
chung một cửa.

**`tests/game/spell/registry.ts:2` import cứng `packs/riot/spells/index`** — một
helper test của core phụ thuộc vào chính cái pack sắp rời đi.

### 1.4 Lỗ `@/`, đã xác nhận sống

`packs/riot/tsconfig.json` kế thừa `@moba2d/core/tsconfig.base.json`, nơi khai
alias `@/*` của core để `tsc` của pack nhìn xuyên được qua mã nguồn chưa bundle
của `ContentApi.ts`. Hệ quả đo được: một pack viết
`import Slow from '@/game/gameObject/buffs/Slow'` thì **`tsc` của chính nó thoát
0**. Thứ duy nhất bắt được là seam `pack-core-boundary`, và cổng đó chỉ chạy
dưới `verify:all`.

Cùng lỗi ở dạng tên package (`@moba2d/core/game/Game`, không có trong `exports`)
thì `tsc` chặn ngay bằng TS2307. **Alias nguy hiểm hơn hẳn một specifier sai**,
và nó đi theo `tsconfig.base.json` vào repo pack.

### 1.5 Riot nằm ngoài `packs/riot/`

Năm thứ ở **gốc repo core**, `git mv packs/riot` không đụng tới:
`docs/abilities/` (54 thư mục), `assets/source-manifest.json` (296 dòng),
`scripts/wiki/*.mjs` (6 file), `docs/spell-names-vi.json`, hai ảnh tài liệu.
Chín script trong `scripts/` ghi cứng tên pack. Và `verify` trơn mất một bước
nữa khi pack đi: `ability:check` chạy trên `docs/abilities/`.

## 2. Nguyên tắc

**Một đường ranh, phát biểu một lần:**

> `api` là thứ **một spell** nhìn thấy. `@moba2d/core/testing` là thứ **một
> người quan sát** nhìn thấy.

Mọi câu hỏi "cái này để đâu" đều trả lời được bằng câu đó. Spell được đưa cho
một thế giới và tác động lên nó; test dựng thế giới, chạy nó, rồi đọc kết quả.
Hai bề mặt, hai vai, và không cái nào là bãi re-export ruột core.

**Hệ quả cố ý:** `@moba2d/core/testing` là một entry point **được thiết kế**.
Nếu nó biến thành nơi tuồn ruột core ra ngoài, cả năm batch trước thành công cốc
— vì lúc đó đổi `AttackableUnit` lại là breaking change cho mọi pack, chỉ là qua
cửa sau.

## 3. `@moba2d/core/testing`

Năm nhóm, và ranh giới của từng nhóm là "một người quan sát cần gì".

### 3.1 Dựng thế giới

Thay `tests/game/spell/fixtures.ts` và `tests/game/fixtures.ts`. Dựng một trận
đủ để chạy một spell: object manager, event manager, địa hình, đội, đơn vị.

**Yêu cầu bắt buộc:** nó nhận **pack đang test** làm tham số. Bản hiện tại của
`registry.ts` import cứng `packs/riot/spells/index`; bản mới không được biết pack
nào tồn tại. Đó là cùng một luật `TeamBlackboard` đã học — engine không giữ danh
sách content nào có mặt.

### 3.2 Asset, dưới dạng một hàm chứ không phải một mock

48 file đang `vi.mock('.../AssetManager')` chỉ để nói *"asset trả về thứ vô
hại"*. Harness cung cấp việc đó trực tiếp. Sau thay đổi này, **không file test
nào của pack còn mock một đường dẫn nội bộ của core** — và đó là điều kiện cần
để chúng chạy được ngoài repo này.

`Janna_R.test.ts` mock `CastTelegraph`; cùng cách xử lý.

### 3.3 Runtime của test

Bốn thứ `tests/setup.ts` cài, cả bốn đều pack-agnostic sẵn: patch `Math.hypot`,
đăng ký asset của pack (thiếu là mọi constructor spell ném "Unknown asset key"),
hình học lane, và stub p5 global (`createVector`… — ~29 file cần).

Xuất ra dạng một setup module cộng một **preset vitest** để pack không phải chép
tay `vitest.config.ts` của core rồi trôi khỏi nó.

### 3.4 Từ vựng của người quan sát

15 mục GAP, và chúng có một điểm chung: đều là thứ để **dựng hoặc soi** một trận,
không phải thứ một spell dùng — `TeamId`, `Minion`, `EventManager`, `lanes`,
`Stats`, `constants`, `PackRegistry`, `validate`, `FogOfWar`, `BasicAttack`,
`SpellInputController`, `preset`.

Chúng vào `@moba2d/core/testing` **theo vai, không theo tiện tay**: mỗi mục phải
trả lời được "một người quan sát cần cái này để làm gì". Mục nào không trả lời
được thì cái test cần nó đang kiểm sai tầng, và phải sửa test.

### 3.5 Hai type không có nhà

`MatchRules` và class `GameObject` là TYPE-ONLY nhưng chưa nằm trong subpath nào.
Đưa vào `content/types` (chúng là từ vựng hợp đồng) chứ không vào `testing`.

## 4. Scaffold

`npm create moba2d-pack` sinh ra một pack **chạy được ngay**: `package.json`,
`tsconfig.json`, một tướng mẫu với một chiêu, một map tối thiểu, một file test
mẫu, generator và `check-seams` đã đấu dây, một `README` nói bước tiếp theo.

"Chạy được ngay" là điều kiện nghiệm thu, không phải lời hứa: cài xong, `npm
test` và `npm run check-seams` phải xanh, và pack phải nạp được vào core.

Rồi thêm dần: `new-spell`, `new-champion`, `new-map`, `new-monster`, `new-test`.

**Chúng thao tác trên pack hiện tại**, suy ra từ `package.json` gần nhất — không
ghi cứng tên pack nào. `scripts/new-spell.mjs` hiện tại vừa ghi cứng
`packs/riot`, vừa **đang hỏng sẵn**: nó viết test vào `tests/game/spells/`, chỗ
dự án bỏ dùng từ 2026-08-22.

**Chỗ này là nơi hướng B trả công.** Một file test của pack và một file spell của
pack lấy từ vựng từ hai cửa có tên rõ ràng, nên `new-spell` sinh được cả hai từ
một khuôn — thay vì sinh một file spell đúng và một file test chỉ chạy được nếu
đặt trong repo core.

## 5. Cái gì đi, cái gì ở

**Đi cùng pack:** `packs/riot/` (239 spell, 378 ảnh, manifest, tsconfig,
generator); `tests/packs/riot/` (69 file); `docs/abilities/` (54 thư mục);
`assets/source-manifest.json`; `scripts/wiki/*.mjs`; `docs/spell-names-vi.json`;
hai ảnh tài liệu; phần Riot trong `docs/ADDING_SPELLS.md` và
`docs/VFX_STANDARD.md`.

**Ở lại core:** `packs/reference/` — không bao giờ rời, kể cả trong drill. Nó là
content của chính core và là thứ khiến core là một game đứng riêng chứ không
phải một cái menu.

**Chín script ghi cứng tên pack** phải xử lý từng cái. `new-spell.mjs` trở thành
lệnh của SDK; `installed-packs.mjs` vốn đã là phép suy ra và giữ nguyên.

## 6. Repo private — ba hệ quả

Pack ở repo private, nên `"@moba2d/core": "*"` thành git dependency có token.

**CI của core không fetch được pack.** Đó là điều đúng: CI core chạy `verify`
(core một mình — 159 file / 1656 test, boot 13 check, đã đo); CI của repo pack
chạy `verify:all`. Mỗi repo gác phần của mình.

**Bản deploy production sẽ mất pack Riot** trừ khi build lấy pack qua token.
Đây là quyết định vận hành, không phải kỹ thuật, và spec này **không quyết** —
nó chỉ ghi rằng phải quyết trước khi tách, vì phát hiện sau khi CI đã đỏ thì đắt.

**Người ngoài clone core** chỉ chơi được reference pack — hiện là một tướng, bốn
chiêu, một map, không summoner spell (`D`/`F` rơi về đánh thường). Spec trước dựa
vào reference pack để nói "core là game hoàn chỉnh đứng riêng"; câu đó hiện hơi
quá lời, và mở rộng reference pack là việc riêng, ngoài phạm vi này.

## 7. Test

**Tiêu chí nghiệm thu, không thương lượng:** một checkout của repo pack, ngoài
cây này, core cài từ git dependency, chạy `npm test` và `npm run check-seams`
xanh — và **không có symlink nào trỏ về monorepo**.

Đó chính xác là chỗ batch 5 đã sập một lần: một bằng chứng "chạy được như repo
riêng" mà fixture của nó symlink `node_modules/@moba2d/core` về lại monorepo, nên
rò đúng tại điểm gãy. **Một fixture với tới được thứ nó đang giả vờ là không có
thì không chứng minh gì cả.**

Bổ sung: scaffold ra một pack rỗng ở thư mục tạm, chạy `npm test` của nó, xanh.
Đó là bài kiểm duy nhất chứng minh "viết pack mới dễ".

Và luật cũ vẫn phải giữ: `pack-core-boundary` mở rộng để phủ **cả cây test của
pack**, không chỉ mã nguồn — một luật, hai cây, thay vì hai chế độ.

## 8. Rủi ro

**Viết lại 69 file test là phần lớn nhất.** 48 file bỏ `vi.mock`, phần còn lại
đổi nguồn từ vựng. Cách giảm rủi ro là số lượng test **không được đổi**: nó là
bằng chứng duy nhất cho việc không có test nào lặng lẽ ngừng chạy.

**`@moba2d/core/testing` có thể phình.** Mỗi lần một test cần thêm một thứ, cửa
dễ nhất là export thêm. Chống bằng cùng cơ chế `publicSurface.test.ts` đang dùng
cho `exports`: danh sách chính xác, mở rộng là hành động có người soát.

**Lịch sử git vẫn chở toàn bộ asset Riot** trong mọi commit từng có. Để sau, và
làm sau khi tách thì đắt hơn làm trước — ghi lại để không ai quên rằng mình đã
biết.
