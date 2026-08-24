# Nạp pack lúc chạy — Giai đoạn 2

Trạng thái: **design đã duyệt, chờ plan**.

Tiền thân: `2026-08-20-content-pack-extraction-design.md` (GĐ1, pack tiêu thụ ở
build-time) và `2026-08-23-pack-sdk-and-repo-split-design.md` (tách repo). GĐ1
đã xong và đang chạy: `moba2d-core` là engine không chở content,
`moba2d-content-riot` là repo riêng, và bản deploy hiện ghép hai nửa **lúc build**
trong CI.

Tài liệu này thay cách ghép đó bằng cách nạp **lúc chạy**, từ một URL.

## 1. Mục tiêu

Người chơi dán một URL, game tải pack về và chơi được — mô hình Stremio, đúng
câu §1 của spec GĐ1 đã đặt ra làm đích.

Thành công đo được bằng: xoá bước ghép trong CI của core, mà bản deploy vẫn có
đủ 58 tướng, và một pack thứ hai do người khác host cài được mà không cần đụng
vào core.

## 2. Bốn quyết định đã chốt

Ghi lại vì mỗi cái loại bỏ hẳn một nhánh thiết kế.

| # | Quyết định | Hệ quả |
|---|---|---|
| 1 | **Core ship rỗng, tự cài pack mặc định lần đầu** | Bước ghép trong CI biến mất. Đường runtime thành đường sống chết, không có bản build-time để núp. |
| 2 | **URL nào cũng cài được — mở hoàn toàn** | Không allowlist, không CSP giới hạn origin. Pack chạy với toàn quyền trên trang. |
| 3 | **Pack là một thư mục ở base URL**, không phải một file | Giữ được 237 dynamic import và chunk theo tướng. Xuất bản là đẩy một thư mục. |
| 4 | **Tải hỏng thì chơi tạm với Vera + băng báo** | Không có màn hình chết. Fallback không phải code mới — xem §5. |

### 2.1 Quyết định 2 nói rõ ra là gì

Pack là **code**, không phải dữ liệu. Addon Stremio là dịch vụ HTTP trả JSON;
pack ở đây là JavaScript chạy trong trang của người chơi, cùng origin với game,
cùng `localStorage`, cùng DOM. Một pack độc đọc được cấu hình, đổi được giao
diện, gửi được dữ liệu đi.

`validate.ts` **không** chặn việc đó. Nó chặn pack *sai hình dạng* — thiếu
field, sai kiểu, id trùng — chứ không chặn pack *cố ý xấu*.

Quyết định là mở, đã được nêu rủi ro trước khi chốt. Cái spec này làm được, và
làm, là khiến người bấm cài **biết mình đang tin ai**: §7 mô tả màn xác nhận nêu
origin trước khi một dòng code lạ nào chạy. Đó là giảm nhẹ, không phải phòng
thủ. Sandbox thật (Worker/iframe) đã bị loại vì spell vẽ thẳng bằng p5 global,
qua worker thì không vẽ được — muốn sandbox phải thiết kế lại cách pack vẽ, và
đó là một spec khác.

## 3. Pack ở một URL

```
https://host/pack/
  manifest.json        siêu dữ liệu, JSON thuần
  pack.js              entry ESM, export default là factory
  spell-<champ>-*.js   các chunk tách ra, tải theo trận
  assets/…             art, URL tương đối so với base
```

`manifest.json`:

```json
{
  "id": "riot",
  "version": "1.0.0",
  "coreRange": ">=1.0.0",
  "name": "Riot champions",
  "entry": "pack.js",
  "assets": "assets/",
  "champions": 58
}
```

`id`, `version`, `coreRange` trùng đúng ba field `PackManifest` trong
`src/content/ContentPack.ts` đã khai — không đặt ra khái niệm mới. `name` và
`champions` chỉ để màn xác nhận có gì hiển thị. `entry` và `assets` là đường dẫn
**tương đối so với chính manifest**, nên đổi host không phải sửa manifest.

