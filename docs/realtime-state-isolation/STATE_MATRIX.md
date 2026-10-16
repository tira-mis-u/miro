# Exhaustive State Matrix: Complete Classification of UI Elements & Gestures

> **Ma Trận Toàn Diện Phân Loại 100% Các Thành Phần Giao Diện, Thao Tác Chuột & Trạng Thái Ứng Dụng:**  
> **[Chỉ Mình Thấy Được - Private Local] vs [Cả Hai Cùng Thấy - Shared Collaborative] (Chuẩn Miro)**

---

## 1. Bảng Ma Trận Tổng Hợp Toàn Diện (Comprehensive State Matrix)

| STT | Phân Nhóm Chức Năng | Tên Thành Phần / Thao Tác | Tầng Lưu Trữ | Người Thao Tác (Mình Thấy) | Người Còn Lại (Người Kia Thấy) | Chuẩn Miro Parity |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| **1** | **Vùng Chọn (Selection)** | Khung viền xanh bao quanh đối tượng (`selection bounding box`) | `CanvasEngine.sel` | Hiển thị viền xanh `#3b82f6` rõ nét | **KHÔNG THẤY** (Bề mặt vật thể sạch sẽ) | ✅ Chuẩn Miro |
| **2** | **Vùng Chọn (Selection)** | 8 tay nắm co giãn kích thước (`resize handles`) | `CanvasEngine.sel` | Hiển thị 8 chấm tròn trắng viền xanh ở 4 góc và 4 cạnh | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **3** | **Vùng Chọn (Selection)** | Chốt xoay góc tự do (`rotation handle`) | `CanvasEngine.sel` | Hiển thị chấm tròn xoay cách đỉnh trên 24px | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **4** | **Vùng Chọn (Selection)** | Khung kéo quét đa đối tượng (`marquee / lasso select box`) | `CanvasEngine.isBoxing` | Hiển thị khung chữ nhật nét đứt màu xanh mờ khi rê chuột | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **5** | **Vùng Chọn (Selection)** | Thanh công cụ nổi của vùng chọn (`.selection-toolbar`) | `React Local State` | Hiển thị thanh Duplicate, Delete, Align ở trên đầu | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **6** | **Vùng Chọn (Selection)** | Gizmo điều khiển kích thước 3D (`solid3d resize gizmo`) | `CanvasEngine.sel` | Hiển thị các chốt mũi tên 3D trục X/Y/Z | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **7** | **Soạn Thảo Toán (Math)** | Khung nhập công thức LaTeX thô (`FormulaEditor input bar`) | `React Local State` | Hiển thị ô gõ chữ, con trỏ nhấp nháy, nút Render/Source | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **8** | **Soạn Thảo Toán (Math)** | Bảng bàn phím ảo công cụ toán học (`MathToolsPanel`) | `React Local State` | Mở bảng dock/floating chứa các tab ký hiệu Hy Lạp, tích phân... | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **9** | **Soạn Thảo Toán (Math)** | Bản xem trước công thức toán học (`Math Preview / KaTeX`) | `Y.Map shapes.previewText`| Hiển thị công thức toán render hoàn chỉnh | **CẢ HAI ĐỀU THẤY** (Đồng bộ thời gian thực) | ✅ Chuẩn Miro |
| **10** | **Soạn Thảo Chữ (Text)** | Khung textarea gõ chữ dán/text box (`.board-text-editor`) | `React Local State` | Hiển thị ô textarea có focus, viền xanh và con trỏ gõ | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **11** | **Soạn Thảo Chữ (Text)** | Chữ hiển thị trên ghi chú dán (`Sticky note text content`) | `Y.Map shapes.text` | Hiển thị văn bản trên sticky | **CẢ HAI ĐỀU THẤY** (Đồng bộ thời gian thực) | ✅ Chuẩn Miro |
| **12** | **Soạn Thảo Chữ (Text)** | Điều hướng phím bảng tính Enter/Tab trong bảng CSDL | `React Local State` | Con trỏ nhảy giữa các dòng cột để gõ tiếp | **KHÔNG THẤY** (Chỉ thấy kết quả chữ cập nhật) | ✅ Chuẩn Miro |
| **13** | **Soạn Thảo Code** | Khung biên soạn CodeMirror overlay (`.code-editor-shell`) | `React Local State` | Hiển thị editor có số dòng, autocomplete, syntax input | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **14** | **Soạn Thảo Code** | Khối code syntax-highlighted trên canvas (`code preview`) | `Y.Map shapes.text` | Hiển thị khối code đã tô màu cú pháp | **CẢ HAI ĐỀU THẤY** (Đồng bộ thời gian thực) | ✅ Chuẩn Miro |
| **15** | **Điều Hướng Camera** | Vị trí tâm bảng vẽ (`cam.x`, `cam.y`) | `CanvasEngine.cam` | Tự do di chuyển đến bất kỳ khu vực nào | **KHÔNG BỊ ẢNH HƯỞNG** (Mỗi người 1 góc nhìn riêng) | ✅ Chuẩn Miro |
| **16** | **Điều Hướng Camera** | Tỷ lệ phóng to thu nhỏ (`cam.zoom` từ 10% đến 400%) | `CanvasEngine.cam` | Zoom to nhỏ theo ý muốn cá nhân | **KHÔNG BỊ ẢNH HƯỞNG** (Tỷ lệ zoom độc lập) | ✅ Chuẩn Miro |
| **17** | **Thao Tác Vẽ (Gestures)** | Vệt chuột kéo tạo hình trước khi nhả chuột (`in-flight rect`) | `CanvasEngine.gesture` | Thấy khung chữ nhật co dãn theo vị trí con trỏ chuột | **KHÔNG THẤY** (Chỉ thấy hình sau khi nhả chuột) | ✅ Chuẩn Miro |
| **18** | **Thao Tác Vẽ (Gestures)** | Nét bút vẽ tay khi chưa nhấc bút (`in-flight pen stroke`) | `CanvasEngine.penPoints` | Thấy nét mực vẽ trực tiếp theo chuyển động tay | **KHÔNG THẤY** (Nhấc bút xong hình xuất hiện đồng thời) | ✅ Chuẩn Miro |
| **19** | **Thao Tác Di Chuyển** | Kéo di chuyển hình khối (`dragging shapes`) | `Y.Map shapes` (throttle) | Thấy hình di chuyển theo con trỏ | **CẢ HAI ĐỀU THẤY** (Hình trượt mượt mà theo vị trí mới) | ✅ Chuẩn Miro |
| **20** | **Lịch Sử (History)** | Lệnh hoàn tác Undo (`Ctrl + Z`) | `Y.UndoManager` (tracked) | Hoàn tác lại thao tác vừa làm của chính mình | **KHÔNG BỊ ẢNH HƯỞNG** (Không xóa nhầm hình người kia) | ✅ Chuẩn Miro |
| **21** | **Lịch Sử (History)** | Lệnh làm lại Redo (`Ctrl + Y`) | `Y.UndoManager` (tracked) | Làm lại thao tác vừa hoàn tác của chính mình | **KHÔNG BỊ ẢNH HƯỞNG** | ✅ Chuẩn Miro |
| **22** | **Công Cụ & Sidebar** | Công cụ đang chọn trên thanh Tool Rail (Pen, Rect, Text...) | `React Local State` | Nút công cụ sáng xanh trên thanh công cụ | **KHÔNG THẤY** (Mỗi người dùng 1 công cụ riêng) | ✅ Chuẩn Miro |
| **23** | **Menu & Popover** | Bảng popover chọn hình khối (`Shape Picker Popover`) | `React Local State` | Mở bảng popover danh mục hình khối | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **24** | **Bảng Thuộc Tính** | Inspector Panel chỉnh màu, font, độ dày viền bên phải | `React Local State` | Mở bảng tùy chỉnh chi tiết đối tượng | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **25** | **Modal Thoát DDL** | Modal xuất câu lệnh SQL DDL (`.ddl-modal-backdrop`) | `React Local State` | Hiển thị hộp thoại xuất PostgreSQL, MySQL, SQLite | **KHÔNG THẤY** | ✅ Chuẩn Miro |
| **26** | **Con Trỏ Cộng Tác** | Con trỏ chuột của người khác (`Remote Cursors`) | `Y.Awareness cursor` | Thấy con trỏ màu của người kia di chuyển kèm tên | **CẢ HAI ĐỀU THẤY** (Hiển thị con trỏ của nhau) | ✅ Chuẩn Miro |
| **27** | **Hiện Diện Người Dùng** | Danh sách avatar trên Header (`Collaborator Avatars`) | `Y.Awareness user` | Thấy danh sách A1, A2, A3... đang cùng online | **CẢ HAI ĐỀU THẤY** | ✅ Chuẩn Miro |
| **28** | **Định Danh Cá Nhân** | Avatar cá nhân góc trên bên phải (`header-user-avatar`) | `collabPresence.local` | Thấy avatar và tên của chính mình: `You (Anonymous 1)` | Thấy định danh của họ: `You (Anonymous 2)` | ✅ Chuẩn Miro |
| **29** | **Dữ Liệu Hình Học** | Tạo mới, xóa bỏ, đổi màu, đổi font đối tượng | `Y.Map shapes` | Thao tác trên đối tượng | **CẢ HAI ĐỀU THẤY** (Đồng bộ tức thì qua WebSocket) | ✅ Chuẩn Miro |
| **30** | **Tên Bảng Vẽ** | Đổi tên bảng vẽ (`boardName`) | `Y.Doc / Local Board` | Tên bảng vẽ cập nhật trên thanh tiêu đề | **CẢ HAI ĐỀU THẤY** | ✅ Chuẩn Miro |
| **31** | **Màu Sắc Cá Nhân** | Cấp phát màu sắc Tỉ Lệ Vàng độc nhất | `collabPresence` | Màu sắc độc nhất của chính mình | **CẢ HAI ĐỀU THẤY** (Mỗi người sở hữu 1 mã màu riêng, 0% trùng màu) | ✅ Chuẩn Miro |
| **32** | **Lọc Tầm Nhìn Con Trỏ** | Viewport Culling khi người khác ở xa màn hình | `RemoteCursorsOverlay` | Con trỏ ngoài màn hình không bị tạo thẻ DOM | **TỰ ĐỘNG LỌC** (Giữ vững 60 FPS cho 500+ users) | ✅ Chuẩn Miro |
| **33** | **Trạng Thái Nghỉ Con Trỏ**| Con trỏ bất động quá 10s | `RemoteCursorsOverlay` | Con trỏ mờ dần xuống 35%, ẩn sau 20s | **CẢ HAI ĐỀU THẤY** (Giảm ô nhiễm thị giác) | ✅ Chuẩn Miro |

