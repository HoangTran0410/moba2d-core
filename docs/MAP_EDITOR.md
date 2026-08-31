<!-- Khôi phục từ `tools/map-editor/README.md` (commit 7659448 xoá thư mục đó).
     Editor giờ sống hẳn trong repo này nên tài liệu về nó ở đây. -->

# Map editor

Công cụ vẽ bản đồ cho **moba2d** (và vẫn export được cho MOBA2D đời trước).

Mô hình dữ liệu bám đúng `MapGeometry` trong
`moba2d-core/src/content/ContentPack.ts`: địa hình, slot và lane.

**Chạy hoàn toàn local, không cần mạng, không cần build.** Mọi chỉnh sửa tự
lưu vào localStorage của trình duyệt; nút **Lưu file / Mở file** đọc-ghi
`.json` trên máy. File export từ các bản cũ (kể cả bản Firebase ngày xưa)
vẫn mở được bình thường.

## Chạy

```bash
npm run dev     # rồi vào http://localhost:5173/map-editor/
```

Hoặc bấm **Tạo map** ở menu chính. Editor là một trang tĩnh trong `public/`, nên
Vite chép nó nguyên xi và không bundle gì cả — sửa file `.js` xong chỉ cần F5.

## Thao tác

### Chuột

| | |
|---|---|
| Cuộn con lăn | Zoom **ngay tại vị trí con trỏ** |
| Kéo trên nền trống | Quét chọn nhiều polygon một lúc |
| Giữ `Space` / chuột giữa / chuột phải + kéo | Di chuyển khung nhìn |
| Kéo trong lòng polygon | Di chuyển polygon (chọn nhiều thì cả nhóm đi cùng) |
| Kéo chấm vàng | Sửa từng đỉnh |
| Nháy đúp lên hình | Vào **chế độ sửa đỉnh** (`E`) — xem dưới |
| Nháy đúp lên cạnh | Chèn đỉnh mới đúng vào cạnh đó |
| `Shift` + nháy | Thêm / bớt khỏi vùng chọn |

### Chế độ sửa đỉnh (`E`, hoặc nháy đúp lên hình)

Chọn nhiều đỉnh một lúc để dời hoặc xoá hàng loạt. Đây là một **mode tường
minh** chứ không phải đổi ngầm hành vi của cú kéo: ngoài mode, kéo trên nền
vẫn quét chọn nhiều polygon như cũ; trong mode, cùng cú kéo đó quét chọn
nhiều **đỉnh** của hình đang sửa. Cách Illustrator (Direct Selection) và
Figma (double-click vào vector) đều làm vậy — nếu để một cử chỉ tự đổi
nghĩa theo trạng thái vô hình thì không ai đoán nổi nó sắp làm gì.

Vào bằng nút công cụ (dùng được trên cảm ứng), nháy đúp, hoặc `E`/`Enter`.
Trong mode:

- kéo trên nền → quét chọn đỉnh; `Shift`+nháy → thêm/bớt từng đỉnh
- kéo một đỉnh đã chọn → dời **cả cụm**
- `⌫` xoá mọi đỉnh đang chọn (chặn lại nếu còn dưới 3 đỉnh, lane dưới 2)
- mũi tên dịch đỉnh (không dịch cả hình), `Ctrl+A` chọn hết đỉnh
- `Esc` thoát dần: bỏ chọn đỉnh → rời mode → bỏ chọn hình

Các hình khác mờ đi trong lúc sửa, đỉnh đang chọn tô xanh viền trắng, còn
thanh trạng thái ghi rõ đang chọn mấy đỉnh — để lúc nào cũng biết mình đang
ở mode nào.

### Touchpad

Hai ngón cuộn ngang-dọc để di chuyển, chụm để zoom. Độ nhạy zoom của
touchpad và của con lăn chuột được tính riêng (touchpad bắn ra bước rất nhỏ
nên cần hệ số lớn hơn nhiều). Nếu vẫn không hợp tay, menu **…** có
*Con lăn chuột* (tự nhận / luôn zoom / luôn cuộn) và *Tốc độ zoom*
(chậm / vừa / nhanh).

### Điện thoại & máy tính bảng

Một ngón kéo trên nền trống để di chuyển, hai ngón chụm để zoom, chạm để
chọn, kéo để di chuyển polygon. Vùng chạm vào đỉnh được nới rộng gấp đôi so
với chuột. Thanh công cụ tự rút gọn, bảng thuộc tính trượt lên từ đáy, và
menu **…** luôn chứa đủ mọi lệnh.

### Phím tắt

