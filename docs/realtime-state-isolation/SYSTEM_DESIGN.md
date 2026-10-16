# System Design: Multi-Tier State Isolation Architecture

> **Tài liệu Thiết Kế Hệ Thống (System Design) đặc tả kiến trúc 4 tầng phân lập trạng thái cục bộ và trạng thái chia sẻ trên Whiteboard thời gian thực (Antiwhite & Miro Standard).**

---

## 1. Kiến Trúc 4 Tầng Phân Lập Trạng Thái (4-Tier Architectural Model)

Để đảm bảo hiệu năng cao, không gây xung đột mạng và giữ gìn sự riêng tư tuyệt đối cho người dùng theo chuẩn Miro, toàn bộ trạng thái của ứng dụng được phân tầng thành 4 cấp độ độc lập:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       4-TIER STATE ISOLATION ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [TIER 1: GLOBAL PERSISTENT SHARED LAYER] (Mọi người cùng thấy, lưu trữ)   │
│   ├── Hocuspocus WebSocket Server (/ws)                                     │
│   ├── Y.Doc & Y.Map<AnyShape> ('shapes')                                    │
│   └── PostgreSQL / IndexedDB Persistence (Local & Cloud backup)             │
│        └── Shapes: id, type, x, y, w, h, text, previewText, fill, stroke...  │
│                               ▲                                             │
│                               │ WebSocket CRDT Sync                         │
│                               ▼                                             │
│  [TIER 2: TRANSIENT AWARENESS COLLABORATION LAYER] (Thời gian thực tạm thời)│
│   ├── Y.Awareness Protocol                                                  │
│   ├── CollabUser: id, anonymousNumber, name, avatarLabel, color, joinedAt   │
│   └── CollabCursor: x (World), y (World), lastUpdate                        │
│        (Tuyệt đối KHÔNG chứa Selection hay Editing State)                   │
│                               ▲                                             │
│                               │ Local Event Dispatch                        │
│                               ▼                                             │
│  [TIER 3: CLIENT-LOCAL ENGINE RUNTIME LAYER] (Nội bộ CanvasEngine)          │
│   ├── CanvasEngine instance (1 instance per browser tab)                    │
│   ├── this.sel: Set<string> (ID các đối tượng đang chọn trên máy này)       │
│   ├── this.cam: { x, y, zoom } (Vị trí và tỷ lệ zoom của màn hình này)      │
│   ├── this.editingId: string | null (ID đối tượng đang double-click sửa)    │
│   ├── Gesture flags: isPanning, isDragging, isResizing, isBoxing            │
│   └── In-flight rendering: Marquee box, Rubberband rect, Pen buffer         │
│                               ▲                                             │
│                               │ React Props / Callbacks                     │
│                               ▼                                             │
│  [TIER 4: CLIENT-LOCAL REACT DOM OVERLAYS] (Giao diện soạn thảo cá nhân)   │
│   ├── React Component Tree (App.tsx)                                        │
│   ├── editShape (React State): Chỉ tồn tại trên máy người đang sửa          │
│   ├── FormulaEditor & MathToolsPanel (Bàn phím toán học và LaTeX bar)       │
│   ├── CodeEditor (CodeMirror shell)                                         │
│   ├── Inline Textarea (.board-text-editor)                                  │
│   └── App Modals: Inspector Panel, SQL DDL Modal, Color Picker, Menus       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Phân Tích Chi Tiết Từng Tầng Kiến Trúc

### 2.1. Tier 1: Global Persistent Shared Layer (CRDT Map)
* **Công nghệ cốt lõi:** Yjs `Y.Map<AnyShape>('shapes')` kết nối qua Hocuspocus WebSocket Provider.
* **Đặc tính:**
  * **Eventual Consistency:** Đảm bảo mọi thay đổi hình học (tọa độ, kích thước, góc xoay, màu sắc) và nội dung (chữ, công thức toán) đều đạt tới tính nhất quán cuối cùng giữa tất cả các máy khách.
  * **Conflict-Free:** Sử dụng thuật toán CRDT (Conflict-free Replicated Data Type) để tự động giải quyết xung đột khi nhiều người sửa đổi các đối tượng khác nhau.
  * **Dữ liệu được lưu trữ:**
    ```typescript
    export interface MathShape {
      id: string;
      type: 'math';
      x: number; y: number; w: number; h: number;
      text: string;         // Mã LaTeX/Telex gốc (e.g. "x^2 + y^2 = r^2")
      previewText: string;  // Chuỗi xem trước đã kiểm tra hợp lệ
      fs: number;           // Cỡ chữ
      rotation?: number;
    }
    ```
