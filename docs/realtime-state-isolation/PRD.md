# Product Requirements Document (PRD): Collaborative Privacy & Local State Isolation

> **Tài liệu Yêu cầu Sản phẩm (PRD) chuẩn hóa ranh giới giữa Trạng thái Cục bộ Riêng tư (Private Local State) và Trạng thái Cộng tác Chia sẻ (Shared Collaborative State) trên bảng vẽ thời gian thực, bám sát 100% chuẩn mực trải nghiệm người dùng của Miro.**

---

## 1. Bối Cảnh & Mục Tiêu Nghiệp Vụ (Context & Objectives)

### 1.1. Bối Cảnh Thực Tế
Trong một ứng dụng bảng vẽ cộng tác thời gian thực (Real-time Collaborative Whiteboard) như Miro hay Antiwhite:
- Hàng chục người dùng có thể cùng truy cập vào một bảng vẽ đồng thời qua kết nối WebSocket.
- Nếu không có sự phân định ranh giới kiến trúc rõ ràng giữa **những gì thuộc về trải nghiệm thao tác cá nhân** và **những gì thuộc về dữ liệu chung của bảng vẽ**, hệ thống sẽ gặp các vấn đề nghiêm trọng:
  1. **Ô nhiễm thị giác (Visual Pollution & Cognitive Overload):** Khi một người dùng chọn một hình khối, nếu 10 người khác đều nhìn thấy viền xanh và 8 tay nắm co giãn (resize handles) nhấp nháy, bảng vẽ sẽ trở nên hỗn loạn.
  2. **Vi phạm quyền riêng tư khi soạn thảo (Drafting Privacy):** Khi một người dùng mở bảng công cụ toán học (Math Tools Panel) hay gõ công thức thô (LaTeX formula editor), đây là quá trình soạn nháp mang tính cá nhân. Những người khác chỉ cần và chỉ nên nhìn thấy kết quả công thức toán học hoàn chỉnh sau khi KaTeX render trên bảng vẽ, tuyệt đối không được nhìn thấy thanh soạn thảo hay bàn phím toán học của người khác.
  3. **Xung đột điều khiển (Control Interference):** Việc zoom, pan camera, mở thanh thuộc tính Inspector, mở modal xuất SQL DDL hay mở bộ chọn màu sắc là quyết định riêng của từng người dùng trên thiết bị của họ.

### 1.2. Mục Tiêu Cốt Lõi (Core Goals)
- **Chuẩn Hóa Tuyệt Đối Theo Miro (100% Miro Parity):** Áp dụng mô hình phân tách trạng thái 2 tầng:
  * **Private Local State:** Chỉ người dùng hiện tại nhìn thấy trên màn hình của họ.
  * **Shared Collaborative State:** Mọi người trong cùng bảng vẽ nhìn thấy đồng bộ theo thời gian thực.
- **Bảo Vệ Tính Riêng Tư Khi Soạn Thảo Toán Học:** Người khác không bao giờ nhìn thấy Math Tools hay Formula Editor mở ra, mà chỉ thấy Math Preview hiển thị sắc nét trên bảng vẽ.
- **Cách Ly Vùng Chọn (Selection Isolation):** Các vùng chọn, khung viền chọn, 8 nút điều khiển kích thước (handles), thanh công cụ chọn lựa đều thuộc về cá nhân và không rò rỉ sang màn hình người khác.

---

## 2. Các Yêu Cầu Chức Năng Chi Tiết (Functional Requirements)

### FR-1: Cách Ly Vùng Chọn & Hộp Bao Đối Tượng (Selection Isolation)
* **FR-1.1:** Khi Người dùng A nhấp chuột hoặc quét chọn (marquee/lasso select) một hoặc nhiều đối tượng (hình chữ nhật, hình thoi, bảng ERD, sticky note, v.v.):
  * Khung viền xanh chọn lựa (`#3b82f6`), 8 tay nắm co giãn kích thước (resize handles), chốt xoay góc (rotation handle) và nhãn kích thước (`w x h`) **chỉ hiển thị duy nhất trên màn hình của Người dùng A**.
  * Người dùng B **hoàn toàn không nhìn thấy bất kỳ khung viền chọn, tay nắm hay thanh công cụ chọn nào** của Người dùng A.
