# Ghim bản cài pack và cập nhật tường minh

**Trạng thái:** đã triển khai và kiểm chứng trong trình duyệt thật
**Tiền đề:** `2026-08-24-runtime-pack-loading-design.md` (GĐ2 — nạp pack lúc chạy)

## 1. Sự cố khởi nguồn

Chơi thử trên localhost, sau khi pack riot được publish lại:

```
GET https://hoangtran99.is-a.dev/moba2d-content-riot/chunks/Rammus_Q-BAVrwTdL.js
    net::ERR_ABORTED 404 (Not Found)
```

Chiêu thức của Rammus lặng lẽ trở thành đòn đánh thường. Không cảnh báo, không
thông báo, không thanh tiến trình nào dừng lại. Người chơi thấy một con tướng
bấm Q không ra gì; chỉ khi mở console mới thấy dòng đỏ, và phải là người viết
game mới hiểu dòng đó nói gì.

Đây không phải một lỗi. Đây là ba lỗi xếp chồng, và mỗi cái tự nó đã đủ.

## 2. Nguyên nhân

### 2.1. `pack.js` là tên khả biến duy nhất trong cả pack

```
pack.js                              ← tên cố định, nội dung thay đổi, max-age=600
  └ chunks/runtime-entry-DW1RB1VJ.js ← hash nội dung
      └ chunks/Rammus_Q-BvkC2xQD.js  ← hash nội dung
```

Mọi thứ dưới `pack.js` được ghim bằng hash. Bản thân `pack.js` thì không, và
nội dung nó thay đổi mỗi lần build. Ba tệp này là ba mục cache độc lập, hết hạn
độc lập — **không có gì buộc entry với đồ thị chunk mà nó trỏ tới.**

Một cache giữ `pack.js` cũ qua một lần publish sẽ đọc ra `runtime-entry` cũ,
đọc ra tên lá cũ, rồi ra mạng xin một tệp server đã xoá. Lá nào đã nằm sẵn
trong cache thì vẫn chạy; lá nào chưa từng được tải thì 404. Vì thế lỗi này là
một cuộc đua, không phải trạng thái ổn định, và vì thế nó lúc có lúc không.

**Deploy chỉ giữ đúng một build.** Không có kho lưu bản cũ để lùi về. Nên bản
chụp cục bộ đầy đủ là hình thức bảo vệ duy nhất có thật.

### 2.2. Trên prod, một pack đã cài không bao giờ update được

`src/sw.ts` đăng ký `CacheFirst` cho mọi URL bắt đầu bằng base của pack.
`manifest.json` nằm trong base đó. Lần fetch đầu ghi nó vào cache và từ đó
manifest bị **đóng băng vĩnh viễn**. `runtimePacks.ts` fetch lại manifest mỗi
lần boot và luôn nhận về bản cũ.

Hệ quả kép: pack không nhận được build mới, và mọi tệp mà lần prefetch đầu
bỏ lỡ sẽ 404 mãi mãi.

### 2.3. Không có gì nhận dạng được một build

`manifest.version` là `"1.0.0"` — hardcode trong template scaffold, chưa từng
đổi qua hàng chục lần publish. `InstalledPackRecord.version` mang comment *"so
an update can be noticed later"*, nhưng không ai đọc nó, và có đọc cũng vô
nghĩa.

Bài học ghi lại: **một con số phải do người nhớ bump thì sẽ không được bump.**
Danh tính build phải được suy ra.

### 2.4. Sự im lặng — fallback đúng, đặt nhầm chỗ

`spellRegistry.ts` bắt lỗi nạp, ghi `console.error`, rồi vẫn gọi `onSettled(id)`
nên thanh tiến trình vẫn chạy đủ. Sau đó `preset.ts`:

```ts
const classForId = (id: string): SpellClass => spellClassOfId(id) ?? BasicAttack;
```

Fallback này **đúng** với lý do nó được viết: một slot `localStorage` cũ trỏ
tới spell build này đã bỏ, hoặc re-roll giữa trận khi chunk chưa kịp về. Cả hai
đều không đáng báo động.

