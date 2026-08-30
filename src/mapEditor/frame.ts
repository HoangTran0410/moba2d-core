/* =========================================================================
   frame.ts — "vẽ lại đi", tách riêng khỏi renderer.

   Chỉ có một hàm, và nó ở đây vì lý do vòng lặp import chứ không phải vì
   kiến trúc: `state` cần gọi vẽ lại sau mỗi thay đổi, còn `render` cần đọc
   `TYPES`/`TYPE_INFO` của `state` NGAY LÚC nạp module để dựng bảng màu. Hai
   chiều đó tạo thành vòng, và với ESM thì vòng không phải lỗi — nó chỉ có
   nghĩa là một trong hai module chạy khi module kia còn dở, và `TYPES` khi đó
   là `undefined`.

   Hồi editor còn là chín thẻ `<script>` cổ điển, thứ tự nạp trong HTML giải
   quyết việc này: `state.js` chạy xong hẳn rồi mới tới `render.js`. Thứ tự ấy
   không được viết ở đâu ngoài danh sách thẻ script. Giờ nó là đồ thị import,
   và đây là chỗ cắt nó.
   ========================================================================= */

/**
 * Xin một khung hình. Mặc định là no-op — `Renderer.init()` thay nó bằng bản
 * thật, nên mọi lời gọi trước khi canvas dựng xong đều rơi vào khoảng không
 * thay vì nổ.
 */
export let requestRender: () => void = () => {};

/** `Renderer.init()` gọi đúng một lần. */
export function setRequestRender(fn: () => void): void {
  requestRender = fn;
}
