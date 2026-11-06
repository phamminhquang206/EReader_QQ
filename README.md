# Kệ Sách

PWA đọc sách và truyện cá nhân bằng tiếng Việt. React + TypeScript + Vite; không cần tài khoản hoặc backend. File sách không được tải lên server.

## Chạy local

Yêu cầu Node.js 22.12+ (hoặc 24+) và pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Vite xử lý TSX trực tiếp, không chèn React Refresh inline để giữ Content Security Policy nghiêm ngặt.

Kiểm tra PWA/offline bằng bản production:

```sh
pnpm build
pnpm preview
```

Mở URL do terminal hiển thị. Chờ tải xong lần đầu trước khi ngắt mạng. Service worker không bật trong chế độ dev. Các file font/CMap/WASM của PDF.js được sao chép từ dependency khi Vite chạy, không lấy từ CDN.

Các parser được gộp vào bundle chính để app iPhone không phải tải thêm module JavaScript khi quay lại từ bộ chọn file hoặc sau một lần deploy. PDF worker vẫn là asset riêng và được cache offline. Bộ chọn sách cho phép chọn mọi loại file để iOS không làm mờ MOBI/AZW3 chưa có liên kết loại file; app kiểm tra đuôi và chữ ký nội dung trước khi nhập.

Với app đã thêm vào màn hình chính, khi quay lại app có mạng, app kiểm tra bản cập nhật và hiện **Cập nhật ngay** ở thư viện. Sau khi deploy bản mới, cập nhật rồi chọn lại file nếu lần nhập trước thất bại.

## Tính năng

- Nhập nhiều EPUB, MOBI, AZW3, PDF; lấy metadata và bìa; phát hiện file trùng bằng SHA-256. Giới hạn 300 MB/file.
- Tìm theo tên/tác giả; sắp xếp; trạng thái đọc; bộ sưu tập tự tạo. Thư viện hiển thị lưới/danh sách, có nền sáng/tối.
- EPUB/MOBI/AZW3 chữ: lật trang hoặc cuộn dọc, mục lục, font/cỡ chữ/khoảng dòng, highlight ba màu, ghi chú và bookmark.
- Font có chân dùng Noto Serif đầy đủ dấu tiếng Việt, gồm bản thường, nghiêng, đậm và đậm nghiêng. Font được đóng gói và cache offline; không phụ thuộc Georgia cài trên máy. Giữ nguyên văn bản NFC/NFD và vị trí annotation.
- EPUB/MOBI/AZW3 cố định: trang đơn/đôi theo bề rộng, cuộn dọc, thu phóng, hướng đọc, bookmark và ghi chú theo trang; highlight khi chọn được chữ.
- Trang truyện chỉ có một ảnh tự vừa khung đọc theo kích thước ảnh gốc, bỏ khoảng trống do viewport của nhà xuất bản. Khi phóng to, kéo để xem ảnh; vuốt tiếp ở mép trái/phải để chuyển trang. Chạm giữa trang khi chưa zoom để ẩn/hiện thanh công cụ.
- PDF: lật trang/cuộn dọc, thu phóng, trang đôi, mục lục nếu có, bookmark và vị trí đọc. **Không có highlight hoặc ghi chú PDF.**
- Chuyển trang khoảng 650 ms: sách chữ trượt mượt; truyện/PDF mờ nhẹ và trượt vào sau khi nội dung sẵn sàng. Không cộng dồn các lần bấm trong lúc chuyển; tắt hiệu ứng theo thiết lập giảm chuyển động của thiết bị.
- Lưu file gốc, vị trí, thiết lập từng sách và annotation trong IndexedDB (Dexie). Annotation không sửa file gốc.
- Xuất/nhập ZIP version 1 gồm sách, bìa, tiến độ, bộ sưu tập và annotation. Kiểm tra cấu trúc và SHA-256 trước khi ghi; giao dịch khôi phục nguyên tử; giữ nguyên bản ghi trùng định danh. Giới hạn ZIP và tổng dữ liệu giải nén 1 GB; thao tác dùng bộ nhớ để đóng gói.
- Cài PWA, đọc offline, xin lưu trữ bền vững, hiển thị dung lượng; cập nhật app theo xác nhận ở thư viện, không tự tải lại màn đọc.

## Kiến trúc

`src/reader/ebook.ts` bọc foliate-js ở commit `78914aef4466eb960965702401634c2cb348e9b1`. EPUB, MOBI và AZW3 đọc trực tiếp, không chuyển đổi định dạng. `src/reader/pdf.ts` dùng PDF.js độc lập. `ReaderAdapter` trong `src/types.ts` thống nhất điều hướng, vị trí và capability của bộ đọc.

Vị trí EPUB/MOBI/AZW3 dùng CFI kèm engine/version; trang cố định lưu thêm tỷ lệ cuộn. PDF dùng số trang và tỷ lệ cuộn trong trang. Khi engine thay đổi, khôi phục gần đúng bằng fraction thay vì giải mã locator không tương thích. `PageSurface` dùng IntersectionObserver để chỉ giữ canvas/iframe gần vùng đọc cho nội dung cố định. Dữ liệu nhị phân lưu dưới dạng ArrayBuffer để tương thích IndexedDB trên WebKit.

Các chỉnh sửa tương thích với foliate-js được áp dụng trong plugin Vite, không sửa `node_modules`: bỏ adapter PDF thử nghiệm không dùng; chặn callback layout trên iframe đã bị hủy khi đổi chương và chuyển cập nhật ResizeObserver sang frame tiếp theo để tránh vòng lặp layout trên WebKit. Khi nâng commit foliate cần kiểm tra lại các chỉnh sửa này.

