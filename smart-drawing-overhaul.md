# Smart Drawing & Pen Tool Overhaul (3 Giai Đoạn Từng Bước)

## Goal
Khắc phục triệt để hiện tượng nét bút thường (Pen Tool) bị giật/co méo ở zoom lớn và chuẩn hóa bộ nhận diện Smart Drawing theo 3 giai đoạn độc lập: tách biệt mượt hiển thị khỏi nhận diện hình học, loại bỏ hoàn toàn các ngưỡng chồng lấn, và xử lý dứt điểm các cặp hình dễ nhầm lẫn.

## Tasks

### Giai đoạn 1: Sửa Pen Tool (Làm mượt hiển thị, độc lập với nhận diện hình)
- [ ] Task 1.1: [Lọc rung động hiển thị Pen] Bổ sung bộ lọc Exponential Moving Average (EMA) nhẹ và cải tiến thuật toán nội suy đường cong hiển thị trong `CanvasEngine.ts` cho riêng công cụ Bút thường (Pen Tool), bảo toàn tọa độ thế giới thực của nét vẽ để không làm lệch nét hay mất góc nhọn → Verify: Chạy `scripts/verify-smooth-pen.mjs` và vẽ thực nghiệm trên canvas ở các mức zoom 100%, 250%, 500%.

### Giai đoạn 2: Sửa Lỗi Nhận Diện Hình & Loại Bỏ Ngưỡng Chồng Lấn
- [ ] Task 2.1: [Bộ test mẫu chuẩn & méo cho các cặp nhầm lẫn] Tạo bộ test benchmark `scripts/test-shape-benchmark.ts` bao gồm các ca kiểm thử thực tế: Oval dẹp, Chữ nhật bo góc, Tứ giác nghiêng (Hình bình hành/Hình thang), Tam giác gãy cạnh/chữ V, Ngôi sao 5 cánh, Trái tim méo → Verify: Chạy test ghi nhận baseline trước khi sửa logic.
- [ ] Task 2.2: [Phân định Oval vs Tứ giác không phụ thuộc thứ tự] Thay vì dùng đơn độc `areaRatio`, kết hợp chặt chẽ: ShortStraw corner count ($N_c \le 2$ cho oval vs $N_c \ge 4$ cho tứ giác) + Độ thẳng cạnh $sagitta$ + Residual elip. Loại bỏ khoảng giao nhau chồng lấn, tạo quy tắc quyết định dứt khoát → Verify: Chạy test benchmark xác nhận không còn nhầm lẫn oval ↔ tứ giác.
- [ ] Task 2.3: [Phân định Tam giác vs Ngôi sao vs Trái tim] Siết chặt topo ngôi sao (yêu cầu 5 đỉnh lồi xen kẽ 5 đáy lõm nhọn quanh tâm), trái tim (2 cung lồi trên + rãnh lõm sâu ở giữa + đỉnh V ở đáy), tam giác ($N_c = 3$ với 3 cạnh thẳng). Chữ V hoặc tam giác có 1 cạnh gãy không bao giờ thành sao; tim không bao giờ thành sao → Verify: Chạy test benchmark xác nhận phân định rạch ròi 3 loại hình này.

### Giai đoạn 3: Tiền Xử Lý Cắt Đuôi & Tinh Chỉnh ShortStraw
- [ ] Task 3.1: [Cắt đuôi thừa & móc câu an toàn] Cải tiến thuật toán phát hiện giao điểm tự nhiên trong `preprocess.ts` chỉ khi có đủ bằng chứng hình học vòng lặp kín ($> 70\%$ chu vi tạo thành loop), cắt đuôi vắt chéo mà không làm mất góc của đa giác → Verify: Chạy test nét vẽ có đuôi thừa $25\%$ vẫn nhận diện đúng hình.
- [ ] Task 3.2: [Hồi quy & Verification Suite toàn diện] Chạy toàn bộ test suite hồi quy trên trình duyệt thật (Playwright) và TypeScript compilation → Verify: `npx tsc -b` sạch lỗi và `node scripts/verify-smart-drawing-browser.mjs` pass toàn bộ các hình.

## Done When
- [ ] Nét bút thường khi vẽ tay uốn lượn ở zoom lớn (300% - 500%) mượt mà, tròn trịa, không bị giật hay co rút nét.
- [ ] Tách bạch hoàn toàn: Làm mượt hiển thị của Pen Tool không làm sai lệch hình học đưa vào Smart Drawing.
- [ ] Không còn bất kỳ ngưỡng chồng lấn nào giữa các bộ nhận diện hình; phân định dứt khoát Oval ↔ Tứ giác, Tam giác ↔ Sao, Tim ↔ Sao.
- [ ] Tất cả benchmark tests và browser verification pass 100%.

## Notes
- Triển khai tuần tự theo từng giai đoạn. Xong giai đoạn nào nghiệm thu và xác nhận giai đoạn đó trước khi bước sang giai đoạn tiếp theo.
- Nét vẽ gốc của người dùng luôn được lưu trữ nguyên bản để bảo toàn dữ liệu đồng bộ (Yjs) và hoàn tác (Undo/Redo).