`V` chọn · `M` quét chọn vùng · `H` kéo khung nhìn · `P` vẽ polygon tự do ·
`L` vẽ lane · `N` thêm tường · `A` thêm đỉnh tại con trỏ · `D` xoá đỉnh ·
`Shift+H` / `Shift+V` lật ngang / dọc · `Shift+C` căn tâm ·
`F` vừa màn hình · `G` lưới · `Shift+G` hút lưới · `Tab` bảng thuộc tính ·
`Del` xoá · mũi tên dịch 1px (`Shift` = 10px) · `Ctrl+Z` / `Ctrl+Shift+Z`
hoàn tác · `Ctrl+A` chọn tất cả · `Ctrl+D` nhân bản · `Ctrl+S` lưu file ·
`Ctrl+C`/`Ctrl+X`/`Ctrl+V` copy/cắt/dán (`Ctrl+Shift+V` dán tại chỗ) ·
`Ctrl+M` danh sách map · `Ctrl+I` nhập JSON · `Ctrl+E` export moba2d ·
`?` xem đầy đủ.

## Mô hình đối tượng

Tám loại, chia đúng ba nhóm của `MapGeometry`:

| nhóm | loại | hình | thuộc tính riêng |
|---|---|---|---|
| `terrain` | Tường / Bụi / Nước | polygon | — |
| `slots.spawn` | Điểm hồi sinh | vòng tròn | `faction`, `r` |
| `slots.structure` | Trụ | điểm | `faction`, `kind: 'turret'` |
| `slots.minion` | Điểm gom lính | điểm | `faction`, `lane`, `scatter?` |
| `slots.neutral` | Bãi quái | vòng tròn | `role`, `r`, `rotationDeg?` |
| `lanes` | Lane | đường gấp khúc hai chiều | `id` (còn `from`/`to` là dẫn xuất) |

Cấp map có thêm `id` (slug) và danh sách **phe** — đúng `MapSummary`. Đổi
tên một phe thì mọi `faction`/`from`/`to` đang trỏ vào nó đi theo luôn.

`MapSummary.size` chỉ có một số nên map moba2d là hình vuông; editor vẫn cho
vẽ map chữ nhật nhưng sẽ cảnh báo và có nút *Làm vuông*.

Map cũ mở lên được quy đổi tự động: `brush` → `bush`, `turret1`/`turret2` →
`structure` với `faction` là phe thứ nhất / thứ hai.

### Vì sao địa hình luôn được cắt lồi

`TerrainField` và `Vision` của core chỉ cho kết quả đúng với polygon lồi —
*"every wall deeper than it is wide is authored as several convex boxes
butted together"*. Nên bạn cứ vẽ polygon lõm cho thoải mái; editor giữ hình
gốc để sửa, và chỉ xuất ra các mảnh lồi đã cắt sẵn.

## Kiểm tra

Bảng thuộc tính có mục **Kiểm tra** chạy nền, soi đúng những gì schema đòi:
phe không tồn tại, `lane` mà điểm gom lính trỏ tới không có thật, lane trùng
id, bãi quái thiếu `role`, map không vuông, phe chưa có điểm hồi sinh, vật
thể nằm ngoài khung map… Kết quả cũng hiện ngay trên đầu hộp Export — chỗ
cuối cùng còn kịp sửa.

## Chức năng

- **Nhiều map** — mỗi map là một bản nháp riêng có ảnh thu nhỏ trong menu
  *Danh sách map*: tạo mới (đặt tên + kích thước, map chữ nhật OK), đổi tên,
  nhân bản, xoá. Mở app là vào thẳng map đang làm dở, **đúng chỗ đang xem**:
  vị trí và mức zoom được nhớ riêng cho từng map, F5 hay đóng tab mở lại đều
  quay về nguyên chỗ cũ.
- **Đổi kích thước map + scale nội dung** — sửa W/H trong bảng thuộc tính
  rồi editor hỏi luôn *"kéo nội dung theo khung mới?"*, hoặc dùng nút
  **Đổi kích thước & scale nội dung…**. Ví dụ 12500×12500 thấy to quá thì
  thu về 6400×6400, mọi polygon / slot / lane co theo đúng tỉ lệ ×0.512, kể
  cả bán kính spawn, bán kính bãi quái và `scatter` của điểm gom lính.
  Camera cũng co theo nên nhìn vào y như trước khi đổi.

  Scale quanh **gốc (0,0)** chứ không quanh tâm map — toạ độ map chạy từ 0
  tới `size` nên nhân quanh gốc mới ánh xạ đúng 0…12500 sang 0…6400, không
  lệch mép nào. Thu nhỏ quá đà thì làm tròn có thể ép polygon mỏng thành
  bẹt; editor đếm và báo lại để còn kịp `Ctrl+Z`.

  Menu `…` còn có **Scale nội dung theo %** cho trường hợp vẽ lỡ tay quá to
  mà không muốn động vào khung.
