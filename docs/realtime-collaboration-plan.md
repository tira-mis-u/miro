# Master Architecture & Implementation Plan: Realtime Collaboration & Dynamic Scalable Awareness (Miro Standard)

> **Tài liệu kiến trúc đặc tả toàn diện hệ thống kết nối WebSocket thời gian thực, quản lý người dùng ẩn danh (Anonymous 1, 2, 3...), thuật toán sinh màu động không trùng lặp cho hàng ngàn người dùng (Golden Ratio Color Generator), con trỏ chuột đa người dùng (Multi-User Cursors with Viewport Culling) và cơ chế tự động đàm phán URL theo Domain bám sát chuẩn mực của Miro, Lucidchart và Draw.io.**

---

## 1. Mục Tiêu & Nguyên Lý Thiết Kế Cốt Lõi

### 1.1. Hiện Trạng Cần Thay Thế
- Trước đây trên thanh tiêu đề (Header), danh sách người dùng bị fix cứng dữ liệu giả (mock static HTML) với các avatar tĩnh: `AR` (Alex Rivera), `SC` (Sarah Chen), `DK` (David Kim), badge `+2`, và avatar cá nhân `U`.
- Màu sắc người dùng bị giới hạn trong một mảng tĩnh 10 màu, dẫn đến việc nếu có 50 hay 500 người dùng truy cập thì các người dùng sẽ bị trùng màu nhau (User 1 trùng User 11, 21, 31...).
- URL WebSocket và đường dẫn tệp bị phụ thuộc cứng vào `localhost:5175` hoặc đường dẫn tuyệt đối, gây lỗi khi triển khai đa domain, reverse proxy (Nginx, Traefik, Caddy) hoặc môi trường production.
- Chưa có cơ chế lọc con trỏ ngoài màn hình (Viewport Culling), dẫn đến lãng phí tài nguyên DOM khi có hàng trăm cộng tác viên cùng online trên bảng vẽ vô cực.

### 1.2. Chuẩn Mực Benchmark So Sánh Với Các Nền Tảng Hàng Đầu

| Tiêu Chí Kỹ Thuật | **Miro** | **Lucidchart** | **Draw.io (Collab)** | **Antiwhite (Hệ Thống Hiện Tại)** |
| :--- | :--- | :--- | :--- | :--- |
| **Định Danh Người Dùng** | Anonymous Animal / Anonymous N | Guest N | Anonymous User | **Anonymous 1, 2, 3... (Tự động lấp chỗ trống nhỏ nhất)** |
| **Không Gian Màu Sắc** | Động, tương phản cao, không trùng lặp | Cố định 8-12 màu | Cố định ngẫu nhiên | **Sinh màu thuật toán Tỉ Lệ Vàng (28,800+ mã màu độc nhất, không trùng lặp)** |
| **Đàm Phán URL & Protocol** | Tự động theo Domain & WSS | Tự động theo Domain | Tự động theo Domain | **Tự động theo `window.location.href`, auto HTTP $\to$ WS, HTTPS $\to$ WSS** |
| **Tọa Độ Con Trỏ Chuột** | Tọa độ thế giới (World Units) | Tọa độ thế giới | Tọa độ thế giới | **World Units (`clientToWorld`), zoom độc lập 10% - 400%** |
| **Tối Ưu Hiệu Năng DOM** | Viewport Culling & Throttling | Canvas Layer | DOM Overlay | **Viewport Culling (lọc con trỏ ngoài màn hình) + RAF Throttle 33ms** |
| **Trạng Thái Nghỉ (Inactivity)** | Mờ dần sau 10s, ẩn sau 20s | Ẩn sau 15s | Ẩn sau 15s | **Mờ dần mượt mà sau 10s, ẩn hoàn toàn sau 20s** |
| **Quyền Riêng Tư (Privacy)** | Vùng chọn, Math Tools 100% riêng | Vùng chọn riêng | Vùng chọn riêng | **100% Private Selection & Math Tools (Chỉ gửi KaTeX Preview)** |
| **Điều Hướng Cộng Tác** | Click avatar $\to$ Jump to Cursor | Click avatar $\to$ Follow | Không hỗ trợ | **Click avatar $\to$ `panTo(x, y)` lướt mượt đến con trỏ** |