* **FR-1.2:** Dải công cụ nổi của vùng chọn (`.selection-toolbar`: nút Duplicate, Delete, Align...) chỉ xuất hiện cục bộ cho người đang chọn đối tượng.
* **FR-1.3:** Tuyệt đối không phát tán (broadcast) danh sách `selectedShapeIds` qua mạng Awareness nếu không có nhu cầu hiển thị viền cộng tác, nhằm tối ưu băng thông mạng và bảo đảm 100% tính riêng tư.

---

### FR-2: Bảo Vệ Riêng Tư Khi Soạn Thảo Công Thức Toán Học (Math Editing Privacy)
* **FR-2.1:** Khi Người dùng A double-click vào một khối công thức toán học (`math` shape):
  * **Thanh Soạn Thảo Công Thức (`FormulaEditor`):** Hiển thị ô nhập liệu LaTeX/Telex, con trỏ gõ chữ, nút chuyển chế độ Source/Rendered **chỉ trên màn hình Người dùng A**.
  * **Bảng Công Cụ Toán Học (`MathToolsPanel`):** Bàn phím ảo toán học chứa các ký tự Hy Lạp ($\alpha, \beta, \pi$), tích phân ($\int$), phân số ($\frac{a}{b}$), căn bậc hai ($\sqrt{x}$), ma trận... **chỉ mở ra trên màn hình Người dùng A**.
* **FR-2.2:** Đối với Người dùng B (và tất cả cộng tác viên khác):
  * Người dùng B **không nhìn thấy** `MathToolsPanel`.
  * Người dùng B **không nhìn thấy** khung nhập `FormulaEditor` hay mã nguồn LaTeX thô đang gõ dở.
  * Người dùng B **chỉ nhìn thấy khối Math Preview đã được KaTeX/AST render hoàn chỉnh** (`.board-math-preview`) hiển thị trang trọng trên bề mặt canvas.
  * Khi Người dùng A gõ thay đổi công thức toán, bản xem trước (preview) trên màn hình Người dùng B được cập nhật mượt mà theo thời gian thực qua Yjs (`updateFormulaLive`).

---

### FR-3: Cách Ly Trình Soạn Thảo Văn Bản & Ghi Chú Dán (Text & Sticky Editing Privacy)
* **FR-3.1:** Khi Người dùng A double-click để sửa text trên Sticky note, Text box, hoặc ô bảng CSDL (`erd.er-table`):
  * Thẻ DOM textarea cục bộ (`.board-text-editor`) cùng viền xanh focus và con trỏ nhấp nháy chỉ hiện diện trong cây DOM của Người dùng A.
  * Người dùng B không nhìn thấy thẻ textarea này, mà chỉ thấy văn bản hiển thị trên vật thể được cập nhật theo thời gian thực.
* **FR-3.2:** Khung điều hướng bảng tính (Spreadsheet Enter/Tab navigation) trong bảng CSDL chỉ điều hướng con trỏ nội bộ của Người dùng A.

---

### FR-4: Cách Ly Trình Soạn Thảo Mã Nguồn (Code Editor Privacy)
* **FR-4.1:** Khi Người dùng A mở chỉnh sửa khối code:
  * Vỏ bọc CodeMirror (`.code-editor-shell`) với số dòng (line numbers), gợi ý tự động (autocomplete), menu chọn ngôn ngữ lập trình chỉ hiển thị trên máy Người dùng A.
  * Người dùng B nhìn thấy khối preview code đã được highlight cú pháp (`.board-code-preview`) trên canvas.