- **Copy / cắt / dán** (`Ctrl+C` / `Ctrl+X` / `Ctrl+V`) — dán vào **vị trí
  con trỏ**; `Ctrl+Shift+V` dán **tại chỗ**, giữ nguyên toạ độ gốc (tiện khi
  chuyển đồ giữa hai map). Dán được sang tab editor khác, và phe của nguồn
  được mang theo nên slot không bị mồ côi. Dán một JSON lạ (MapGeometry,
  bản export) thì nó gộp thẳng vào map đang mở.

  Dùng đúng sự kiện `copy`/`cut`/`paste` của trình duyệt chứ không tự bắt
  phím: sự kiện thật mang sẵn dữ liệu nên không phải xin quyền clipboard, và
  copy chữ trong ô nhập vẫn hoạt động như thường.
- **Hoàn tác không giới hạn** (80 bước) cho mọi thao tác, kể cả xoá hết map.
- **Chọn nhiều** bằng cách kéo một vùng, rồi di chuyển / xoay / lật / co giãn
  / đổi loại / xoá cả nhóm cùng lúc. Vùng quét phải **chạm vào đường viền**
  của hình (một đỉnh nằm trong vùng, hoặc một cạnh cắt qua vùng) — cố ý
  *không* tính trường hợp vùng quét nằm lọt trong ruột hình. Nhờ vậy quét
  mấy hình nhỏ nằm trong phần lõm của một polygon lớn sẽ không vơ luôn hình
  lớn; lọc bằng hộp bao không thôi thì lần nào cũng dính, vì hộp bao của
  hình lõm trùm cả chỗ lõm. Điểm đánh dấu (trụ, spawn, bãi quái) tính theo
  vị trí tâm của nó.
- **Căn tâm** (`Shift+C`) — dời **gốc** của hình về trung bình các đỉnh, mà
  hình vẫn đứng yên tại chỗ. Gốc là thứ vô hình cho tới khi nó lệch: nó là
  tâm xoay khi xoay một hình đơn lẻ, là cặp X/Y trong bảng thuộc tính, và là
  chấm xanh giữa hình. Kéo đỉnh vài lượt là gốc trôi ra rìa, xoay một cái
  thấy hình văng đi. Nút hiện sẵn độ lệch hiện tại (`lệch 1167, 1075` /
  `đã căn`) nên biết ngay có cần bấm hay không.

  Dùng **trung bình cộng các đỉnh**, không phải trọng tâm theo diện tích —
  đúng nghĩa "vị trí trung bình của mọi dot". Khác biệt chỉ lộ ra khi một
  cạnh bị chia thành nhiều đỉnh: điểm này sẽ bị kéo về phía cạnh đó.
- **Lật ngang / lật dọc** (`Shift+H` / `Shift+V`, hoặc nút trên toolbar và
  trong bảng thuộc tính). Trục lật luôn là tâm hộp bao của vùng chọn: một
  polygon thì lật tại chỗ, chọn nhiều thì cả cụm đảo bên đồng thời mỗi cái
  tự lật — giống Figma. Dùng được cho cả lane.
- **Lane là đường HAI CHIỀU.** `getLaneWaypoints()` trong `src/game/lanes.ts`
  tự trả bản `.reverse()` cho phe thứ hai, nên **một** `LaneDefinition` phục
  vụ cả hai phe — đó là lý do Proving Grounds chỉ khai một lane `mid` mà hai
  phe đều đi được. Editor vẽ đúng như vậy: mũi tên **hai đầu**, và hai mút
  đường tô theo màu của phe xuất phát ở đầu đó.

  Vì thế bảng thuộc tính **không có ô "từ phe / tới phe"**. Engine không đọc
  hai field ấy (`setActiveLanes` chỉ lấy `id` + `waypoints`); chỗ duy nhất
  đọc là `referenceMap.test.ts`, và nó đọc như một **cặp hai đầu** chứ không
  phải chiều đi. Giá trị của chúng lại bị ràng buộc hoàn toàn bởi quy ước
  waypoint 0 — cho gõ tay chỉ mở đường cho dữ liệu tự mâu thuẫn với hình vẽ.
  Editor hiện `amber ⇄ jade` dạng chỉ-đọc và vẫn xuất đủ `from`/`to`.