* **Ranh giới bảo mật:** Chỉ những thuộc tính định nghĩa đối tượng được lưu vào Tier 1. Không lưu bất kỳ thông tin nào về con trỏ, khung chọn hay bảng công cụ của người dùng vào đây.

---

### 2.2. Tier 2: Transient Awareness Collaboration Layer (Presence)
* **Công nghệ cốt lõi:** Yjs `Awareness` Protocol chạy song song trên cùng kết nối WebSocket `/ws`.
* **Cơ chế đàm phán URL động (Dynamic Domain & Protocol Negotiation):**
  * Hàm `resolveRealtimeWsUrl()` tự động phân giải endpoint theo `window.location.href`, tự chuyển `http:` $\to$ `ws:` và `https:` $\to$ `wss:`.
  * Hỗ trợ triển khai đa domain, reverse proxy (Nginx, Traefik), subpath mà không cần sửa code hay fix cứng `localhost`.
* **Thuật toán sinh màu Tỉ Lệ Vàng (Golden Ratio Color Engine):**
  * Để phục vụ hàng trăm đến hàng ngàn người dùng đồng thời mà **không ai bị trùng màu nhau**:
    $$H_k = ((k - 1) \times 137.50776405^\circ) \pmod{360^\circ}$$
  * Kết hợp 8 dải bão hòa/độ sáng phân lớp mang lại **28,800+ màu sắc độc nhất**, tự động tính độ tương phản WCAG 2.1 cho text.
  * Thuật toán kiểm tra `takenColors` từ các client đang online để đảm bảo 0% xung đột màu sắc. Chỉ khi vượt quá 28,800 người dùng trực tuyến mới kích hoạt ngẫu nhiên an toàn.
* **Tối ưu hóa con trỏ cho số lượng lớn người dùng (High Concurrency & Viewport Culling):**
  * `RemoteCursorsOverlay` áp dụng kỹ thuật **Spatial Viewport Culling**: chỉ render những con trỏ nằm trong tầm nhìn thực tế của camera (+160px đệm). Con trỏ ở xa bị loại khỏi DOM, bảo toàn 60 FPS cho 500+ người dùng.
  * Hiệu ứng mờ dần khi bất động (Idle Decaying): đầy đủ trong 10s đầu, mờ dần xuống 35% từ 10s-20s, và tự động thu hồi hoàn toàn sau 20s.
* **Quy Tắc Vàng (The Golden Privacy Rule):**
  * `selectedShapeIds` **BỊ LOẠI BỎ HOÀN TOÀN** khỏi Awareness payload. Nhờ đó, việc Người dùng A chọn 1 hay 50 hình khối không bao giờ tiêu tốn 1 byte băng thông gửi đến Người dùng B, và Người dùng B không có cách nào biết được Người dùng A đang chọn hình nào.

---

### 2.3. Tier 3: Client-Local Engine Runtime Layer (CanvasEngine)
* **Công nghệ cốt lõi:** HTML5 Canvas 2D Context + R-Tree Spatial Indexing.
* **Trạng thái cục bộ hoàn toàn:**
  * `this.sel`: Đối tượng `Set<string>` lưu danh sách ID hình khối được chọn trên thiết bị hiện tại.
    * Khi vẽ, hàm `drawSelection(shape)` kiểm tra `if (this.sel.has(shape.id))`. Vì `this.sel` trên máy Người dùng B là rỗng, Người dùng B chỉ vẽ hình khối thông thường mà không vẽ khung viền xanh hay 8 nút co giãn.
  * `this.cam`: Bộ 3 tọa độ `{ x, y, zoom }`. Camera của mỗi máy độc lập 100%, không truyền qua WebSocket.
  * `this.editingId`: ID của hình khối đang được người dùng trên máy này mở chỉnh sửa.

---