### 3.1 `files` — cái GĐ2 thêm vào

`manifest.json` có thêm một trường **tuỳ chọn**:

```json
"files": ["pack.js", "chunks/Ahri_Q-abc123.js", "assets/ahri-def456.png", "…"]
```

Mọi đường dẫn tương đối so với chính manifest, dấu `/`, đã sắp xếp, không kể
`manifest.json`.

Vì sao cần: §6 nói prefetch nền "kéo hết chunk vào cache", mà một host tĩnh
không có listing thư mục — không có danh sách thì prefetch chỉ cache được đúng
những gì trận đấu vừa hỏi, tức đúng tướng người chơi đã có. 237 tướng chưa chơi
mới là chỗ offline hỏng.

Tuỳ chọn, không bắt buộc: pack không khai `files` vẫn cài, vẫn chơi online bình
thường, chỉ là không có gì được kéo trước. Đo trên pack thật: 238 chunk, 351
asset, 1 entry — 590 mục, ~21KB JSON trước gzip.

**Vì sao manifest tách khỏi bundle.** Ba bước, và ranh giới nằm giữa bước 2 và 3:

1. `fetch(manifestUrl)` — JSON thuần, chưa chạy code nào
2. kiểm `coreRange`, hiện màn xác nhận nêu origin — vẫn chưa chạy code nào
3. `import(new URL(entry, manifestUrl))` — từ đây code lạ chạy

Gộp manifest vào bundle thì bước 1 và 2 không tồn tại: muốn biết pack tên gì
phải chạy nó rồi.

## 4. `import(blobUrl)` là sai — sửa lại mệnh đề của GĐ1

Spec GĐ1 §9.1 viết cơ chế GĐ2 là:

```
GĐ2  fetch → import(blobUrl) → cache
```

**Mệnh đề này sai và không được kế thừa.** Một module nạp từ `blob:` giải mọi
specifier tương đối theo chính URL blob, mà blob không có đường dẫn — nên
`./spell-ahri.js` bên trong entry không giải được. Toàn bộ 237 dynamic import
của pack chết, và pack buộc phải là một bundle phẳng: đúng hướng quyết định 3
loại bỏ.

Cơ chế đúng là `import()` **thẳng URL https**:

```ts
const { default: factory } = await import(/* @vite-ignore */ entryUrl);
```

Đổi lại, core không còn cầm việc cache — nó rơi về service worker (§6).

**Đây là giả định load-bearing duy nhất của cả thiết kế, nên nó là Task 1 của
plan**: một spike trong trình duyệt thật, chứng minh `import()` chéo origin giữ
được dynamic import tương đối và `import.meta.url` trỏ đúng base. Nếu sai thì
hướng 3 sai và cả spec này phải viết lại — biết ở task 1 rẻ hơn biết ở task 9.

## 5. Đường khởi động

Hình dạng hiện tại, đo trong `src/main.ts` và `src/content/registry.ts`:

```
setup()      → contentRegistry()        ĐỒNG BỘ. core + reference pack live
             → mgr.showScene(LoadingScene)
LoadingScene → tải asset, rồi bàn giao cho menu
```

`contentRegistry()` là "warm call" cố ý đặt trong cửa sổ của màn hình tải, và
`LoadingScene` **vốn đã là cổng bất đồng bộ** — nó từng `await
AssetManager.ensure('json_summoner_map')` ngay chỗ đó (comment còn nguyên ở
`LoadingScene.ts:39`).

Nên GĐ2 **không chèn pha chờ mới**. Nó dùng lại pha đã có:

```
setup()       → contentRegistry()   đồng bộ, không đổi
LoadingScene  → đọc danh sách pack đã cài (localStorage)
              → lần đầu, danh sách rỗng: gieo URL mặc định
              → với mỗi pack: fetch manifest → import entry → install
              → dựng lại registry
              → menu
```

### 5.1 Vì sao fallback Vera không tốn dòng code nào