- **Đảo chiều lane** — đổi xem **đầu nào là waypoint 0**. Cầu nối phe → team
  là **theo thứ tự** (`preset.ts`: `factions[0]` = BLUE, đi xuôi danh sách),
  nên waypoint 0 bắt buộc nằm ở phía base của phe đầu tiên; vẽ ngược thì lính
  phe đó xuất phát từ base địch. Phần *Kiểm tra* đối chiếu waypoint đầu/cuối
  với điểm hồi sinh và báo ngay.

  Cố ý **không** có nút tạo lane thứ hai đi ngược: thêm một id nữa trên cùng
  con đường sẽ khiến `MinionSpawner` (nó lặp qua *mọi* id trong `LANES`) đẻ
  gấp đôi số wave cho cả hai phe.
- **Vẽ polygon tự do** bằng công cụ bút: nháy từng điểm, `Enter` hoặc chạm
  lại điểm đầu để đóng hình.
- **Lưới & hút điểm** với bước lưới tuỳ chỉnh.
- **Lớp hiển thị** — ẩn/hiện riêng tường, bụi, nước, trụ từng đội.
- **Vòng tròn quanh slot** — mỗi vòng là một con số, và **chọn slot thì mỗi
  vòng tự ghi tên nó ra**. Trụ có ba: thân tô đặc (`size / 2`, chỗ trụ thật sự
  đứng — và cũng là chỗ bấm/kéo được, không còn ô vuông nhỏ ở giữa nữa), vòng
  cam nét đứt (`thân + 19px` — tâm một con lính không vào gần hơn thế, đúng
  con số luật lane trong bảng *Kiểm tra* đang đo), và tầm bắn. Bệ đá vẽ thêm
  **tầm mua đồ** khi map khai `shopRange` khác bán kính bệ. Bãi quái vẽ tầm
  phát hiện và tầm đuổi.
- **Ảnh nền** — dùng ảnh minimap/map LMHT có sẵn, hoặc upload ảnh top-down
  bất kỳ để đồ theo (ảnh được thu nhỏ ≤1600px, nén JPEG, lưu kèm map).
- **Minimap** góc phải, nháy để nhảy camera tới đó.
- **Export cho moba2d** (`Ctrl+E`) — ba dạng đầu ra của cùng một map:
  `MapGeometry` dạng JSON, module `<tên>Geometry.ts`, và module
  `<tên>.ts` (`MapDefinition`) trỏ sang geometry bằng dynamic import. Cả hai
  file `.ts` dán thẳng vào pack được, đã kiểm bằng `tsc` của moba2d-core.

  Dán thẳng hợp với map nhỏ. Map lớn thì dạng `.ts` sai chỗ: `MapGeometry`
  của Summoner's Rift là 38KB dữ liệu, và dữ liệu nằm trong `.ts` thì mỗi lần
  sửa map là một lần đọc diff polygon. Cách còn lại là giữ nguyên file `.json`
  editor tải về (**Lưu file**, có `authoring` nên mở lại sửa được) trong
  `maps/<tên>_map.json` của pack, rồi để `moba2d-generate-maps` cắt ra phần
  người chơi cần — `docs/PACK_AUTHORING.md`, mục *Maps drawn in the editor*.
  `id` trong file export **không bao giờ** đi theo: nó là tên bạn vẽ, không
  phải id của pack, và một lần nó lọt ra `Game.activeMapId` là một map không
  ai join qua LAN được.
- **Export cho MOBA2D (bản cũ)** — vẫn giữ, xuất
  `{wall, brush, water, turret1, turret2}` như trước.
- **Nhập JSON** (`Ctrl+I`) — dán thẳng vào ô, hoặc chọn file. Xem trước
  ngay số polygon từng loại trước khi nhập, và chọn *mở thành map mới* hay
  *thêm vào map đang mở* (gộp thì hoàn tác được bằng `Ctrl+Z`). Nhận mọi
  định dạng từng đi ra khỏi editor này:

  | dạng | ví dụ |
  |---|---|
  | `MapGeometry` moba2d | `{terrain:{wall:[[{x,y}…]]}, slots:{…}, lanes:[…]}` |
  | file "Lưu file" | `{name, mapSize, meta, data:[…]}` |
  | export MOBA2D cũ | `{"wall":[[[x,y]…]], "turret1":[[x,y]]}` |
  | "Export raw" | `{data:[…]}` |
  | mảng terrain trần | `[{type, position, polygon}]` |
  | bản Firebase cũ | `{data:{key:{position:"[x,y]"}}}` |

  Dữ liệu đã export bị cắt sẵn thành mảnh lồi, nên polygon lõm ban đầu quay
  về thành nhiều mảnh rời — toạ độ world thì khớp tuyệt đối. Đã thử với
  geometry thật của Proving Grounds: nhập vào rồi export ra, cả 12 polygon
  tường, 2 bụi, 10 slot và 10 waypoint của lane đều **giống hệt** bản gốc.