Nội dung các section EPUB/MOBI/AZW3, kể cả MOBI6, được làm sạch trước khi đưa vào iframe, có CSP riêng `script-src 'none'` và chặn kết nối/tài nguyên từ mạng. CSP của app chỉ cho tài nguyên cùng origin. Mạng được dùng để tải bản thân app và tài nguyên PDF cục bộ; sách và annotation không gửi đi. Kiểm thử bằng EPUB chứa script, iframe và tài nguyên bên ngoài.

## Kiểm thử

```sh
pnpm test
pnpm exec playwright install chromium webkit
pnpm build
pnpm test:e2e
```

Mặc định kiểm thử Chromium qua Microsoft Edge cài sẵn trên Windows và WebKit với viewport iPhone; nếu không có Edge, đổi `channel: 'msedge'` trong cấu hình sang Chromium cài bằng Playwright. Bộ e2e tự khởi chạy preview ở port 4173. Các fixture là nội dung gốc được tạo trong bộ test, không cần tải sách có bản quyền.

Unit tests kiểm tra nhập trùng, lỗi không ghi dở, xóa dữ liệu liên quan và sao lưu/khôi phục, gồm AZW3 và annotation. E2E kiểm tra EPUB chữ, EPUB cố định, MOBI6 tiếng Việt, AZW3/KF8, PDF chữ/scan, bookmark/highlight/ghi chú, giữ vị trí sau đổi cỡ chữ/mở lại, đọc offline và chặn script/request bên ngoài. Mẫu AZW3 tạo cấu trúc KF8 thực (INDX skeleton/fragment và FDST), không đổi đuôi từ MOBI6.

`tests/e2e/comic-images.spec.ts` kiểm tra ảnh nhúng sau khi làm sạch HTML. Đặt biến môi trường `LOCAL_COMIC_MOBI` trỏ tới file MOBI cá nhân để kiểm tra thêm các trang đầu/giữa/cuối; file không được đưa vào repo. Bài thử dùng bản sao tạm và tự xóa sau khi chạy. Với WebKit Windows, byte gốc được nạp vào File trong bộ nhớ để tránh lỗi file broker khi đọc đường dẫn của file lớn; cách này kiểm tra parser/renderer, không thay thế nghiệm thu thao tác chọn file trên iOS thật.

**Cần nghiệm thu trên thiết bị thật:** Safari/PWA iPhone Air và Chrome/PWA Lenovo Y700; nhập từ Files/Downloads, xoay dọc/ngang, chọn chữ cảm ứng, vuốt, pinch zoom, đổi app rồi quay lại, offline sau khi khởi động lại. Viewport giả lập/WebKit desktop không thay thế kiểm thử iOS thật.

## Hosting và dữ liệu

### GitHub Pages

Trong repository, mở **Settings → Pages → Build and deployment → Source → GitHub Actions**. Push lên `main` sẽ chạy workflow `.github/workflows/deploy.yml`: cài dependency, build rồi deploy **thư mục `dist/`**. Không chọn deploy trực tiếp source ở nhánh `main`: trình duyệt không chạy được `/src/main.tsx`.

Workflow đặt `VITE_BASE_PATH=/<tên-repo>/` để JavaScript, CSS, font, PDF và PWA hoạt động dưới đường dẫn như `/EReader_QQ/`. Khi chạy local hoặc deploy ở root domain, mặc định vẫn là `/`.

Để kiểm tra bản GitHub Pages trên PowerShell:

```powershell
$env:VITE_BASE_PATH = '/EReader_QQ/'
pnpm build
pnpm preview
```

Mở `http://localhost:4173/EReader_QQ/`. Dùng `Remove-Item Env:VITE_BASE_PATH` để trở lại cấu hình mặc định.

### Static hosting khác

Triển khai thư mục `dist/` trên static hosting HTTPS. Cấu hình fallback về `index.html`, giữ origin ổn định và đặt `Cache-Control: no-cache` cho `sw.js` và `index.html`. Các asset có hash có thể cache lâu. Không cần biến môi trường hoặc secret.

Thông báo giấy phép thư viện được sao chép vào `dist/licenses/` khi build; giữ thư mục này khi triển khai.

iPhone: Safari → Chia sẻ → Thêm vào MH chính. Android: Chrome → menu → Cài đặt ứng dụng/Thêm vào màn hình chính. Một máy khác trong LAN truy cập HTTP qua IP không phải secure context cho PWA; dùng hosting HTTPS để nghiệm thu trên điện thoại.

Mỗi origin/trình duyệt/PWA và thiết bị có dữ liệu riêng. Xóa dữ liệu website, dùng chế độ riêng tư, đổi hostname/port hoặc trình duyệt có thể khiến thư viện không còn truy cập được. Quyền lưu trữ bền vững do trình duyệt quyết định. Sao lưu thủ công là cách giữ và chuyển thư viện trong bản này.

Chưa hỗ trợ đồng bộ, DRM, PDF có mật khẩu, chuyển đổi định dạng, OCR, vẽ tay hoặc lấy nội dung từ website. MOBI/AZW3 có nhiều biến thể; các fixture không bảo đảm mọi file Kindle thương mại đều tương thích. File Kindle có cờ mã hóa bị từ chối khi nhập. File không đọc được phải báo lỗi và giữ nguyên thư viện hiện có.