---

### FR-5: Độc Lập Vùng Nhìn & Camera (Viewport Independence)
* **FR-5.1:** Mỗi người dùng có ma trận Viewport độc lập:
  * Tọa độ tâm camera `(cam.x, cam.y)` và hệ số phóng đại `cam.zoom` (từ 10% đến 400%) là hoàn toàn cục bộ.
  * Người dùng A zoom vào xem chi tiết một bảng ERD ở góc trái không làm thay đổi tầm nhìn hay tỷ lệ thu phóng của Người dùng B đang ở góc phải.
* **FR-5.2:** Thao tác cuộn chuột, kéo rê bằng chuột giữa hoặc chuột phải (Panning) chỉ tác động lên màn hình của người thực hiện.

---

### FR-6: Cách Ly Lịch Sử Thao Tác Cục Bộ (Undo/Redo Boundary)
* **FR-6.1:** Khi Người dùng A nhấn `Ctrl+Z` (Undo) hoặc `Ctrl+Y` (Redo):
  * Hệ thống chỉ hoàn tác các thao tác do chính Người dùng A tạo ra (`trackedOrigins: [this]`).
  * Các hình vẽ hay thay đổi do Người dùng B thực hiện đồng thời sẽ **không bao giờ bị Người dùng A vô tình xóa bỏ hoặc Undo nhầm**.

---

### FR-7: Cách Ly Giao Diện Bảng Điều Khiển & Cài Đặt (Inspector & Dialog Privacy)
* **FR-7.1:** Thanh thuộc tính đối tượng (`Inspector Panel`), bảng chọn màu vẽ (`Color Palette`), bộ điều chỉnh độ dày nét (`Stroke Width`), danh sách font chữ chỉ mở ra trên màn hình của người bấm.
* **FR-7.2:** Hộp thoại xuất mã SQL DDL (`.ddl-modal-backdrop`) cho PostgreSQL, MySQL, SQLite chỉ mở ra trước mắt người yêu cầu xuất mã.
* **FR-7.3:** Thanh công cụ bên trái (Tool Rail), menu popover chọn hình khối, trạng thái công cụ vẽ đang kích hoạt (`active tool`) là riêng biệt cho từng người.

---

### FR-8: Các Yếu Tố Cộng Tác Chia Sẻ Chung (Shared Collaborative Elements)
Theo chuẩn Miro, chỉ những yếu tố mang tính cộng tác trực tiếp sau đây mới được phát tán và đồng bộ thời gian thực cho mọi người:
1. **Dữ liệu hình khối trên bảng vẽ (`yShapes`):** Vị trí `(x, y)`, kích thước `(w, h)`, góc xoay `rotation`, màu nền `fill`, màu viền `stroke`, độ dày nét `sw`, nội dung văn bản `text`, công thức toán học `previewText`, danh sách cột bảng CSDL `data.table`.
2. **Con trỏ chuột thời gian thực (`Remote Cursors`):** Con trỏ chuột SVG kèm nhãn tên `Anonymous N` hiển thị vị trí chỉ tay của người khác trên không gian thế giới (World Units).
5. **Màu sắc người dùng thời gian thực (`User Colors`):** Màu sắc được sinh theo thuật toán Tỉ Lệ Vàng, bảo đảm không trùng lặp màu sắc giữa các thành viên online, kèm nhãn avatar tương phản cao.

---