## Cấu hình map (chỉ số riêng)

Bảng thuộc tính có mục **Cấu hình map**: sát thương và tầm bắn của trụ, mức
hồi máu ở bệ đá cổ, hệ số máu/sát thương/tầm đuổi của quái rừng, tốc độ đi
trong bụi và dưới sông, thời gian hồi sinh của tướng, và cả **danh sách loại
lính** của riêng map.

**Ô trống = dùng mặc định của core**, và số mặc định hiện mờ ngay trong ô nên
không phải mở mã nguồn engine ra tra. Map không chỉnh gì thì export ra **y hệt
như trước khi có tính năng này** — không có khoá `tuning` nào cả.

Ba tầng, tầng trong thắng: **core → cấu hình map → ghi đè trên từng slot.**
Chọn một cái trụ thì mục *Ghi đè chỉ số* của nó cho phép trụ đó khác mọi trụ
còn lại — đây mới là thứ làm hai map dựng từ cùng bộ phận chơi khác nhau thật
sự. Bãi quái cũng vậy, và ở đó còn có hai ô chữ: **Tính khí** (`aggressive` /
`passive` / `skittish`) để một map cho con cua bình thường hiền lành quay ra
cắn người, và **Kiểu đánh** (`melee` / `ranged` / `breath` / `lash`) để đổi
hẳn hình đòn đánh thường của bãi đó — vuốt cào, phun đạn, phun một nón lửa,
hay quật đuôi. `lash` là cái đi cùng thân đốt: một cái đuôi thật, neo ở mõm
con quái, vung ra tới mục tiêu rồi thu về — con sâu mà đánh bằng ba vệt vuốt
loè ra từ đầu thì trông sai, và đó là chỗ nó sinh ra để vá.

`lash` và `breath` chỉ chạy khi khai thẳng ra. Để trống ô *Kiểu đánh* thì core
tự suy ra từ tầm đánh, và chỉ suy ra hai kiểu: tầm ngắn thì cào, tầm
xa thì phun đạn. Chỉ khai khi câu trả lời tự suy đó sai — trong pack `lol`
đúng một bãi cần khai, là con rồng.

Trong nhóm *Quái rừng* còn có **Trễ hồi máu**: quái vừa ăn đòn thì bao lâu
mới bắt đầu hồi. Mặc định 4000ms. Để 0 là trở lại đúng hành vi cũ — quái đầy
máu lại sau khoảng một giây, vì hồi máu tính theo *frame* chứ không theo
giây. Đây là nút quyết định rừng của map bro có gặm dần qua nhiều lượt được
hay bắt buộc phải dọn một hơi.

### Hình dáng con vật

Mục *Hình dáng con vật* trong bãi quái dựng một con vật bằng mã thay vì bằng
ảnh — số chân, sải chân, chiều gối, rồi kiểu thân (`orb` là một khối tròn,
`chain` là thân nhiều đốt kiểu sâu/rắn/rết). Chọn `chain` thì hiện thêm **ô sửa
cột sống**: kéo từng tay nắm để đổi bề rộng từng đốt, `−`/`+` để thêm bớt đốt,
và ô xem trước bên dưới cho con vật đi thử ngay trong panel.

Cả mục này là **ghi đè** hình con quái mà pack khai, nên nó nằm trong `stats`
cùng mọi ghi đè khác của slot — để trống là giữ nguyên hình pack khai.

Mọi con số trong mục này đều được **kẹp lại, không bao giờ bị từ chối**. Gõ 7
vào ô số chân thì ra 6 chứ không làm hỏng map — đúng một lần trước đây nó đã
làm mất nguyên cái map đang chơi thử. Chỉ những *chữ* core không biết mới bị
từ chối, vì chữ sai thì không đoán ra được ý.

Nút `×` của mục xoá **cả nhánh** rig chứ không xoá từng ô: những thứ như
`rig.legs.spread` hay `rig.body.glow` không có ô nào trong panel, xoá theo ô
sẽ để chúng nằm lại và con vật vẫn không về mặc định. Riêng cột sống có nút
*Cột sống về mặc định* riêng, để "kéo hỏng hình rồi, làm lại" không phải hi
sinh màu và chân đã chỉnh.