Sau `setup()`, trước khi bước async chạy xong, game **đã ở đúng trạng thái
fallback**: core + reference pack, một tướng, chơi được. Quyết định 4 không mô
tả một nhánh lỗi phải viết; nó mô tả *trạng thái mặc định*. Nhánh lỗi chỉ cần
làm một việc: đừng ném, và giương băng báo.

Đây cũng là lý do `e2e:core-alone` (13 check, đang chạy trong CI) trở thành phép
kiểm cho đường fallback mà không phải sửa gì: nó đã kiểm đúng trạng thái đó.

### 5.2 Cài xong không reload trang

`resetContentRegistryForTests()` trong `registry.ts` đã làm đúng động tác cần:
vứt registry, dựng lại cả hai nửa. Nó chỉ cần một cái tên không mang chữ
`ForTests` và một chỗ gọi công khai.

## 6. Lưu trữ và offline

Hai thứ, khác bản chất:

| Thứ | Ở đâu | Vì sao |
|---|---|---|
| Danh sách URL đã cài | `localStorage`, khoá `lol2d:packs:v1` | Vài trăm byte, phải đọc đồng bộ ngay lúc boot |
| Bytes của pack | Cache của service worker | Vài MB, phải sống sót offline |

Tiền lệ đã chạy trong repo — luật Font Awesome trong `vite.config.ts`:

```js
urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
handler: 'CacheFirst',
cacheableResponse: { statuses: [0, 200] },   // opaque cross-origin
```

Hai chỗ khó, cả hai đều thật:

**Pattern phải động.** `generateSW` cần `urlPattern` lúc build; URL pack thì tuỳ
ý. Quyết định: **chuyển sang `injectManifest`** và tự viết service worker. Pack
đáng có logic cache riêng, không nên nhét vào một regex bắt rộng mọi request
chéo origin — luật quá rộng sẽ nuốt cả những thứ không định cache.

**Chunk lazy thủng offline.** Chính thứ tiết kiệm 17× lúc online lại là lỗ hổng:
chunk của tướng chưa từng chơi thì chưa từng fetch, nên chưa từng vào cache.
Trận offline đầu chỉ chơi được tướng đã từng tải.

Chữa bằng **prefetch nền sau khi cài xong**: kéo hết 1.2 MB chunk vào cache,
không chặn màn hình. Trả đúng cái giá hướng "một bundle" đòi, nhưng trả sau lưng
người chơi thay vì trước mặt.

### 6.1 Không có CSP, và không thêm

Repo hiện **không đặt CSP ở đâu cả** — không trong `index.html`, không trong
`vite.config.ts`. Nên `import()` chéo origin chạy được ngay, và phần spec GĐ1 lo
nhất lại là phần không tốn gì.

Không thêm CSP, vì quyết định 2 là mở: một CSP giới hạn `script-src` theo origin
chính là allowlist đã bị loại.

## 7. Màn hình quản lý pack

**Không phải tab thứ tư của panel cấu hình.** `CLAUDE.md` ghi ràng buộc đo được:
*"A fourth will not fit: `.pregame-tab` is `flex: 1` and 390px holds three plus
the close button."* Đây là **màn hình riêng, vào từ menu**.

Bốn việc:

1. **Danh sách pack đã cài** — id, phiên bản, origin, dung lượng cache
2. **Thêm bằng URL** — ô dán manifest URL
3. **Gỡ** — xoá khỏi danh sách và xoá cache của nó
4. **Xác nhận trước khi chạy** — bước 2 của §3

Màn xác nhận là chỗ quyết định 2 được trả giá, nên nó phải nêu, theo thứ tự nổi
bật: **origin** (to, rõ, không rút gọn), tên và phiên bản pack, kết quả kiểm
`coreRange`, và một câu nói thẳng rằng pack sẽ chạy với toàn quyền trên trang.

Băng báo lỗi (quyết định 4) sống ở menu, có nút thử lại, và không tự tắt — người
chơi phải bỏ qua nó một cách chủ động, vì một game thiếu 58 tướng mà im lặng thì
đọc như game hỏng.

## 8. Repo pack phải thêm gì