### FR-9: Không Gian Màu Sắc Động & Chống Trùng Màu Quy Mô Lớn (Scalable Non-Colliding Colors)
* **FR-9.1:** Hệ thống không được fix cứng một danh sách màu hữu hạn ngắn (như 8 hay 10 màu) dẫn đến việc khi có đông người dùng thì bị trùng màu nhau.
* **FR-9.2:** Thuật toán phân bổ màu sắc dựa trên Tỉ Lệ Vàng (Golden Angle $137.5^\circ$) kết hợp 8 dải độ bão hòa/độ sáng, cung cấp hơn 28,800 mã màu sắc độc nhất, thẩm mỹ và sắc nét.
* **FR-9.3:** Khi một người dùng mới vào hoặc refresh trang:
  * Hệ thống kiểm tra danh sách `takenColors` từ các client đang online.
  * Chỉ cấp phát màu sắc chưa có ai sở hữu.
  * Trong trường hợp cực hạn phòng vẽ có trên 28,800 người dùng trực tuyến đồng thời (bão hòa toàn bộ dải màu phân biệt), mới kích hoạt cơ chế chọn màu ngẫu nhiên an toàn.

---

### FR-10: Đàm Phán URL & Tương Thích Đa Môi Trường (Dynamic Domain & Protocol Negotiation)
* **FR-10.1:** Không fix cứng URL `localhost`, port hay domain tuyệt đối trong mã nguồn và script kiểm thử.
* **FR-10.2:** Tự động đàm phán giao thức: trang web chạy trên `https:` tự động nâng cấp kết nối lên `wss:`, trang web chạy trên `http:` tự động dùng `ws:`.
* **FR-10.3:** Toàn bộ đường dẫn lưu trữ bằng chứng kiểm thử (screenshots, logs) phải sử dụng đường dẫn tương đối (relative path) trong thư mục dự án `scratch/`.

---

## 3. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

| Mã | Kịch Bản Kiểm Thử | Kết Quả Mong Đợi | Trạng Thái |
| :--- | :--- | :--- | :--- |
| **AC-01** | Tab 1 click chọn 1 hình chữ nhật và 1 bảng ER Table. | Trên Tab 1 hiện viền xanh và 8 tay nắm. Trên Tab 2 **hoàn toàn không có viền xanh hay tay nắm nào**. | **PASS** |
| **AC-02** | Tab 1 click đúp mở khối công thức Toán học (`math`). | Trên Tab 1 mở `FormulaEditor` và `MathToolsPanel`. Trên Tab 2 **không xuất hiện thanh soạn thảo hay bàn phím toán**, chỉ hiển thị khối KaTeX preview. | **PASS** |
| **AC-03** | Tab 1 gõ `\int_0^\infty e^{-x} dx` trong FormulaEditor. | Trên Tab 2 khối KaTeX preview hiển thị biểu thức tích phân đẹp mắt theo thời gian thực mà không lộ thanh input của Tab 1. | **PASS** |
| **AC-04** | Tab 1 zoom 250% và cuộn sang tọa độ (500, 800). | Tab 2 vẫn giữ nguyên zoom 100% và tọa độ ban đầu. | **PASS** |
| **AC-05** | Tab 1 mở Modal xuất SQL DDL của bảng ER Table. | Modal chỉ hiện ở Tab 1; Tab 2 không bị che khuất màn hình bởi modal. | **PASS** |
| **AC-06** | Tab 1 di chuột trên bảng vẽ. | Tab 2 nhìn thấy con trỏ chuột màu của `Anonymous 1` di chuyển mượt mà kèm nhãn tên. | **PASS** |
| **AC-07** | Tab 1 tạo 1 khối hình mới và Tab 2 tạo 1 khối hình khác, Tab 1 bấm Ctrl+Z. | Chỉ khối hình của Tab 1 bị hoàn tác; khối hình của Tab 2 vẫn nguyên vẹn. | **PASS** |
| **AC-08** | Mô phỏng 500 người dùng kết nối đồng thời vào bảng vẽ. | Cả 500 người dùng đều nhận được 500 mã màu hex hoàn toàn khác biệt, **0% trùng lặp màu sắc**. | **PASS** |
| **AC-09** | Chạy kiểm thử trên domain bất kỳ hoặc biến môi trường `APP_URL`. | Tự động kết nối đúng domain, hình ảnh screenshot lưu vào `scratch/` tương đối. | **PASS** |