---

## 2. Đặc Tả Tương Tác Chi Tiết Cho 3 Trường Hợp Trọng Tâm

### 2.1. Phân Tích Trường Hợp Vùng Chọn (Selection Privacy)
* **Thực tế:**
  1. Khi Người dùng 1 bấm vào Bảng `Users` (`erd.er-table`):
     - Màn hình Người dùng 1: Bảng `Users` xuất hiện viền xanh bao quanh, 8 chấm tròn co giãn (handles), thanh toolbar nổi có nút `Duplicate`, `Delete`, và thanh Inspector bên phải mở ra danh sách các cột.
     - Màn hình Người dùng 2: Bảng `Users` giữ nguyên hình thái bình thường. Không có viền xanh, không có chấm tròn, không có toolbar. Người dùng 2 hoàn toàn không bị phân tâm bởi việc Người dùng 1 đang bấm chọn bảng nào.
  2. Khi Người dùng 1 quét chuột chọn 5 hình khối:
     - Màn hình Người dùng 1: Vùng quét màu xanh mờ (`selection marquee`) mở rộng theo chuột, sau đó 5 hình được bao bọc trong 1 bounding box lớn chung.
     - Màn hình Người dùng 2: Không có bất kỳ vùng quét nào xuất hiện.

---

### 2.2. Phân Tích Trường Hợp Soạn Thảo Toán Học (Math Tools & Formula Privacy)
* **Thực tế:**
  1. Khi Người dùng 1 double-click vào một công thức toán:
     - Màn hình Người dùng 1:
       - Mở thanh `FormulaEditor` trực tiếp trên công thức.
       - Mở bảng `MathToolsPanel` (bàn phím ảo toán học) ở góc dưới hoặc bên cạnh.
       - Người dùng 1 có thể click vào các nút ký hiệu toán học như $\sum, \int, \sqrt{}, \pi$ để chèn vào công thức.
     - Màn hình Người dùng 2:
       - **HOÀN TOÀN KHÔNG XUẤT HIỆN** `FormulaEditor` hay `MathToolsPanel`.
       - Khối công thức toán trên màn hình Người dùng 2 hiển thị biểu tượng công thức đã render (`.board-math-preview`).
  2. Khi Người dùng 1 đang gõ:
     - Biểu thức toán học được chuyển đổi qua KaTeX và cập nhật vào `previewText`.
     - Người dùng 2 nhìn thấy công thức toán học biến đổi mượt mà theo nội dung mới, nhưng không bao giờ nhìn thấy con trỏ soạn thảo hay khung input của Người dùng 1.

---

### 2.3. Phân Tích Trường Hợp Camera & Góc Nhìn Độc Lập (Camera Independence)
* **Thực tế:**
  - Người dùng 1 đang làm việc ở góc tọa độ $(100, 100)$ với mức zoom $100\%$.
  - Người dùng 2 đang thiết kế sơ đồ CSDL lớn ở góc $(2500, 3000)$ với mức zoom $60\%$.
  - Hai người dùng có thể cùng lúc chỉnh sửa 2 khu vực cách xa nhau hàng ngàn pixel mà không hề can thiệp hay làm giật màn hình của nhau.
  - Khi Người dùng 2 muốn xem Người dùng 1 đang làm gì: Chỉ cần click vào avatar `A1` trên thanh Header, camera của Người dùng 2 sẽ tự động lướt mượt mà (`panTo`) đến vị trí con trỏ của Người dùng 1 (tính năng "Jump to User" chuẩn Miro).