Quái rừng ở tầng map là **hệ số nhân** chứ không phải số tuyệt đối: map không
biết pack nào sẽ lấp vào slot của nó, nên "×1.5 sát thương" là câu duy nhất
nói được mà vẫn đúng với mọi pack. Ghi đè trên từng slot thì cho số tuyệt đối,
vì lúc đó bạn đang nhắm đúng một bãi cụ thể trên đúng một map.

**Lính** khác mọi mục còn lại: khai `types` là **thay hẳn** ba loại của core
chứ không trộn vào. Nên có nút *Chép 3 loại mặc định* — map chỉ muốn lính cận
chiến trâu hơn vẫn phải khai đủ ba loại, và nút đó khiến việc ấy là một cú
bấm chứ không phải chép tay 24 con số. Mỗi loại có ô **Kiểu**
(`melee`/`ranged`/`cannon`) tách rời khỏi id: id là tên loại, còn *Kiểu* mới
quyết định nó đánh gần hay bắn xa và vẽ ra sao. Đặt tên `siege` mà quên chọn
Kiểu thì nó đánh như lính cận chiến.

Đội hình wave ở tầng map là một câu cho **cả bản đồ**: mọi lane của mọi phe
đưa ra đúng ngần ấy con. Chọn một **điểm gom lính** thì mục *Ghi đè đội hình*
của nó cho phép riêng điểm đó khác — id các loại lính, cách nhau bằng dấu
phẩy. Đây là thứ làm được "lane trên đẩy bằng xe pháo, lane dưới nhỏ giọt hai
con cận chiến", vốn trước đây không phải một map dựng ra được.

Ô trống = theo đội hình chung của map. Gõ `[]` là một câu **khác hẳn**: điểm
này không ra con lính nào — một lane để bot đi mà không có quân, cũng là một
map hợp lệ. Id nào không có trong `types` của map thì bị bỏ chứ không đổi
thành con khác, và `verify` bên pack chặn ngay từ lúc cài.

**Tầm nhìn** là nhóm ngắn nhất và có lẽ là nhóm đổi lối chơi mạnh nhất. Trong
LMHT, đánh thường hoặc dùng chiêu *nhắm vào một đơn vị* từ trong sương mù sẽ
mở ra một vùng bán kính 300 quanh người đánh, trong 2 giây — nên bụi là chỗ
nấp *bị lộ khi ra tay*, không phải tàng hình. Skillshot thì không lộ.

Hai ô đó là hai con số ấy. Để **0 giây** là bụi thành tàng hình thật: đánh
nhau trong bụi mà không ai thấy, một map toàn hàng rào sẽ thành map phục kích
không có cách gỡ nào ngoài đi vào. Để **5000ms** thì một cú vung tay là một
lời cam kết, và bụi thành chỗ để chờ chứ không phải chỗ để đánh. Vùng bị lộ
quyết định thằng đứng chung bụi có lộ theo không — đó mới là phần cảm nhận rõ
nhất.

Mọi thay đổi ở đây **hoàn tác được** bằng `Ctrl+Z` như mọi thao tác khác.

`tuning` đi cùng tầng với `factions` (`MapSummary.tuning`), nên nó có mặt ở cả
bốn đường ra: lưu nháp, *Chơi thử*, export JSON và export TypeScript — và
`moba2d-generate-maps` đưa nó vào `mapMeta.ts` chứ không vào file geometry.
Chiều ngược lại cũng vậy: mở một map của pack ra sửa thì chỉ số của nó theo
về nguyên vẹn, chứ không bị nuốt mất.

## Sửa map có sẵn

Màn hình **Map của bạn** (`Ctrl+M`) có hai phần: bản nháp của bạn ở trên, và
**Từ game** ở dưới — mọi map game đang cài. Bấm một cái là mở ra **một bản
sao**; bản gốc trong pack không bao giờ bị đụng, vì pack là chỉ-đọc. Tên bản
sao có hậu tố *(bản sửa)*.

Xoá một map ở đây gỡ nó khỏi **cả hai** kho: kho riêng của editor và danh sách
`moba2d-local-maps-v1` mà game đọc. Trước đây chỉ gỡ nửa đầu, nên map đã xoá
vẫn nằm trong picker của game và không có đường nào lấy ra.

Đường đi của danh sách: game gọi `PackRegistry.loadMapGeometry()` cho từng map
(phải await — geometry của pack thường là một `import()` động), rồi ghi cả
danh sách vào `moba2d-pack-maps-v1` trước khi điều hướng sang đây.