### 2.4. Tier 4: Client-Local React DOM Overlays (Trình Soạn Thảo Độc Quyền)
* **Công nghệ cốt lõi:** React 19 State (`useState`, `useRef`, DOM Portals).
* **Cơ chế hoạt động:**
  * Biến trạng thái `editShape` được khai báo trong `App.tsx`:
    ```typescript
    const [editShape, setEditShape] = useState<AnyShape | null>(null);
    ```
  * `editShape` chỉ nhận giá trị khi người dùng **trên chính máy đó** nhấp đúp (double-click) vào đối tượng.
  * Do `editShape` là React State cục bộ của component `App`, trên máy của tất cả các cộng tác viên khác, `editShape` luôn bằng `null`.
  * Các component con chỉ được render khi điều kiện thỏa mãn:
    ```tsx
    {editShape && editShape.type === 'math' && (
      <FormulaEditorBoundary ...>
        <FormulaEditor ... />
        {/* MathToolsPanel nằm bên trong FormulaEditor */}
      </FormulaEditorBoundary>
    )}
    ```
  * **Hệ quả kiến trúc:** Không có bất kỳ dòng HTML, CSS hay JavaScript nào của `MathToolsPanel` hay `FormulaEditor` được sinh ra trên trình duyệt của Người dùng B.

---

## 3. Luồng Dữ Liệu Thời Gian Thực Khi Soạn Thảo Toán Học (Data Flow Pipeline)

Biểu đồ tuần tự dưới đây mô tả chính xác quá trình Người dùng A gõ công thức toán học và Người dùng B quan sát kết quả:

```
[User A: Màn Hình Soạn Thảo]              [Server WebSocket]          [User B: Màn Hình Quan Sát]
      │                                         │                                │
      ├─ 1. Double-click khối Math              │                                │
      │   (Set editShape cục bộ)                │                                │
      │   Mở FormulaEditor & MathToolsPanel    │                                │
      │                                         │                                │
      ├─ 2. Gõ: "E = mc^2"                      │                                │
      │   onTextChange("E = mc^2")              │                                │
      │   updateFormulaLive(...)                │                                │
      │                                         │                                │
      ├─ 3. yShapes.set("math-1", {             │                                │
      │       text: "E = mc^2",                 │                                │
      │       previewText: "E = mc^2"           │                                │
      │     })                                  │                                │
      │         ───────────────────────────────>│ (CRDT Sync Update)             │
      │                                         │───────────────────────────────>│
      │                                         │                                │ 4. yShapes.observe fires
      │                                         │                                │    CanvasEngine nhận shape mới
      │                                         │                                │    s.id !== this.editingId (TRUE)
      │                                         │                                │
      │                                         │                                ├─ 5. Render Math Preview:
      │                                         │                                │    parseTelex("E = mc^2")
      │                                         │                                │    renderFormulaToHTML(...)
      │                                         │                                │    Hiển thị KaTeX Preview trên canvas!
      │                                         │                                │    (KHÔNG có MathTools, KHÔNG có editor)
      │                                         │                                │
      ├─ 6. Bấm Escape / Click ngoài            │                                │
      │   (Đóng FormulaEditor & MathTools)      │                                │
      │   commitEdit()                          │                                │
      │   editShape = null                      │                                │
```

---

## 4. Tối Ưu Băng Thông & Đảm Bảo Tính Riêng Tư

1. **Không Phát Tán Trạng Thái Bàn Phím (Zero Keystroke Awareness Leakage):**
   * Các phím gõ di chuyển con trỏ trong ô công thức, việc bấm nút chuyển tab trong `MathToolsPanel` (ví dụ chuyển tab "Symbols", "Greek", "Calculus") đều chỉ xử lý nội bộ trong bộ nhớ RAM của máy khách.
2. **Throttled Live Preview Synchronization:**
   * Việc cập nhật công thức toán học (`updateFormulaLive`) chỉ gửi dữ liệu khi biểu thức toán học parse ra hợp lệ (valid AST preview), ngăn chặn việc gửi rác hay chuỗi cú pháp lỗi tạm thời qua mạng.
3. **Loại Bỏ Selection Polling:**
   * Không có bất kỳ bộ đếm thời gian hay polling nào gửi danh sách vùng chọn qua WebSocket.