Lỗi là **một pack hỏng và một id lạc đi chung một đường code.** Cái thứ hai
đáng im lặng; cái thứ nhất thì không, và nó đang mượn sự im lặng của cái kia.

## 3. Bất biến

> **Pack đã cài là một bản chụp được ghim, nhận dạng bằng build id. Boot không
> hỏi mạng. Cập nhật là hành động tường minh, có hỏi.**

## 4. Thiết kế

### 4.1. `buildId` — danh tính build, suy ra chứ không khai báo

Manifest thêm trường `buildId`: hash ngắn trên danh sách `files` đã sắp xếp, do
script sinh manifest tự tính. Đổi đúng khi và chỉ khi có hash nội dung nào đổi.

`version` giữ nguyên nghĩa semver cho người đọc, và không tham gia vào việc
phát hiện bản cũ.

Không tính hash trên nội dung `pack.js`: entry là một facade 86 byte có thể
không đổi giữa hai build khác nhau. Danh sách tệp mới là lời khai đầy đủ về
những gì build chứa.

### 4.2. Buộc entry vào build

Core phân giải entry rồi gắn `?b=<buildId>`:

```
pack.js  →  pack.js?b=a1b2c3d4e5f6
```

Query đổi theo build, nên HTTP cache lẫn SW cache đều không thể phục vụ
`pack.js` cũ cho một manifest mới — hai build là hai URL khác nhau. Dynamic
import tương đối phân giải theo path và bỏ qua query, nên đồ thị chunk bên dưới
không đổi gì. Output của Rollup không phải sửa.

Manifest không có `buildId` thì không gắn query — pack cũ chạy y như trước.

### 4.3. Hai phép đọc manifest, hai ý định

Bỏ URL manifest ra khỏi route `CacheFirst`. Page thông báo cho worker cả
`bases` lẫn `manifests`; worker loại trừ đúng các URL manifest.

- **Boot** đọc manifest đã ghim thẳng từ `caches.match()`. Không qua mạng, chạy
  offline, miễn nhiễm với việc server đổi bên dưới.
- **Kiểm tra cập nhật** fetch thẳng từ mạng với `cache: 'no-store'`.

Cài đặt ghi manifest vào pack cache bằng `cache.put()`, nên bản ghim tồn tại
độc lập với chiến lược nào của worker.

Trước đây cả hai ý định dùng chung một `fetch()` và để chiến lược của worker
quyết định — đó chính là chỗ sinh ra 2.2.

### 4.4. Hai tín hiệu "đã cũ"

1. **buildId mạng ≠ buildId đã ghim** — kiểm tra nền sau khi menu đã mở. Kệ
   sách gắn nhãn "Có bản mới".
2. **404 trên một tệp chính manifest liệt kê** — đây là bằng chứng, không phải
   suy đoán: build đã ghim không còn tồn tại trên server và không thể hoàn tất
   được nữa. Phân biệt với lỗi mạng, vốn chỉ có nghĩa là "thử lại sau".

### 4.5. Cài đặt: chơi ngay, ghim ngầm, tự vá

Pack chơi được ngay khi entry import xong. 592 tệp tải nền như hiện nay. Mỗi
lần boot, tệp nào còn thiếu thì tải tiếp — danh sách thiếu **suy ra** từ một
lần `cache.keys()` so với `manifest.files`, không lưu trong `localStorage`.

Có một cửa sổ ngắn sau khi cài mà pack còn phụ thuộc mạng. Chấp nhận được:
server của một bản vừa cài, theo định nghĩa, là bản mới nhất. Lỗi 404 chỉ xảy
ra với bản cài **cũ và thiếu**, và 4.4 bắt đúng ca đó.

Phương án bị loại: chặn màn hình xác nhận cho tới khi tải đủ 4.7MB. Đảm bảo
mạnh hơn, nhưng pack mặc định được seed lúc boot đầu tiên sẽ chặn menu mất
4.7MB, và cứu nó lại đòi một đường cài thứ hai với ngữ nghĩa khác — đúng kiểu
phân nhánh mà dự án này đã trả giá nhiều lần.

### 4.6. Hỏng thì phải nói