Hôm nay `moba2d-content-riot` ship **TypeScript thô**: không `build`, không
bundler config, `main` và `exports` đều không có. Đó là lý do core phải
`optimizeDeps.exclude` nó.

Thêm hai thứ:

| Lệnh | Sinh ra |
|---|---|
| `build` | Rollup/Vite library mode, `format: 'es'`, code splitting bật, core `external` → `dist/pack.js` + các chunk + `manifest.json` |
| deploy | GitHub Pages của chính repo pack, phục vụ `dist/` |

`coreRange` trong manifest sinh từ `devDependencies['@moba2d/core']` lúc build,
không viết tay.

Pack repo đã có CI xanh chạy `verify`; thêm một job build + deploy vào đó.

## 9. Cái gì đổi ở đâu

**Core:**

| File | Đổi gì |
|---|---|
| `src/content/install.ts` | Thêm đường async: nhận factory đã `import()` về, install như hiện tại. Nửa dưới không đổi. |
| `src/content/registry.ts` | `resetContentRegistryForTests` → tên công khai, dùng để dựng lại sau khi cài |
| `src/content/packSource.ts` *(mới)* | fetch manifest, kiểm `coreRange`, `import()` entry, trả factory. Toàn bộ phần "nói chuyện với mạng" ở đúng một file. |
| `src/content/installedPackStore.ts` *(mới)* | đọc/ghi `lol2d:packs:v1` |
| `src/scenes/LoadingScene.ts` | await bước cài, nuốt lỗi, bật băng báo |
| `src/scenes/packs/*` *(mới)* | màn hình §7 |
| `vite.config.ts` | `generateSW` → `injectManifest`; bỏ `optimizeDeps.exclude` khi pack không còn là dependency |
| `src/sw.ts` *(mới)* | service worker tự viết, cache pack |
| `.github/workflows/build.yml` | **xoá** bước "Build the published game — core plus the content pack" |

**Pack:** `build` + `manifest.json` + deploy (§8).

## 10. Kiểm chứng

Mỗi nửa tự chứng minh, và phần ghép có phép kiểm riêng — bài học đắt nhất của
đợt tách repo là *không bên nào nhìn thấy phần ghép*, và lỗi `?raw`/esbuild đã
sống đúng ở đó.

| Tầng | Kiểm cái gì | Bằng gì |
|---|---|---|
| Spike (Task 1) | `import()` chéo origin giữ dynamic import tương đối | Playwright, trình duyệt thật, trước mọi thứ khác |
| Vitest | `packSource` xử lý manifest sai, `coreRange` lệch, mạng hỏng | Unit, `fetch` giả |
| Vitest | `installedPackStore` đọc/ghi, dữ liệu rác | Unit |
| e2e | Cài từ URL thật → roster từ 1 lên 59 | Playwright, pack phục vụ từ server tạm |
| e2e | Tải hỏng → menu vẫn mở, băng báo hiện, chơi được Vera | Playwright, chặn request |
| e2e | Offline lần hai vẫn chơi được tướng đã tải | `verify-pwa-offline.mjs` mở rộng |
| e2e | `e2e:core-alone` giữ nguyên | Đã có, là phép kiểm đường fallback |

## 11. Thứ tự thi hành

1. **Spike**: chứng minh §4 — không có nó thì mọi thứ dưới đây vô nghĩa
2. Pack repo: `build` + `manifest.json` + deploy lên Pages
3. Core: `packSource.ts` + `installedPackStore.ts` + test Vitest
4. Core: `install.ts` đường async + `registry.ts` đổi tên
5. Core: `LoadingScene` await + băng báo + e2e đường hỏng
6. Core: `injectManifest` + `sw.ts` + prefetch nền + e2e offline
7. Core: màn hình quản lý pack
8. Core: xoá bước ghép trong CI, đổi URL mặc định sang Pages của pack

Bước 8 là chỗ GĐ1 chính thức nghỉ. Trước nó, hai đường cùng tồn tại và bản
deploy không bao giờ tệ hơn hôm nay.
