import { recognizeSmartDrawing } from '../src/engine/smartDrawing/recognizer';

function generateCircle(cx = 100, cy = 100, r = 50, count = 40): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= count * 1.05; i++) {
    const angle = (i / count) * Math.PI * 2;
    const jitter = (Math.sin(i * 3) * 0.8);
    const x = cx + (r + jitter) * Math.cos(angle);
    const y = cy + (r + jitter) * Math.sin(angle);
    pts.push([x, y]);
  }
  return pts;
}

function generateOval(cx = 100, cy = 100, rx = 70, ry = 40, count = 40): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= count * 1.04; i++) {
    const angle = (i / count) * Math.PI * 2;
    const jitter = (Math.cos(i * 2) * 0.6);
    const x = cx + (rx + jitter) * Math.cos(angle);
    const y = cy + (ry + jitter) * Math.sin(angle);
    pts.push([x, y]);
  }
  return pts;
}

function generateRectangle(x = 50, y = 50, w = 120, h = 80): number[][] {
  const pts: number[][] = [];
  const corners = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x + 4, y - 2],
  ];
  for (let i = 0; i < corners.length - 1; i++) {
    const c1 = corners[i], c2 = corners[i + 1];
    for (let step = 0; step < 10; step++) {
      const t = step / 10;
      pts.push([c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t]);
    }
  }
  return pts;
}

function generateSquare(x = 50, y = 50, s = 80): number[][] {
  return generateRectangle(x, y, s, s);
}

function generateTriangle(cx = 100, cy = 100, size = 80): number[][] {
  const pts: number[][] = [];
  const corners = [
    [cx, cy - size / 2],
    [cx + size / 2, cy + size / 2],
    [cx - size / 2, cy + size / 2],
    [cx + 3, cy - size / 2 + 3],
  ];
  for (let i = 0; i < corners.length - 1; i++) {
    const c1 = corners[i], c2 = corners[i + 1];
    for (let step = 0; step < 12; step++) {
      const t = step / 12;
      pts.push([c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t]);
    }
  }
  return pts;
}

function generateDiamond(cx = 100, cy = 100, w = 90, h = 90): number[][] {
  const pts: number[][] = [];
  const corners = [
    [cx, cy - h / 2],
    [cx + w / 2, cy],
    [cx, cy + h / 2],
    [cx - w / 2, cy],
    [cx + 2, cy - h / 2 + 2],
  ];
  for (let i = 0; i < corners.length - 1; i++) {
    const c1 = corners[i], c2 = corners[i + 1];
    for (let step = 0; step < 10; step++) {
      const t = step / 10;
      pts.push([c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t]);
    }
  }
  return pts;
}

function generateLine(x1 = 20, y1 = 20, x2 = 180, y2 = 90): number[][] {
  const pts: number[][] = [];
  for (let step = 0; step <= 25; step++) {
    const t = step / 25;
    pts.push([x1 + (x2 - x1) * t + Math.sin(step) * 0.4, y1 + (y2 - y1) * t]);
  }
  return pts;
}

function generateArrow(x1 = 20, y1 = 100, x2 = 180, y2 = 100): number[][] {
  const pts: number[][] = [];
  for (let step = 0; step <= 25; step++) {
    const t = step / 25;
    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  for (let step = 1; step <= 6; step++) {
    const t = step / 6;
    pts.push([x2 - 25 * t, y2 - 18 * t]);
  }
  return pts;
}

function generateStar(cx = 100, cy = 100, r = 60): number[][] {
  const pts: number[][] = [];
  const order = [0, 2, 4, 1, 3, 0];
  const starVertices = order.map(idx => {
    const angle = (idx * (2 * Math.PI) / 5) - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
  for (let i = 0; i < starVertices.length - 1; i++) {
    const p1 = starVertices[i], p2 = starVertices[i + 1];
    for (let step = 0; step < 8; step++) {
      const t = step / 8;
      pts.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
    }
  }
  return pts;
}

function generateScribble(): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < 40; i++) {
    pts.push([50 + Math.sin(i * 1.5) * 40, 50 + Math.cos(i * 0.7) * 35]);
  }
  return pts;
}

function generateRoundedRectangle(x = 50, y = 50, w = 120, h = 80, rx = 16, ry = 16): number[][] {
  const pts: number[][] = [];
  for (let deg = 180; deg <= 270; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([x + rx + rx * Math.cos(rad), y + ry + ry * Math.sin(rad)]);
  }
  pts.push([x + w - rx, y]);
  for (let deg = 270; deg <= 360; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([x + w - rx + rx * Math.cos(rad), y + ry + ry * Math.sin(rad)]);
  }
  pts.push([x + w, y + h - ry]);
  for (let deg = 0; deg <= 90; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([x + w - rx + rx * Math.cos(rad), y + h - ry + ry * Math.sin(rad)]);
  }
  pts.push([x + rx, y + h]);
  for (let deg = 90; deg <= 180; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    pts.push([x + rx + rx * Math.cos(rad), y + h - ry + ry * Math.sin(rad)]);
  }
  pts.push(pts[0]);
  return pts;
}

function generateHeart(cx = 100, cy = 90, scale = 40): number[][] {
  const pts: number[][] = [];
  for (let s = 0; s <= 40; s++) {
    const t = (s / 40) * Math.PI * 2;
    const x = cx + scale * Math.pow(Math.sin(t), 3);
    const y = cy - (scale * 0.8 * Math.cos(t) - scale * 0.3 * Math.cos(2 * t) - scale * 0.12 * Math.cos(3 * t) - scale * 0.05 * Math.cos(4 * t));
    pts.push([x, y]);
  }
  return pts;
}

const testCases = [
  { name: 'Circle', data: generateCircle(), expected: 'ellipse' },
  { name: 'Sharp Rectangle', data: generateRectangle(), expected: 'rectangle' },
  { name: 'Rounded Rectangle', data: generateRoundedRectangle(), expected: 'rectangle' },
  { name: 'Square', data: generateSquare(), expected: 'rectangle' },
  { name: 'Triangle', data: generateTriangle(), expected: 'triangle' },
  { name: 'Diamond', data: generateDiamond(), expected: 'diamond' },
  { name: 'Heart', data: generateHeart(), expected: 'heart' },
  { name: 'Line', data: generateLine(), expected: 'line' },
  { name: 'Arrow', data: generateArrow(), expected: 'arrow' },
  { name: 'Star', data: generateStar(), expected: 'star' },
  { name: 'Scribble (non-shape)', data: generateScribble(), expected: 'unchanged' },
];

let allPassed = true;
for (const { name, data, expected } of testCases) {
  const res = recognizeSmartDrawing(data);
  const pass = res.kind === expected;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: recognized as '${res.kind}' (expected '${expected}', conf: ${res.confidence.toFixed(3)})`);
  if (!pass) {
    allPassed = false;
    console.log('  Diagnostics:', JSON.stringify(res.diagnostics?.map(d => ({ kind: d.kind, accepted: d.accepted, conf: d.confidence, reasons: d.reasons }))));
  }
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log('\nAll test cases (including negative scribble test) passed!');
}