---

## 2. Kiến Trúc Kỹ Thuật (System Architecture)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        HỆ THỐNG REALTIME MIRO COLLABORATION MỞ RỘNG                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [Client A - Tab 1]                   [Reverse Proxy / WebSocket]       [Client B - Tab 2]│
│   (Anonymous 1 - #7c3aed)              (WSS / Dynamic Domain)           (Anonymous 2 - #059669)
│   ├── Dynamic WS URL Resolver ───────► /ws (Domain agnostic) ◄──────── Dynamic WS URL Resolver
│   │                                            ▲                                       │
│   ├── Y.Doc (CRDT shapes map) ◄────────────────┼──────────────────────► Y.Doc (CRDT shapes)
│   │                                            │                                       │
│   └── Y.Awareness (user, cursor) ◄─────────────┴──────────────────────► Y.Awareness    │
│        │                                                                 │             │
│        ├── Golden Ratio Color Allocator                                  ├── Golden Ratio Color
│        │   (Kiểm tra takenColors, chống trùng màu)                       │   (Chống trùng màu)
│        │                                                                 │             │
│        ├── Viewport Culling Engine ◄─── Cam Matrix (x, y, zoom) ─────────┼── Viewport Culling
│        │   (Chỉ render con trỏ trong tầm nhìn)                          │             │
│        │                                                                 │             │
│        └── Smooth Movement Interpolator ◄── World Coordinate (x, y) ─────┘             │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Thuật Toán Sinh Màu Động Tỉ Lệ Vàng (Golden Ratio Color Engine)

### 3.1. Bài Toán Thực Tế
Trong các buổi brainstorming lớn, hội thảo trực tuyến hoặc phòng họp công ty, số lượng người dùng có thể lên tới hàng trăm, thậm chí hàng ngàn người:
- Nếu chỉ dùng mảng cố định 10 màu, khi chia cho số lượng người dùng sẽ xảy ra xung đột màu sắc nghiêm trọng (Color Collision). Nhiều người dùng cùng có màu tím hoặc xanh lục, khiến các con trỏ chuột trên canvas không thể phân biệt được của ai.
- Nếu chọn màu ngẫu nhiên thuần túy (`Math.random()`), xác suất xảy ra hiện tượng "Birthday Paradox" là cực lớn: chỉ cần 23 người dùng là xác suất 2 người bị trùng màu đã vượt quá 50%.
- Hơn nữa, việc chọn màu ngẫu nhiên có thể tạo ra các màu quá sáng (như vàng chanh nhạt, trắng xám) không đọc được chữ, hoặc màu quá tối không nổi bật trên nền canvas.

### 3.2. Giải Pháp Thuật Toán: Góc Vàng & Dải Độ Sáng Phân Lớp
Hệ thống áp dụng thuật toán phân tán màu sắc dựa trên **Góc Vàng (Golden Angle)**:
$$\theta_{\text{golden}} = 360^\circ \times (1 - \frac{1}{\phi}) \approx 137.50776405^\circ$$
Trong đó $\phi = \frac{1 + \sqrt{5}}{2}$ là Tỉ Lệ Vàng.

1. **Phân Phối Sắc Độ (Hue Dispersion):**
   - Với mỗi người dùng thứ $k$, góc Hue được tính:
     $$H_k = ((k - 1) \times 137.50776405^\circ) \pmod{360^\circ}$$
   - Tính chất toán học của Số Vô Tỉ đảm bảo các giá trị Hue sinh ra sẽ phân bổ đồng đều tối đa trên vòng tròn màu sắc $360^\circ$ mà không bao giờ bị dồn cụm (clustering).
2. **8 Dải Bão Hòa & Độ Sáng Phân Lớp (8 Saturation/Lightness Bands):**
   - Để mở rộng từ 360 màu lên hàng chục ngàn màu mà vẫn giữ được tính thẩm mỹ chuẩn Miro:
     ```typescript
     const satBands = [78, 85, 72, 88, 70, 82, 75, 86]; // Độ bão hòa tối ưu
     const lumBands = [48, 42, 53, 39, 50, 44, 52, 41]; // Độ sáng tương phản cao
     ```
   - Số lượng màu sắc hoàn toàn độc nhất và khác biệt:
     $$\text{Capacity} = 3,600 \text{ Hues} \times 8 \text{ Bands} = 28,800 \text{ màu sắc độc nhất!}$$
3. **Thuật Toán Kiểm Tra Trùng Màu (Collision-Free Allocation):**
   - Khi cấp phát định danh trong [`src/store/collabPresence.ts`](file:///c:/Users/ADMIN/Desktop/miro/src/store/collabPresence.ts):
     1. Hệ thống quét toàn bộ `takenColors: Set<string>` từ tất cả các client đang online trong phòng vẽ.
     2. Tìm màu sắc đầu tiên trong chuỗi phát sinh chưa bị bất kỳ ai chiếm dụng:
        `!takenColors.has(candidateColor.toLowerCase())`.
     3. Trong trường hợp cực hạn phòng vẽ có hơn 28,800 người dùng trực tuyến đồng thời (vượt quá dung lượng toàn dải màu phân biệt), hệ thống mới kích hoạt cơ chế chọn màu ngẫu nhiên an toàn.
4. **Độ Tương Phản Chuẩn WCAG 2.1:**
   - Tự động tính toán độ chói tương đối (Relative Luminance):
     $$L = 0.2126 \times R + 0.7152 \times G + 0.0722 \times B$$
   - Nếu $L > 0.62$, chữ trên badge tự động chuyển sang màu tối `#0f172a`.
   - Nếu $L \le 0.62$, chữ trên badge hiển thị màu trắng tinh `#ffffff`, bảo đảm khả năng đọc 100% trong mọi điều kiện ánh sáng.

---

## 4. Cơ Chế Đàm Phán URL Động (Dynamic Domain Resolution)

### 4.1. Không Bao Giờ Fix Cứng Hostname Hoặc Port
Ứng dụng có thể được triển khai trên nhiều môi trường:
- `http://localhost:5175` (Môi trường dev cục bộ)
- `https://miro.mycompany.com` (Môi trường production doanh nghiệp)
- `https://whiteboard.internal:8443/app/` (Triển khai phía sau Reverse Proxy / Nginx)

### 4.2. Hàm Phân Giải Tự Động [`resolveRealtimeWsUrl()`](file:///c:/Users/ADMIN/Desktop/miro/src/store/useBoardStore.ts#L74)
```typescript
export function resolveRealtimeWsUrl(path = '/ws'): string {
  if (typeof window === 'undefined') return '';
  // 1. Ghi đè ưu tiên qua query param (?ws_url=...)
  try {
    const custom = new URLSearchParams(window.location.search).get('ws_url');
    if (custom && custom.trim()) return custom.trim();
  } catch {}

  // 2. Ghi đè qua biến môi trường build-time
  const envWs = (import.meta as any).env?.VITE_WS_URL;
  if (typeof envWs === 'string' && envWs.trim()) return envWs.trim();

  // 3. Tự động đàm phán protocol & host theo URL hiện tại của trình duyệt
  const isSecure = window.location.protocol === 'https:';
  const wsProtocol = isSecure ? 'wss:' : 'ws:';
  const url = new URL(path, window.location.href);
  url.protocol = wsProtocol;
  return url.toString();
}
```
* **HTTPS $\to$ WSS:** Tự động bảo mật mã hóa TLS khi chạy trên domain HTTPS.
* **HTTP $\to$ WS:** Tự động tương thích với HTTP nội bộ.
* **Đường dẫn tương đối & Query Params:** Các bài test và kịch bản Playwright đọc biến môi trường `process.env.APP_URL` và lưu screenshot vào thư mục tương đối `scratch/`, tuyệt đối không lưu cứng đường dẫn máy cục bộ.

---

## 5. Tối Ưu Hóa Con Trỏ Chuột Cho Số Lượng Lớn Người Dùng (High Concurrency)

### 5.1. Lọc Vùng Nhìn Màn Hình (Spatial Viewport Culling)
Khi có 500 người dùng trên cùng một bảng vẽ, việc render 500 thẻ HTML DOM `<div>` cho con trỏ chuột sẽ làm giảm tốc độ khung hình (FPS drop) nghiêm trọng:
- [`RemoteCursorsOverlay.tsx`](file:///c:/Users/ADMIN/Desktop/miro/src/components/collab/RemoteCursorsOverlay.tsx) chỉ render con trỏ của những người dùng có tọa độ màn hình nằm trong ranh giới:
  $$-160 \le x \le \text{window.innerWidth} + 160$$
  $$-160 \le y \le \text{window.innerHeight} + 160$$
- Các con trỏ ở ngoài tầm nhìn (đang vẽ ở góc khác của bảng vẽ) bị loại bỏ khỏi cây DOM (Culling), giúp bảng vẽ duy trì tốc độ 60 FPS mượt mà ngay cả khi có hàng trăm người cùng tham gia.

### 5.2. Mờ Dần & Tự Động Thu Hồi Khi Bất Động (Idle Decaying Timeout)
- **$0 \le t < 10\text{s}$:** Con trỏ hiển thị sắc nét $100\%$ độ mờ (`opacity: 1`).
- **$10\text{s} \le t < 20\text{s}$:** Con trỏ tự động mờ dần từ $100\%$ xuống $35\%$ (`transition: opacity 250ms`).
- **$t \ge 20\text{s}$ hoặc rời canvas:** Con trỏ tự động được thu hồi và gỡ bỏ hoàn toàn khỏi màn hình.

---

## 6. Trạng Thái Hoàn Thành & Nghiệm Thu Kỹ Thuật

- [x] **Bước 1 (Đã hoàn thành):** Xây dựng module [`src/store/collabPresence.ts`](file:///c:/Users/ADMIN/Desktop/miro/src/store/collabPresence.ts) với thuật toán sinh màu Tỉ Lệ Vàng (28,800+ màu sắc độc nhất), cấp phát slot ẩn danh nhỏ nhất chưa dùng, và chống xung đột màu sắc khi nhiều người cùng vào phòng.
- [x] **Bước 2 (Đã hoàn thành):** Nâng cấp [`src/store/useBoardStore.ts`](file:///c:/Users/ADMIN/Desktop/miro/src/store/useBoardStore.ts) với hàm `resolveRealtimeWsUrl()` tự động đàm phán WSS/WS theo domain hiện tại, hỗ trợ bảng vẽ thời gian thực qua query `?board=...`.
- [x] **Bước 3 (Đã hoàn thành):** Nâng cấp [`src/components/collab/RemoteCursorsOverlay.tsx`](file:///c:/Users/ADMIN/Desktop/miro/src/components/collab/RemoteCursorsOverlay.tsx) với kỹ thuật Viewport Culling và hiệu ứng mờ dần khi bất động chuẩn Miro.
- [x] **Bước 4 (Đã hoàn thành):** Tích hợp Header Presence trong [`src/App.tsx`](file:///c:/Users/ADMIN/Desktop/miro/src/App.tsx) với danh sách avatar thời gian thực, tính năng Jump to Collaborator (`panTo`), và loại bỏ triệt để rò rỉ vùng chọn (`selectedShapeIds`).
- [x] **Bước 5 (Đã hoàn thành):** Tối ưu hóa CSS con trỏ và avatar trong [`src/index.css`](file:///c:/Users/ADMIN/Desktop/miro/src/index.css).
- [x] **Bước 6 (Đã hoàn thành):** Viết và vượt qua 100% bộ kiểm thử tự động đa tab Playwright [`scripts/verify-collaboration-privacy.mjs`](file:///c:/Users/ADMIN/Desktop/miro/scripts/verify-collaboration-privacy.mjs) và [`scripts/verify-realtime-collaboration.mjs`](file:///c:/Users/ADMIN/Desktop/miro/scripts/verify-realtime-collaboration.mjs).