`loadSpells` trả về những id không nạp được. Phần nạp kit trước trận phân biệt
được hai ca mà 2.4 gộp làm một:

- id không có trong registry → im lặng, `BasicAttack`, đúng như cũ;
- id **có** trong registry nhưng module không về → pack hỏng, nói ra.

Thông báo nêu tên pack và mời cập nhật. Không bao giờ tự tải sau lưng người
chơi: pack là code của người lạ chạy với toàn quyền của trang, và spec GĐ2 §2.1
đã ghi việc không tự ý đổi nó là lựa chọn có chủ đích.

## 5. Giới hạn đã biết

`vite.config.ts` đặt `devOptions.enabled: false`, nên dev không có service
worker và không có phần ghim. §4.2 và §4.4 vẫn chạy ở dev — và §4.2 chính là
thứ sửa đúng sự cố đã khởi nguồn tài liệu này. §4.3, §4.5 chỉ có tác dụng ở bản
build.

## 6. Việc triển khai bổ sung ba điều

Ghi lại vì cả ba đều trái với dự đoán khi viết thiết kế.

### 6.1. Bản cài cũ tự lành, không cần bị nhắc

§4.4 định gắn nhãn "có bản mới" cho mọi record không có `buildId`. Thực tế
không cần: record không có bản ghim thì boot đi fetch, ghim lại, và ghi đúng
`buildId` hiện hành — từ đó URL entry có tên build và lỗi 404 không tái diễn
được nữa. Người chơi cũ được sửa trong đúng một lần khởi động, im lặng.
`checkPackUpdates` vẫn giữ luật "không ghim mà host có" vì nó đúng ở tầng hàm;
đường boot chỉ đơn giản không bao giờ để nó xảy ra.

### 6.2. `ignoreSearch` trông như bản sửa và là lỗi

Prefetch cache entry dưới tên `pack.js`; game import `pack.js?b=<buildId>`. Hai
địa chỉ khác nhau, nên bản prefetch của entry là rác. Nhìn thì đúng là offline
mất đúng tệp mà cả pack treo lên đó.

Chạy `verify-pwa-offline.mjs` với tuỳ chọn bị gỡ cho thấy offline chưa bao giờ
cần nó: **cài một pack chính là fetch entry của nó**, cú fetch ấy đi qua đúng
route này, và `CacheFirst` lưu lại thứ nó vừa fetch — kèm query.

Và bật nó lên sẽ mở lại đúng lỗi cũ. Một trình duyệt bị xoá `localStorage`
nhưng còn `CacheStorage` thì không có bản ghim và có `pack.js` cũ; boot fetch
manifest mới, import `pack.js?b=<mới>`, và `ignoreSearch` sẽ trả về entry **cũ**
— đồ thị chunk cũ sau một manifest mới, đúng cú 404 khởi nguồn. 86 byte lãng
phí là cái giá rẻ hơn.

### 6.3. Host chết không còn là mất pack

Hệ quả không định trước của §4.3, và là thứ tốt nhất trong cả thay đổi này. Boot
đọc bản ghim và không hỏi mạng, nên một host không truy cập được **không tốn gì
cả** — không menu, không roster. `verify-runtime-pack.mjs` trước đây khẳng định
điều ngược lại, và điều ngược lại từng đúng. Nay nó kiểm tra cả hai ca: đã ghim
thì sống sót, chưa ghim thì vẫn hiện banner như cũ.

## 7. Điều phải chứng minh được

- Manifest mới + `pack.js` cũ trong HTTP cache không còn nạp được đồ thị cũ.
- Manifest **không** được phục vụ từ `CacheFirst`.
- Boot đọc được manifest đã ghim khi mạng tắt.
- 404 trên tệp manifest liệt kê đánh dấu pack là cũ; lỗi mạng thì không.
- Một chiêu trong kit không nạp được thì hiện ra màn hình, không chỉ console.
- Một id lạ vẫn im lặng rơi về `BasicAttack`.

Tất cả đã chạy: `npm run e2e:stale` (15/15), `npm run e2e:pwa`,
`npm run e2e:runtime-pack`, `npm run e2e:packs`, `npm run verify`.
