# Kế Hoạch Tổng Thể Chuẩn Hóa Toàn Diện ERD & Database Diagram (Master Specification)

> **Tài liệu đặc tả kiến trúc, mô hình dữ liệu, vector rendering và trải nghiệm tương tác (In-Place Text Editing & Spreadsheet Navigation)**  
> **Tham chiếu chuẩn công nghiệp hàng đầu:**  
> - [Draw.io / diagrams.net — Entity Relation & Database Tables](https://www.drawio.com/blog/entity-relationship-tables)  
> - [Lucidchart — Database & ERD Diagramming Guide](https://www.lucidchart.com/pages/er-diagrams)  
> - [Visual Paradigm — Entity Relationship Diagram (ERD) Guide](https://www.visual-paradigm.com/guide/data-modeling/what-is-entity-relationship-diagram/)  
> - [StarUML — ERD Modeling & Crow's Foot Notation](https://docs.staruml.io/user-guide/modeling-with-erd)  
> - [DBeaver Desktop — ERD Database Visualizer & IDEF1X Standard](https://dbeaver.com/docs/desktop/Entity-Relationship-Diagrams-ERD/)  
> - [dbdiagram.io — DBML & Modern Table Modeling Workflow](https://dbml.dbdiagram.io/docs/)  
> - [ANSI/ISO SQL Foundation & IDEF1X Integration Definition for Information Modeling](https://nvlpubs.nist.gov/nistpubs/Legacy/FIPS/fipspub184.pdf)

---

## 1. Tổng Quan & Phân Tích Thực Trạng Codebase

### 1.1. Bối Cảnh & Động Lực
Ứng dụng canvas hiện tại đã hỗ trợ một số hình khối cơ bản của ERD và Database Diagram, tuy nhiên trải nghiệm thực tế vẫn còn nhiều điểm bất cập nghiêm trọng khiến người dùng cảm thấy "càng sửa càng lỗi":
1. **Trải nghiệm gõ text bị gián đoạn và nhảy giao diện (Text Jitter & Cognitive Friction):**
   - Trên canvas, cột CSDL được vẽ thành 3 cột tách biệt: `[Badge PK/FK]` | `Tên cột *` | `Kiểu dữ liệu (monospaced, canh phải)`.
   - Khi double-click để sửa, thay vì mở ô nhập liệu đúng tại vị trí con trỏ hoặc cho phép sửa từng cell, hệ thống lại mở một ô textarea đơn độc chứa chuỗi thô: `PK id : bigint NOT NULL`. Toàn bộ badge đồ họa biến mất, text bị canh trái toàn bộ, người dùng buộc phải nhớ cú pháp gõ từ khóa `PK`, dấu hai chấm `:`, và `NOT NULL`. Nếu gõ sai khoảng trắng hoặc quên dấu hai chấm, parser phân tích sai tên và kiểu dữ liệu.
   - Nhấn phím `Enter` không tạo dòng mới hay chuyển sang dòng tiếp theo (như Draw.io / Lucidchart / dbdiagram.io) mà lập tức đóng editor, buộc người dùng phải dùng chuột quay sang thanh công cụ Inspector bên phải để bấm nút thêm cột.
2. **Ký hiệu Chen ERD còn thiếu và chưa chuẩn xác:**
   - Thiếu ký hiệu Khóa bộ phận / Phân biệt đối tượng yếu (*Partial Key / Discriminator Attribute* với nét gạch chân đứt quãng theo chuẩn Chen).
   - Thiếu quan hệ Tham gia toàn phần (*Total Participation / Existence Dependency* với đường đôi song song).
   - Hình thoi lồng nhau của Quan hệ nhận diện (*Identifying Relationship*) trước đây bị co thắt không đều theo tỷ lệ hình học.
3. **Mối liên kết giữa các bảng CSDL (Foreign Key Connections) chưa neo vào từng dòng cột:**
   - Trong Draw.io, Lucidchart, DBeaver và dbdiagram.io, một đường quan hệ Crow's Foot nối từ **chính xác dòng cột FK của bảng con** sang **chính xác dòng cột PK của bảng cha**.
   - Việc chỉ nối vào tâm hoặc hộp bao ngoài của bảng làm mất đi ý nghĩa tham chiếu của mô hình CSDL quan hệ.
4. **Sự chậm trễ do chia nhỏ Phase hình thức:**
   - Việc chia vụn thành Phase 1, Phase 2, Phase 3 một cách máy móc đã gây ra tình trạng "đầu voi đuôi chuột": sửa được viền textarea thì lại gỡ bỏ các preset và nút điều khiển trong Inspector; thêm được badge cột thì inline editor lại không đồng bộ.
   - **Mục tiêu của tài liệu này:** Xóa bỏ toàn bộ cách tiếp cận phân mảnh. Thiết lập một bản thiết kế toàn diện, đồng bộ từ lõi dữ liệu, thuật toán vector, cơ chế hit-test đến tương tác gõ text chuẩn Draw.io / Lucidchart.

---

## 2. Chuẩn Công Nghiệp: Cách Draw.io, Lucidchart, Visual Paradigm & StarUML Xử Lý Text Diagram

Để đạt được trải nghiệm hoàn hảo như các phần mềm hàng đầu thế giới, hệ thống text editing trong diagram cần tuân thủ 5 nguyên lý cốt lõi:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 NGUYÊN LÝ XỬ LÝ TEXT TRONG DIAGRAM CHUYÊN NGHIỆP             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Zero-Jitter Metric Parity   : DOM font, size, weight, line-height 1:1    │
│ 2. Sub-Cell Hit Testing        : Double-click trúng đâu, sửa đúng tại đó     │
│ 3. Spreadsheet-Style Keyboard  : Tab (đổi field), Enter (thêm dòng mới)      │
│ 4. Geometry-Constrained Safe Area: Hình thoi, elip text nội tiếp an toàn    │
│ 5. Zoom-Invariant World Space  : Không nhân zoom bậc 2, render sắc nét ở mọi zoom│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1. Đồng Bộ Tuyệt Đối Font Metrics Giữa Canvas & DOM (Zero-Jitter WYSIWYG)
- **Vấn đề thường gặp:** Khi click vào để sửa, chữ bị co giật, lệch vài pixel, hoặc đổi font weight khiến người dùng có cảm giác "giả tạo".
- **Chuẩn Draw.io / Lucidchart:**
  - Font family dùng chung một stack duy nhất: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
  - Font size được định nghĩa theo **tọa độ thế giới (world units)**, ví dụ `14px`. Container DOM dùng `transform: scale(${zoom})` để phóng đại đồng thời cả vị trí và kích thước.
  - Line-height cố định `1.35`. Padding trên canvas và padding của textarea phải bằng nhau chính xác đến $0.5\text{px}$.
  - Khi double-click, textarea xuất hiện đè khít lên vị trí vẽ của canvas, người dùng nhìn vào không nhận ra có sự thay đổi giữa ảnh tĩnh và input thật.

### 2.2. Cơ Chế Hit-Test Từng Cell Trong Hình Khối Phức Tạp (Sub-Cell Granularity)
Một bảng Database (`erd.er-table`) hoặc UML Classifier không phải là một khối chữ nhật đơn khối. Nó gồm 3 phân vùng độc lập:
1. **Header Cell (Tên bảng & Schema):**
   - Click đúp vào Header $\rightarrow$ Mở editor đúng tại Header, canh giữa (hoặc canh trái), font đậm $14\text{px}$, gõ tên bảng trực tiếp.
2. **Column Row Name Cell (Tên cột):**
   - Click đúp vào tên cột $\rightarrow$ Mở editor tại vị trí tên cột.
3. **Column Row Type Cell (Kiểu dữ liệu):**
   - Click đúp vào phần kiểu dữ liệu $\rightarrow$ Mở ô gợi ý/nhập kiểu dữ liệu (monospaced font).

### 2.3. Điều Hướng Bàn Phím Kiểu Bảng Tính (Spreadsheet-Style Keyboard Workflow)
Đây là "vũ khí bí mật" giúp các nhà thiết kế CSDL trên **Lucidchart** và **dbdiagram.io** dựng xong 10 bảng trong vài phút mà không cần đụng chuột:
- Khi đang sửa một dòng cột trong bảng:
  - **Phím `Tab`:** Nhảy từ ô *Tên cột* $\rightarrow$ ô *Kiểu dữ liệu* $\rightarrow$ toggle *PK/FK* $\rightarrow$ dòng kế tiếp.
  - **Phím `Shift + Tab`:** Nhảy ngược lại trường trước đó.
  - **Phím `Enter`:** Tự động commit dòng hiện tại, **tạo ngay một dòng cột mới ngay bên dưới** và focus con trỏ vào ô nhập tên cột mới!
  - **Phím `Arrow Up` / `Arrow Down`:** Di chuyển con trỏ lên dòng trên hoặc xuống dòng dưới.
  - **Phím `Backspace` trên dòng rỗng:** Xóa dòng đó và đưa focus về dòng liền kề.
  - **Phím `Escape`:** Hoàn tất chỉnh sửa, lưu dữ liệu và đóng editor.

### 2.4. Vùng An Toàn Hình Học Của Hình Thoi & Elip (Geometry-Constrained Safe Bounds)
- **Hình thoi (Diamond):** Điểm nhọn ở 4 đỉnh cắt vào không gian chữ nhật.  
  Công thức vùng an toàn nội tiếp lớn nhất:
  $$W_{\text{safe}} = \frac{W}{\sqrt{2}} \approx 0.707 \cdot W, \quad H_{\text{safe}} = \frac{H}{\sqrt{2}} \approx 0.707 \cdot H$$
  Khi có viền đôi (Identifying Relationship), trừ thêm khoảng cách offset $2 \times gap$:
  $$W_{\text{safe\_id}} = 0.65 \cdot W, \quad H_{\text{safe\_id}} = 0.52 \cdot H$$
  Padding dọc luôn được tính động:
  $$\text{padY} = \max\left(2, \frac{H_{\text{box}} - \text{fontSize} \times 1.35}{2}\right)$$
  Bảo đảm văn bản luôn nằm cân đối ở trọng tâm hình thoi, không bao giờ bị cắt vát bởi các cạnh nghiêng.
- **Hình Elip (Ellipse):**
  Trục ngang và trục đứng co lại theo phương trình $\frac{x^2}{a^2} + \frac{y^2}{b^2} \le 1$.
  Vùng chữ nhật an toàn bên trong: $W_{\text{safe}} = 0.75 \cdot W$, $H_{\text{safe}} = 0.68 \cdot H$, căn giữa ngang `textAlign: 'center'`.

---

## 3. Danh Mục Toàn Diện Các Hình Khối ERD & Database Diagram

Hệ thống phân tách rành mạch hai phương pháp luận mô hình hóa CSDL:
1. **Mô hình Khái niệm Chen (Chen ERD Notation):** Dành cho phân tích nghiệp vụ, thực thể, mối quan hệ và thuộc tính.
2. **Mô hình Quan hệ Vật lý / Bảng CSDL (Crow's Foot / Relational / IDEF1X):** Dành cho thiết kế schema CSDL chi tiết, khóa chính, khóa ngoại, kiểu dữ liệu SQL và mối quan hệ bảng.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 DANH MỤC CÁC PHẦN TỬ ERD & DATABASE DIAGRAM                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ CHEN ERD (CONCEPTUAL):                                                      │
│  ├── [erd.entity]                 : Thực thể mạnh (Chữ nhật đơn)            │
│  ├── [erd.weak-entity]            : Thực thể yếu (Chữ nhật kép song song)   │
│  ├── [erd.associative-entity]     : Thực thể kết hợp (Hình thoi trong nhật) │
│  ├── [erd.relationship]           : Mối quan hệ (Hình thoi đơn)             │
│  ├── [erd.identifying-relationship: Quan hệ xác định (Hình thoi kép song song│
│  ├── [erd.attribute]              : Thuộc tính thường (Elip đơn)            │
│  ├── [erd.primary-key-attribute]  : Thuộc tính khóa chính (Gạch chân liền)  │
│  ├── [erd.partial-key-attribute]  : Thuộc tính khóa bộ phận (Gạch chân đứt) │
│  ├── [erd.foreign-key-attribute]  : Thuộc tính khóa ngoại (Badge FK / nét đứt)
│  ├── [erd.multivalued-attribute]  : Thuộc tính đa trị (Elip kép song song)  │
│  ├── [erd.derived-attribute]      : Thuộc tính dẫn xuất (Elip nét đứt)      │
│  ├── [erd.composite-attribute]    : Thuộc tính phức hợp (Nhánh cây elip)    │
│  └── Chen Connectors              : Nét đơn (Partial) vs Nét đôi (Total)    │
│                                                                             │
│ RELATIONAL / DATABASE (PHYSICAL / LOGICAL):                                 │
│  ├── [erd.er-table]               : Bảng CSDL (Header + PK + Columns)       │
│  ├── [erd.view]                   : Database View (Header kèm badge [VIEW]) │
│  ├── [erd.database]               : Khối lưu trữ CSDL (Hình trụ Cylinder)   │
│  ├── Relational Connectors        : Solid (Identifying) vs Dashed (Non-Id) │
│  └── Crow's Foot Cardinalities    : || (1:1), |< (1:N), o< (0:N), o| (0:1)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1. Chi Tiết Ký Hiệu Mô Hình Chen ERD

| Mã Hình Khối (`shapeId`) | Tên Gọi Ký Hiệu | Hình Học & Vector Stroke | Ngữ Nghĩa & Đặc Tả Text |
| :--- | :--- | :--- | :--- |
| `erd.entity` | Strong Entity | Hình chữ nhật nét đơn ($W: 130, H: 65$) | Tên thực thể in hoa/viết hoa chữ cái đầu, in đậm ($600$), căn giữa. |
| `erd.weak-entity` | Weak Entity | Hai hình chữ nhật lồng nhau song song cách nhau $4\text{px}$ | Biểu diễn thực thể phụ thuộc tồn tại vào thực thể cha. Text căn giữa. |
| `erd.associative-entity` | Associative Entity | Hình chữ nhật bên ngoài chứa hình thoi bên trong | Thực thể liên kết đa trị vừa là bảng vừa là quan hệ. Text nằm trong hình thoi. |
| `erd.relationship` | Relationship | Hình thoi nét đơn ($W: 110, H: 75$) | Tên quan hệ (động từ, vd: `places`, `contains`, `manages`), căn giữa. |
| `erd.identifying-relationship` | Identifying Rel | Hai hình thoi lồng nhau song song cách đều $4\text{px}$ | Nối giữa Weak Entity và Strong Entity. Text nằm gọn trong hình thoi trong. |
| `erd.attribute` | Simple Attribute | Hình elip nét đơn ($W: 115, H: 55$) | Tên thuộc tính, font thường ($400$), căn giữa. |
| `erd.primary-key-attribute` | Primary Key Attribute | Hình elip nét đơn, text có **gạch chân nét liền (`solid underline`)** | Khóa chính của thực thể. Nét gạch chân cách chân chữ $2\text{px}$. |
| `erd.partial-key-attribute` | Partial Key / Discriminator | Hình elip nét đơn, text có **gạch chân nét đứt (`dashed underline`)** | Khóa bộ phận của thực thể yếu (vd: `item_no` trong `order_items`). |
| `erd.multivalued-attribute` | Multivalued Attribute | Hai hình elip lồng nhau song song cách nhau $3.5\text{px}$ | Thuộc tính có thể nhận nhiều giá trị (vd: `phone_numbers`, `skills`). |
| `erd.derived-attribute` | Derived Attribute | Hình elip vẽ bằng **nét đứt (`dashed: [6, 4]`)** | Thuộc tính tính toán từ thuộc tính khác (vd: `age` tính từ `birth_date`). |
| `erd.composite-attribute` | Composite Attribute | Cụm thuộc tính phân nhánh phân cấp | Thuộc tính cha nối ra các thuộc tính con (vd: `address` $\rightarrow$ `street, city, zip`). |

### 3.2. Chi Tiết Ký Hiệu Chen Connector (Tham Gia Toàn Phần vs Bộ Phận)
Theo đặc tả của **Peter Chen (1976)**:
- **Tham gia bộ phận (Partial Participation):** Biểu diễn bằng **đường đơn (Single Line)**. Thực thể có thể tồn tại mà không nhất thiết phải tham gia vào quan hệ (vd: một nhân viên có thể chưa được phân công dự án nào).
- **Tham gia toàn phần (Total Participation / Existence Dependency):** Biểu diễn bằng **đường đôi song song (Double Parallel Line)** cách nhau $3.5\text{px}$. Mọi thể hiện của thực thể bắt buộc phải tham gia vào quan hệ (vd: mọi đơn hàng bắt buộc phải thuộc về một khách hàng).
- **Trường dữ liệu mở rộng:**
  ```typescript
  export interface ConnectorShapeObject {
    ...
    /** Chen ERD: 'total' renders parallel double lines (3.5px gap); 'partial' or undefined renders single line */
    erdParticipation?: 'partial' | 'total';
  }
  ```

---

## 4. Chi Tiết Bảng CSDL (Database Table Entity — Crow's Foot & IDEF1X)

### 4.1. Cấu Trúc Đồ Họa 3 Tầng (3-Tier Compartment Layout)
Bảng CSDL chuẩn công nghiệp (theo phong cách **DBeaver, Lucidchart, dbdiagram.io**) có cấu trúc như sau:

```
┌─────────────────────────────────────────────────────────────┐
│  orders                                             [TABLE] │  ← HEADER COMPARTMENT (Tên bảng, nền dịu, đậm)
├─────────────────────────────────────────────────────────────┤
│ [PK]  id *                                           BIGINT │  ← PRIMARY KEY COMPARTMENT
├─────────────────────────────────────────────────────────────┤  ← VẠCH KẺ NGĂN CÁCH IDEF1X (Thước đo phân cách PK)
│ [FK]  customer_id *                                  BIGINT │  ← REGULAR COLUMNS COMPARTMENT
│       order_date *                                TIMESTAMP │
│       total_amount                            NUMERIC(12,2) │
│       status                                    VARCHAR(50) │
│       notes                                            TEXT │
│       created_at *                                TIMESTAMP │
└─────────────────────────────────────────────────────────────┘
```

1. **Header Compartment:**
   - Chiều cao: $\max(34\text{px}, \text{h} \times 0.22)$.
   - Màu nền: Header sử dụng sắc màu hiện đại, nhẹ nhàng (`#f8fafc` hoặc gradient xanh nhạt `#eff6ff`).
   - Tên bảng: Font chữ Inter $650$, màu tối `#0f172a`.
   - Badge loại đối tượng: Hiển thị nhỏ ở góc phải: `[TABLE]` hoặc `[VIEW]`.
2. **Primary Key Compartment (Khóa chính):**
   - Chứa các cột có `key === 'primary'` hoặc `key === 'primary_foreign'`.
   - Badge `PK`: Pill bo tròn, nền vàng hổ phách nhạt `#fef3c7`, viền `#f59e0b`, chữ `#b45309` đậm.
   - Tên cột PK: In đậm $650$.
   - Dấu bắt buộc `*`: Màu đỏ `#ef4444` hiển thị ngay sau tên cột nếu `nullable === false`.
   - Vạch kẻ IDEF1X: Đường kẻ ngang đậm nét ngăn cách rõ ràng giữa nhóm cột Khóa chính và các cột thường còn lại bên dưới.
3. **Regular Columns Compartment (Cột thường & Khóa ngoại):**
   - Chứa các cột dữ liệu thông thường, khóa ngoại `FK` và khóa duy nhất `UK`.
   - Badge `FK`: Nền xanh dương nhạt `#dbeafe`, viền `#3b82f6`, chữ `#1d4ed8`.
   - Badge `PK, FK`: Nền tím nhạt `#f3e8ff`, viền `#a855f7`, chữ `#7e22ce`.
   - Badge `UK`: Nền xanh lá nhạt `#dcfce7`, viền `#22c55e`, chữ `#15803d`.
   - Kiểu dữ liệu: Canh phải, font monospace (`'SF Mono', Consolas, monospace`), màu ghi `#64748b`.

### 4.2. Neo Kết Nối Theo Dòng Cột (Row-Level Connection Anchors)
Trong file `semantics.ts`, provider `'structured-table-rows'` sẽ tính toán chính xác tọa độ điểm neo kết nối ở hai bên mép trái/phải của **từng dòng cột**:
- Neo trái: `table-row:${column.id}:left` $\rightarrow$ Tọa độ $(x: 0, y: \text{rowCenterY})$.
- Neo phải: `table-row:${column.id}:right` $\rightarrow$ Tọa độ $(x: \text{width}, y: \text{rowCenterY})$.
Nhờ đó, một connector Foreign Key xuất phát từ mép phải dòng `customer_id` của bảng `orders` sẽ chạy sang cắm thẳng vào mép trái dòng `id` của bảng `customers`.

---

## 5. Trải Nghiệm Tương Tác: In-Place Inline Editing & Keyboard Navigation

### 5.1. Thiết Kế Trình Soạn Thảo Inline Từng Cột (Column In-Place Editor)
Khi người dùng double-click vào một dòng cột trong bảng, hệ thống sẽ mở một overlay tương tác chuyên biệt:

```
┌─────────────────────────────────────────────────────────────┐
│ [ PK ▼ ] [ column_name      ] : [ VARCHAR(255) ▼ ] [NN ☑] [✕] │
└─────────────────────────────────────────────────────────────┘
```

- **Ô chọn Khóa (`Key Select`):** Nhanh chóng chọn `None`, `PK`, `FK`, `PK, FK`, `UK`.
- **Ô nhập Tên cột (`Name Input`):** Tự động select toàn bộ text khi mở.
- **Ô chọn Kiểu dữ liệu (`Data Type Combobox`):** Cho phép gõ tự do (vd: `varchar(100)`) hoặc bấm danh sách gợi ý 10 kiểu SQL phổ biến:
  - `bigint`, `integer`, `varchar(255)`, `text`, `timestamp`, `boolean`, `numeric(12,2)`, `uuid`, `jsonb`, `date`.
- **Nút Checkbox `NN` (Not Null):** Click để bật/tắt ràng buộc bắt buộc.
- **Phím tắt xử lý:**
  - `Enter`: Lưu dòng hiện tại $\rightarrow$ Thêm ngay 1 cột mới bên dưới $\rightarrow$ Chuyển focus vào ô tên cột mới.
  - `Tab`: Chuyển giữa các trường trong dòng.
  - `Arrow Up / Down`: Chuyển lên/xuống giữa các cột trong bảng.
  - `Escape`: Đóng overlay và lưu dữ liệu.

### 5.2. Các Bộ Preset An Toàn Cho Bảng CSDL (Smart Inspector Presets)
Trên thanh Inspector bên phải, cung cấp 3 nút bấm thao tác nhanh thông minh (idempotent, không gây phá vỡ dữ liệu):

```
┌─────────────────────────────────────────────────────────────┐
│ [+ Add Column]   [+ ID (PK)]   [+ Timestamps]   [+ Soft Del]│
└─────────────────────────────────────────────────────────────┘
```

1. **Nút `+ ID (PK)` (Chèn Khóa chính chuẩn):**
   - **Quy tắc an toàn:**
     - Nếu bảng chưa có PK và chưa có cột `id`: Chèn cột `{ name: 'id', type: 'bigint', key: 'primary', nullable: false }` vào **vị trí đầu tiên (index 0)**.
     - Nếu bảng đã có cột `id` nhưng chưa phải PK: Hiển thị thông báo hướng dẫn, không tự ý ghi đè metadata của người dùng.
     - Nếu bảng đã có Natural PK (vd: `code PK`) hoặc Composite PK: Giữ nguyên, không ghi đè làm mất khóa chính hiện hữu.
2. **Nút `+ Timestamps` (Tự động thêm cặp dấu thời gian):**
   - Kiểm tra cột `created_at` và `updated_at`. Nếu chưa có, thêm vào cuối bảng:
     - `created_at : timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP`
     - `updated_at : timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP`
   - Bấm nhiều lần sẽ không tạo ra các cột trùng lặp.
3. **Nút `+ Soft Delete` (Thêm cột xóa mềm):**
   - Kiểm tra cột `deleted_at`. Nếu chưa có, thêm vào cuối bảng:
     - `deleted_at : timestamp NULL` (không thêm chuỗi thừa `default: 'NULL'`).

---

## 6. Mô Hình Dữ Liệu & Tính Tương Thích Ngược (Data Model & Compatibility)

### 6.1. Định Nghĩa Dữ Liệu Cột Bảng (`TableColumnModel`)
Mở rộng kiểu dữ liệu trong `src/engine/shapes/types.ts`:

```typescript
export interface TableColumnModel {
  id: string;
  name: string;
  type: string;
  key?: 'none' | 'primary' | 'foreign' | 'primary_foreign' | 'unique';
  nullable?: boolean;
  default?: string;
  comment?: string;
}

export interface TableShapeData {
  table?: {
    columns: TableColumnModel[];
    schema?: string;
    comment?: string;
  };
}
```

### 6.2. Bảo Toàn Dữ Liệu Khi Lưu Trữ (`model.ts`)
- Trong `sanitizeData()`: Giữ nguyên các trường nguyên thủy `name`, `type`, `key`, `nullable`, `default`.
- Trong `deserializeBoardShape()`:
  - Whitelist các trường mở rộng của `erdParticipation` trên connector:
    ```typescript
    ...(raw.erdParticipation === 'total' || raw.erdParticipation === 'partial'
      ? { erdParticipation: raw.erdParticipation }
      : definition.connector?.erdParticipation ? { erdParticipation: definition.connector.erdParticipation } : {}),
    ```
  - Khôi phục đầy đủ mảng `columns` với các cờ `nullable` và `default`.

---

## 7. Lộ Trình Triển Khai Kỹ Thuật Chi Tiết (Implementation Roadmap)

Quá trình triển khai sẽ được thực hiện tuần tự qua 4 module kỹ thuật độc lập, có kiểm thử hồi quy chặt chẽ:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LỘ TRÌNH TRIỂN KHAI KỸ THUẬT                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ MODULE 1: Hệ Thống Hình Học Vector & Ký Hiệu Chen ERD Hoàn Chỉnh            │
│  ├── Đăng ký erd.partial-key-attribute (gạch chân nét đứt)                  │
│  ├── Đăng ký erd.total-participation (connector nét đôi song song)          │
│  └── Chuẩn hóa thuật toán double-diamond & double-ellipse                   │
│                                                                             │
│ MODULE 2: Bảng CSDL 3 Tầng, IDEF1X Divider & Neo Dòng Cột                   │
│  ├── Render Table/View theo chuẩn IDEF1X (Header, PK compartment, Divider)   │
│  ├── Badge màu chuyên nghiệp cho PK, FK, PK/FK, UK                           │
│  └── Đăng ký connection provider neo vào từng dòng cột                      │
│                                                                             │
│ MODULE 3: Trình Soạn Thảo In-Place & Điều Hướng Bàn Phím Bảng Tính          │
│  ├── Sub-cell hit testing cho Header và từng dòng cột                       │
│  ├── Tương tác bàn phím: Enter (thêm dòng), Tab (đổi ô), Arrow Up/Down      │
│  └── Popup combo gợi ý 10 kiểu dữ liệu SQL chuẩn                            │
│                                                                             │
│ MODULE 4: Smart Presets Inspector, SQL DDL Export & Kiểm Thử Tự Động        │
│  ├── Bộ 3 nút an toàn: + ID (PK), + Timestamps, + Soft Delete               │
│  ├── Modal xem nhanh câu lệnh CREATE TABLE (PostgreSQL, MySQL, SQLite)      │
│  └── Bộ test Playwright đa mức zoom (0.5, 0.8, 1.0, 1.5) & Unit Tests       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Module 1: Hệ Thống Hình Học Vector & Ký Hiệu Chen ERD Hoàn Chỉnh
- **Tệp thay đổi:**
  - `src/engine/shapes/types.ts`: Thêm `erdParticipation?: 'partial' | 'total'` vào `ConnectorShapeObject`.
  - `src/engine/shapes/registry.ts`: Đăng ký `erd.partial-key-attribute` và `erd.total-participation`.
  - `src/engine/shapes/geometry.ts`: Thuật toán vẽ `doubleBorder` song song cách đều cho diamond, ellipse và rect.
  - `src/engine/CanvasEngine.ts`: Hàm vẽ connector nhận diện `erdParticipation === 'total'`, vẽ 2 đường song song offset $\pm 1.75\text{px}$.

### Module 2: Bảng CSDL 3 Tầng, IDEF1X Divider & Neo Dòng Cột
- **Tệp thay đổi:**
  - `src/engine/shapes/registry.ts`: Bổ sung định nghĩa `erd.view` kế thừa data table capabilities.
  - `src/engine/CanvasEngine.ts`: Nâng cấp hàm `renderErTable()` vẽ header hiện đại, PK compartment divider, badges bo tròn, và căn phải monospaced data types.
  - `src/engine/shapes/semantics.ts`: Cập nhật `structured-table-rows` cung cấp connection points chính xác tại mép trái/phải từng dòng.

### Module 3: Trình Soạn Thảo In-Place & Điều Hướng Bàn Phím Bảng Tính
- **Tệp thay đổi:**
  - `src/engine/CanvasEngine.ts`: Nâng cấp `getErTableHit()` và hàm phân tích cú pháp `updateErTableColumn()` hỗ trợ bóc tách đầy đủ `name`, `type`, `key`, `nullable`, `default`.
  - `src/App.tsx`:
    - Bổ sung hàm `commitAndAdvanceErTableColumn()` khi bấm phím `Enter`.
    - Hỗ trợ phím `Tab` và `Shift+Tab` di chuyển con trỏ giữa các dòng cột.
    - Cung cấp combobox gợi ý kiểu dữ liệu SQL phổ biến khi sửa cột.

### Module 4: Smart Presets Inspector, SQL DDL Export & Kiểm Thử Tự Động
- **Tệp thay đổi:**
  - `src/App.tsx`: Bổ sung hàm `applyTablePreset()` thực thi các quy tắc an toàn cho `+ ID (PK)`, `+ Timestamps`, `+ Soft Delete`.
  - Tạo mới `src/engine/shapes/__tests__/erd.test.mjs`: Test suite kiểm tra chuỗi 6 bước vòng đời metadata (Create $\rightarrow$ In-place Edit $\rightarrow$ Tab/Enter $\rightarrow$ Inspector $\rightarrow$ JSON Serialize/Deserialize $\rightarrow$ Undo/Redo $\rightarrow$ Copy/Paste).
  - Nâng cấp `scripts/verify-erd-inline-editing.mjs`: Kiểm tra Playwright tự động chạy qua 4 mức zoom ($50\%, 80\%, 100\%, 150\%$) trên tất cả các hình khối Chen và bảng CSDL.

---

## 8. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria & Quality Checklist)

Một bản nâng cấp chỉ được coi là thành công khi vượt qua toàn bộ các tiêu chí kiểm thử sau:

1. **Tiêu chuẩn Hình Học & Vector Rendering:**
   - [ ] Hình thoi quan hệ nhận diện (`erd.identifying-relationship`) có 2 đường viền song song đồng tâm hoàn hảo, không bị méo góc.
   - [ ] Thuộc tính khóa chính có gạch chân nét liền; thuộc tính khóa bộ phận có gạch chân nét đứt chuẩn xác dưới chân chữ.
   - [ ] Tham gia toàn phần (`erd.total-participation`) hiển thị hai đường song song cách nhau $3.5\text{px}$, tiếp xúc vuông góc với thực thể và hình thoi.
   - [ ] Bảng CSDL có vạch kẻ IDEF1X phân cách rõ ràng giữa nhóm cột Khóa chính và nhóm cột thường.
2. **Tiêu chuẩn Text Editing & Keyboard Interaction:**
   - [ ] Tuyệt đối **không có hiện tượng chữ nhảy (Zero Jitter)** khi double-click mở editor trên bất kỳ hình khối nào.
   - [ ] Double-click vào Header bảng chỉ mở editor sửa tên bảng; double-click vào dòng cột mở editor sửa đúng dòng cột đó.
   - [ ] Nhấn `Enter` khi đang sửa cột tự động lưu và thêm ngay dòng mới bên dưới; nhấn `Tab` chuyển đổi mượt mà.
   - [ ] Textarea trên canvas không có viền chữ nhật thừa, nền trong suốt đối với hình thoi/elip và không che khuất viền hình.
   - [ ] Font size ở mọi mức zoom ($50\%, 80\%, 100\%, 150\%$) luôn khớp tuyệt đối với canvas, loại bỏ 100% lỗi Double-Zoom.
3. **Tiêu chuẩn An Toàn Dữ Liệu & Presets:**
   - [ ] Nút `+ ID (PK)` không ghi đè hoặc làm hỏng các bảng đã có Khóa chính đơn hoặc Khóa chính phức hợp.
   - [ ] Nút `+ Timestamps` và `+ Soft Delete` hoạt động idempotent (bấm nhiều lần không sinh cột trùng lặp).
   - [ ] Dữ liệu cột bảng và thuộc tính connector được bảo toàn 100% qua chuỗi Lưu trữ $\rightarrow$ Tải lại (Save/Load) và Sao chép $\rightarrow$ Dán (Copy/Paste).
4. **Tiêu chuẩn Kiểm Thử Tự Động:**
   - [ ] `npx tsc -b` vượt qua với 0 lỗi kiểu dữ liệu.
   - [ ] Toàn bộ test suite `npm run test:usecase`, `npm run test:class`, `npm run test:sequence` và `npm run test:erd` đạt kết quả **100% Passed**.
   - [ ] Kịch bản Playwright xác minh tự động trên trình duyệt thật ở 4 mức zoom đều đạt assertion mong đợi.
