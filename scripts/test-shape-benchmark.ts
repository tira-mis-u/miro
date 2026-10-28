import { recognizeSmartDrawing } from '../src/engine/smartDrawing/recognizer';

type Point2 = [number, number];

// 1. Oval dẹp (rx = 85, ry = 40, ratio = 2.125)
function makeOval(): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([100 + 85 * Math.cos(a), 100 + 40 * Math.sin(a)]);
  }
  return pts;
}

// 2. Đường tròn xấp xỉ 1:1 (radius = 50 + slight hand wobble)
function makeCircle(): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 50 + Math.sin(i * 2) * 3;
    pts.push([100 + r * Math.cos(a), 100 + r * Math.sin(a)]);
  }
  return pts;
}

// 3. Chữ nhật sắc nét
function makeSharpRect(): number[][] {
  const corners = [[50, 50], [160, 50], [160, 110], [50, 110], [52, 49]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 4. Chữ nhật bo góc (fillet 16px)
function makeRoundedRect(): number[][] {
  const rx = 16, ry = 16, rw = 120, rh = 80;
  const tl = [50, 50];
  const pts: number[][] = [];
  for (let deg = 180; deg <= 270; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([tl[0] + rx + rx * Math.cos(rad), tl[1] + ry + ry * Math.sin(rad)]);
  }
  pts.push([tl[0] + rw - rx, tl[1]]);
  for (let deg = 270; deg <= 360; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([tl[0] + rw - rx + rx * Math.cos(rad), tl[1] + ry + ry * Math.sin(rad)]);
  }
  pts.push([tl[0] + rw, tl[1] + rh - ry]);
  for (let deg = 0; deg <= 90; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([tl[0] + rw - rx + rx * Math.cos(rad), tl[1] + rh - ry + ry * Math.sin(rad)]);
  }
  pts.push([tl[0] + rx, tl[1] + rh]);
  for (let deg = 90; deg <= 180; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([tl[0] + rx + rx * Math.cos(rad), tl[1] + rh - ry + ry * Math.sin(rad)]);
  }
  return pts;
}

// 5. Hình vuông
function makeSquare(): number[][] {
  const corners = [[50, 50], [130, 50], [130, 130], [50, 130], [52, 49]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 6. Hình bình hành
function makeParallelogram(): number[][] {
  const corners = [[75, 50], [175, 50], [145, 110], [45, 110], [77, 51]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 7. Hình thang
function makeTrapezoid(): number[][] {
  const corners = [[75, 50], [135, 50], [165, 110], [45, 110], [76, 51]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 8. Hình thoi
function makeDiamond(): number[][] {
  const corners = [[100, 30], [150, 80], [100, 130], [50, 80], [102, 32]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 9. Tam giác chuẩn
function makeTriangle(): number[][] {
  const corners = [[100, 40], [160, 130], [40, 130], [102, 42]];
  const pts: number[][] = [];
  for (let i = 0; i < 3; i++) {
    for (let s = 0; s < 12; s++) {
      const t = s / 12;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 10. Chữ V nằm / Tam giác có 1 cạnh bị gãy gập (KHÔNG ĐƯỢC RA STAR!)
function makeBentTriangle(): number[][] {
  // Tam giác có 1 cạnh bị gấp khúc xuống (hình chữ V nằm khép hờ)
  const corners = [[40, 60], [160, 90], [120, 140], [40, 130], [42, 62]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 11. Trái tim vẽ xấu/méo (KHÔNG ĐƯỢC RA STAR!)
function makeMessyHeart(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 40; s++) {
    const t = (s / 40) * Math.PI * 2;
    // Hand asymmetry + wobble
    const wobble = Math.sin(s * 1.8) * 2;
    const x = 100 + (38 + wobble) * Math.pow(Math.sin(t), 3);
    const y = 90 - (35 * Math.cos(t) - 13 * Math.cos(2 * t) - 5 * Math.cos(3 * t) - 2 * Math.cos(4 * t));
    pts.push([x, y]);
  }
  return pts;
}

// 12. Ngôi sao 5 cánh (KHÔNG ĐƯỢC RA HEART!)
function makeStar(): number[][] {
  const order = [0, 2, 4, 1, 3, 0];
  const starVertices = order.map(idx => {
    const angle = (idx * (2 * Math.PI) / 5) - Math.PI / 2;
    return [100 + 45 * Math.cos(angle), 100 + 45 * Math.sin(angle)];
  });
  const pts: number[][] = [];
  for (let i = 0; i < starVertices.length - 1; i++) {
    const p1 = starVertices[i], p2 = starVertices[i + 1];
    for (let s = 0; s < 7; s++) {
      const t = s / 7;
      pts.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
    }
  }
  return pts;
}

// 13. Đường thẳng
function makeLine(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 20; s++) pts.push([30 + s * 7, 50 + s * 3]);
  return pts;
}

// 14. Mũi tên
function makeArrow(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 20; s++) pts.push([30 + s * 7, 80]);
  for (let s = 1; s <= 5; s++) pts.push([170 - s * 4, 80 - s * 3]);
  return pts;
}

// 15. Nét vẽ tự do / Scribble (phải là unchanged)
function makeScribble(): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < 40; i++) pts.push([50 + Math.sin(i * 1.5) * 40, 50 + Math.cos(i * 0.7) * 35]);
  return pts;
}

// 16. Chữ nhật nghiêng (xoay ~35 độ)
function makeTiltedRect(): number[][] {
  const angle = (35 * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = 120, cy = 120;
  const halfW = 60, halfH = 35;
  const rawCorners = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
    [-halfW, -halfH],
  ];
  const corners = rawCorners.map(([x, y]) => [
    cx + x * cos - y * sin,
    cy + x * sin + y * cos,
  ]);
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([
        corners[i][0] + (corners[i+1][0] - corners[i][0]) * t,
        corners[i][1] + (corners[i+1][1] - corners[i][1]) * t,
      ]);
    }
  }
  return pts;
}

// 17. Chữ V mở (không khép kín, 2 cạnh) -> unchanged
function makeOpenV(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 15; s++) {
    const t = s / 15;
    pts.push([30 + 50 * t, 40 + 100 * t]);
  }
  for (let s = 1; s <= 15; s++) {
    const t = s / 15;
    pts.push([80 + 50 * t, 140 - 100 * t]);
  }
  return pts;
}

// 18. Chữ A mở / Mái nhà -> unchanged
function makeOpenA(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 15; s++) {
    const t = s / 15;
    pts.push([30 + 50 * t, 140 - 100 * t]);
  }
  for (let s = 1; s <= 15; s++) {
    const t = s / 15;
    pts.push([80 + 50 * t, 40 + 100 * t]);
  }
  return pts;
}

// 19. Đường cong thoai thoải / Gentle arc -> unchanged (hoặc line nếu quá thẳng, cấm ellipse)
function makeGentleArc(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 25; s++) {
    const t = s / 25;
    const x = 30 + 140 * t;
    const y = 100 - Math.sin(t * Math.PI) * 22;
    pts.push([x, y]);
  }
  return pts;
}

// 20. Đường zigzag (nhiều góc nhọn đổi chiều liên tục) -> unchanged
function makeZigzag(): number[][] {
  const pts: number[][] = [];
  const waypoints = [[30, 120], [60, 40], [90, 120], [120, 40], [150, 120]];
  for (let i = 0; i < waypoints.length - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      pts.push([
        waypoints[i][0] + (waypoints[i+1][0] - waypoints[i][0]) * t,
        waypoints[i][1] + (waypoints[i+1][1] - waypoints[i][1]) * t,
      ]);
    }
  }
  return pts;
}

// 21. Đường thẳng có độ giật lùi nhỏ ở cuối (recoil 6px) -> line (CẤM arrow)
function makeLineWithRecoil(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 25; s++) pts.push([30 + s * 6, 80]);
  // Recoil lùi nhẹ 6px dọc theo đường thẳng
  pts.push([177, 80]);
  pts.push([174, 80]);
  return pts;
}

// 22. Đường thẳng có móc nhỏ ở cuối (hook 3px vuông góc) -> line (CẤM arrow)
function makeLineWithTinyHook(): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 25; s++) pts.push([30 + s * 6, 80]);
  pts.push([178, 82]);
  pts.push([177, 84]);
  return pts;
}

// 23. Nét siêu nhỏ (< 10px, rung tay / nhấp chuột vô tình) -> unchanged
function makeTinyStroke(): number[][] {
  return [[50, 50], [52, 53], [54, 51], [53, 50]];
}

// 24. Nét cực lớn (3000px, zoom out vẽ trên canvas) -> rectangle
function makeLargeStroke(): number[][] {
  const corners = [[1000, 1000], [4000, 1000], [4000, 2800], [1000, 2800], [1005, 995]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

// 25. Tọa độ âm (minX < -500, minY < -500) -> rectangle
function makeNegativeCoordsRect(): number[][] {
  const corners = [[-700, -500], [-550, -500], [-550, -400], [-700, -400], [-698, -502]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  return pts;
}

export const BENCHMARK_CASES = [
  { name: 'Oval (Elongated)', data: makeOval(), expected: 'ellipse', forbidden: ['rectangle', 'parallelogram', 'trapezoid'] },
  { name: 'Circle (1:1 Near Round)', data: makeCircle(), expected: 'ellipse', forbidden: ['rectangle', 'parallelogram', 'trapezoid'] },
  { name: 'Sharp Rectangle', data: makeSharpRect(), expected: 'rectangle', forbidden: ['ellipse'] },
  { name: 'Rounded Rectangle', data: makeRoundedRect(), expected: 'rectangle', forbidden: ['ellipse'] },
  { name: 'Square', data: makeSquare(), expected: 'rectangle', forbidden: ['ellipse'] },
  { name: 'Tilted Rectangle (Rotated ~35°)', data: makeTiltedRect(), expected: 'rectangle', forbidden: ['ellipse'] },
  { name: 'Parallelogram', data: makeParallelogram(), expected: 'parallelogram', forbidden: ['ellipse', 'rectangle'] },
  { name: 'Trapezoid', data: makeTrapezoid(), expected: 'trapezoid', forbidden: ['ellipse', 'rectangle'] },
  { name: 'Diamond', data: makeDiamond(), expected: 'diamond', forbidden: ['ellipse', 'rectangle'] },
  { name: 'Triangle', data: makeTriangle(), expected: 'triangle', forbidden: ['star', 'ellipse'] },
  { name: 'Bent Triangle (Chữ V / Cạnh gấp)', data: makeBentTriangle(), expected: ['triangle', 'unchanged'], forbidden: ['star'] },
  { name: 'Messy Heart', data: makeMessyHeart(), expected: 'heart', forbidden: ['star', 'ellipse'] },
  { name: 'Star (5-Point)', data: makeStar(), expected: 'star', forbidden: ['heart', 'triangle'] },
  { name: 'Line', data: makeLine(), expected: 'line', forbidden: ['arrow'] },
  { name: 'Arrow', data: makeArrow(), expected: 'arrow', forbidden: ['line'] },
  { name: 'Scribble (Freeform)', data: makeScribble(), expected: 'unchanged', forbidden: ['rectangle', 'ellipse', 'star', 'heart', 'triangle'] },
  { name: 'Open V Shape', data: makeOpenV(), expected: 'unchanged', forbidden: ['triangle', 'star', 'rectangle'] },
  { name: 'Open A Shape', data: makeOpenA(), expected: 'unchanged', forbidden: ['triangle', 'star', 'rectangle'] },
  { name: 'Gentle Arc (Open Curve)', data: makeGentleArc(), expected: ['unchanged', 'line'], forbidden: ['ellipse', 'rectangle'] },
  { name: 'Zigzag Stroke', data: makeZigzag(), expected: 'unchanged', forbidden: ['rectangle', 'triangle', 'ellipse'] },
  { name: 'Line with Recoil (Pen Release)', data: makeLineWithRecoil(), expected: 'line', forbidden: ['arrow'] },
  { name: 'Line with Tiny Hook (End Flick)', data: makeLineWithTinyHook(), expected: 'line', forbidden: ['arrow'] },
  { name: 'Tiny Stroke (< 10px Tremor)', data: makeTinyStroke(), expected: 'unchanged', forbidden: ['line', 'rectangle', 'ellipse'] },
  { name: 'Large Stroke (3000px Box)', data: makeLargeStroke(), expected: 'rectangle', forbidden: ['ellipse'] },
  { name: 'Negative Coordinates Box', data: makeNegativeCoordsRect(), expected: 'rectangle', forbidden: ['ellipse'] },
];

export function runBenchmark() {
  console.log(`=== RUNNING SMART DRAWING BENCHMARK (${BENCHMARK_CASES.length} SCENARIOS) ===\n`);
  let passCount = 0;
  for (const tc of BENCHMARK_CASES) {
    const res = recognizeSmartDrawing(tc.data);
    const expectedList = Array.isArray(tc.expected) ? tc.expected : [tc.expected];
    const isExpected = expectedList.includes(res.kind);
    const hasForbidden = tc.forbidden.includes(res.kind);
    const pass = isExpected && !hasForbidden;
    if (pass) passCount++;

    const status = pass ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} [${tc.name}]: recognized as '${res.kind}' (conf: ${res.confidence.toFixed(3)})`);
    if (!pass) {
      console.log(`    Expected: ${JSON.stringify(tc.expected)}, Forbidden: ${JSON.stringify(tc.forbidden)}`);
      const topDiags = res.diagnostics?.filter(d => d.accepted || d.confidence > 0.3);
      if (topDiags?.length) {
        console.log(`    Top candidates:`, topDiags.map(d => `${d.kind}(acc=${d.accepted}, conf=${d.confidence.toFixed(2)}, reasons=${d.reasons[0]})`).join(', '));
      }
    }
  }
  console.log(`\nScore: ${passCount} / ${BENCHMARK_CASES.length} passed.`);
  return passCount === BENCHMARK_CASES.length;
}

// Auto-run if executed as script
runBenchmark();