Đó là một **catalog**, không phải lời nhắn: đọc bao nhiêu lần cũng được, không
bao giờ xoá, và bản cũ chỉ là tin cũ. Bản đầu tiên của tính năng này là lời
nhắn dùng-một-lần kèm một picker nằm ở menu game — hỏng theo hai cách: hai
danh sách map chứa hai tập khác nhau mà không cái nào thấy cái kia, và cái
picker đó không vừa màn hình điện thoại nằm ngang.

`tests/content/editorCatalog.test.ts` giữ hai nửa khớp nhau: nó chạy code
editor **thật** trong một `vm` rồi ném thứ editor publish ngược qua
`PackRegistry.installData`. Không có type checker nào so được hai bên.

## Chơi thử

**Mở game ở một tab mới**, không điều hướng tại chỗ. Lý do không phải tiện lợi
mà là `History` sống hoàn toàn trong bộ nhớ: rời trang là mất sạch undo. Map
thì vẫn còn (autosave), nhưng mọi bước lùi thì không — và với map mở từ game,
cái mất đó nặng hơn, vì bước gộp tự động cũng là một bước undo, nên đi chơi
thử một vòng là nó thành vĩnh viễn.

Tab mới thì document của editor không bị huỷ: lịch sử còn nguyên, và bạn sửa
tiếp được ngay trong lúc tab game vẫn mở. Popup bị chặn (hiếm, vì đây là cú
bấm của người dùng) thì lùi về điều hướng tại chỗ kèm cảnh báo — mất undo vẫn
hơn là bấm nút mà không có gì xảy ra.

## Về game

Nút **Về game** ở góc trái thanh công cụ, cạnh tên map. Khác **Chơi thử** ở
bên phải: cái này về menu mà không bắt đầu trận nào. Trước đây chỉ có "Chơi
thử", nghĩa là đường duy nhất quay lại game là mở một trận đấu — ai chỉ muốn
về menu thì phải bấm nút Back của trình duyệt.

## Gộp polygon dính nhau

Map từ pack **không** mang theo `authoring`, nên thứ mở ra là dạng đã cắt lồi —
Summoner's Rift là 329 mảnh cho 73 bức tường thật. Sửa đống đó là sửa kết quả
cắt chứ không phải sửa map.

**Map từ game tự gộp ngay lúc mở.** Thiếu `authoring` không phải suy đoán mà là
bằng chứng: `terrain` ở dạng đã cắt vì `TerrainField`/`Vision` của core chỉ
đúng với polygon lồi. Gộp là **một bước undo riêng** ngay sau bước mở, nên một
lần `Ctrl+Z` trả lại các mảnh rời mà vẫn giữ map đang mở. Summoner's Rift vào
editor là 329 mảnh tường ra 69 hình, 26 mảnh nước ra 2 con sông, mất ~240ms.

**Mọi chỗ khác thì chỉ mời.** Map mở từ file hay bản nháp của chính bạn không
có bằng chứng nào như vậy — hình dính cạnh nhau có thể là cố ý. Ở đó bạn được
một thanh gợi ý ("map này có N hình, gộp lại còn M") với nút **Gộp lại**, hoặc
tự chạy **Sửa → Gộp polygon dính nhau** bất cứ lúc nào.

### Vì sao là thư viện chứ không phải mấy chục dòng tự viết

Bản đầu tự viết: chuẩn hoá chiều quấn rồi huỷ từng cặp cạnh ngược chiều, phần
sót lại là biên. Đúng với mọi hình thử tay, đúng cả về **diện tích** trên dữ
liệu thật — và vẫn sai. Ba lần sửa là ba ca mới lộ ra: mối chữ T, đỉnh thắt
nhiều nhánh, rồi cái giết nó hẳn — **các mảnh chồng lên nhau**, mà triệt tiêu
cạnh chỉ đúng khi chúng rời nhau. Ở Sân Thử Nghiệm, dải viền và hai nhánh hành
lang đè nhau đúng 60×100 mỗi bên; kết quả là một vệt chéo cắt ngang map.

`lib/polygon-clipping.min.js` (28KB, Martinez-Rueda) làm đúng việc đó — chồng
lấn, lỗ thủng, mối chữ T. Đây là bài toán đã được giải kỹ từ lâu.

### Và nó vẫn phải tự chứng minh

`Geom.unionCovers` lấy mẫu lưới rồi so "điểm này có nằm trong hình gốc nào
không" với "có nằm trong kết quả gộp không". Viết hoàn toàn từ `pointInPolygon`
và **không dùng lại một dòng nào** của `union` — vì một phép biến đổi tự chấm
bài mình thì luôn đồng ý với chính nó, sai thế nào cũng đồng ý. Không qua được
thì giữ nguyên mảnh gốc: mất một tiện ích còn hơn mất map.

Ba quy tắc, và cả ba là chuyện đúng/sai chứ không phải tuỳ chọn:

- **Chỉ gộp trong cùng một loại.** Bụi nằm sát tường dùng chung cạnh với tường
  y hệt hai mảnh tường dùng chung cạnh, nên nếu chỉ xét hình học thì bụi bị hàn
  vào tường và chỗ nấp lặng lẽ biến thành địa hình.
- **Chính xác, không nới sai số.** Toạ độ trong các map này đều nguyên và các
  mảnh cắt dùng chung cạnh khít từng đỉnh, nên cạnh trong = cạnh được hai mảnh
  đi qua ngược chiều nhau; huỷ từng cặp là ra đúng đường viền. Nghĩa là hai bức
  tường chỉ *đi ngang* qua nhau không bao giờ bị hàn nhầm.
- **Hình quây quanh khoảng trống thì giữ nguyên.** Một terrain chỉ mang một
  vòng, nên ép bốn bức tường quanh một cái sân thành một hình sẽ lấp mất cái
  sân. Chỉ nhóm nào sinh ra lỗ mới bị bỏ qua; phần còn lại của map vẫn gộp.

## Cấu trúc mã

Không dùng framework. Trước đây là các file `.js` thường nạp theo thứ tự;
giờ là TypeScript trong `src/mapEditor/`, build bằng Vite qua entry thứ hai
`map-editor/index.html`, và được typecheck chung với phần còn lại của `src/`
— tức là **import thẳng được module của core** (`ui.ts` đang lấy
`TUNING_SCHEMA` từ `@/game/config/tuningSchema`), thay vì chép hằng số sang.

| file | việc |
|---|---|
| `src/mapEditor/geom.ts` | toán hình học: point-in-polygon, AABB, xoay/co giãn, cắt lồi |
| `src/mapEditor/state.ts` | bảng loại đối tượng, trạng thái, camera, vùng chọn, hit-test, undo/redo |
| `src/mapEditor/storage.ts` | localStorage nhiều map, đọc/ghi file, export/import, kiểm tra |
| `src/mapEditor/render.ts` | vẽ bằng Canvas2D, vẽ theo yêu cầu |
| `src/mapEditor/ui.ts` | thanh công cụ, bảng thuộc tính, hộp thoại, toast |
| `src/mapEditor/commands.ts` | sổ đăng ký lệnh (nút + phím tắt + menu dùng chung) |
| `src/mapEditor/input.ts` | pointer/bàn phím/cử chỉ chạm |
| `src/mapEditor/mapRules.ts` | bộ luật kiểm tra map trước khi xuất |
| `src/mapEditor/frame.ts` | gom lời gọi vẽ lại thành một frame |
| `src/mapEditor/vendor.d.ts` | khai kiểu cho hai lib nạp bằng `<script>` |
| `src/mapEditor/main.ts` | khởi động |

Phần tĩnh vẫn nằm ở `public/map-editor/`: `css/style.css`, ảnh nền để can
map trong `asset/`, và hai lib trong `lib/` — cố ý để ngoài module graph vì
chúng phải chạy được offline, không cần build.

Thư viện ngoài duy nhất còn lại là `lib/decomp.min.js` (5KB) để cắt polygon
lõm thành các mảnh lồi cho game. Bản trước dùng p5.js + SAT.js +
SweetAlert2 (~900KB); tất cả đã được thay bằng Canvas2D thuần, ray-casting
và hộp thoại tự viết.

Vài điểm về hiệu năng, nếu cần sửa tiếp:

- Canvas chỉ vẽ lại khi có thay đổi (`requestRender()`), đứng yên là 0% CPU.
- Mỗi terrain giữ sẵn AABB và `Path2D`; chỉ tính lại khi hình thật sự đổi.
- Convex-decomposition chạy khi thả tay, không phải mỗi frame.
- Hit-test lọc bằng AABB trước rồi mới ray-cast, và bỏ qua polygon ngoài
  khung nhìn khi vẽ.
- Autosave gộp các thay đổi liên tiếp (debounce), và luôn ghi nốt khi đóng
  tab.
- Khung nhìn nằm ở khoá `…-views` riêng, không nhét trong bản ghi map: kéo
  map một cái là camera đổi hàng trăm lần, ghi lại cả bản ghi (kèm ảnh nền
  dạng data URL) mỗi lần thì đơ ngay. Đo thực tế: ~200 lần đổi camera → ghi
  đúng **1 lần**, và bản ghi map không bị đụng tới. Giá trị hỏng hoặc lạc ra
  ngoài map thì tự canh lại cho vừa màn hình.
