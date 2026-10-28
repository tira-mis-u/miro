import { recognizeSmartDrawing } from '../src/engine/smartDrawing/recognizer';

type Point = [number, number];

// Simulate human drawing with natural hand tremor, variable spacing, and realistic imperfections

// 1. Natural rough circle drawn by human (not a perfect math formula, slight ovalness, gap at end)
function drawHumanCircle(): Point[] {
  const pts: Point[] = [];
  const cx = 200, cy = 200, rx = 60, ry = 55;
  for (let deg = 0; deg <= 350; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const wobble = (Math.random() - 0.5) * 6;
    pts.push([cx + (rx + wobble) * Math.cos(rad), cy + (ry + wobble) * Math.sin(rad)]);
  }
  return pts;
}

// 2. Natural rough rectangle (hand draws 4 sides, corners are slightly curved/overshot)
function drawHumanRect(): Point[] {
  const pts: Point[] = [];
  let x = 100, y = 100;
  // top
  for (let i = 0; i < 15; i++) { x += 8 + (Math.random() - 0.5) * 2; pts.push([x, y + (Math.random() - 0.5) * 3]); }
  // right
  for (let i = 0; i < 10; i++) { y += 7 + (Math.random() - 0.5) * 2; pts.push([x + (Math.random() - 0.5) * 3, y]); }
  // bottom
  for (let i = 0; i < 15; i++) { x -= 8 + (Math.random() - 0.5) * 2; pts.push([x, y + (Math.random() - 0.5) * 3]); }
  // left
  for (let i = 0; i < 10; i++) { y -= 7 + (Math.random() - 0.5) * 2; pts.push([x + (Math.random() - 0.5) * 3, y]); }
  return pts;
}

// 3. Natural rough triangle
function drawHumanTriangle(): Point[] {
  const pts: Point[] = [];
  // apex at (150, 80), bottom-right at (220, 190), bottom-left at (80, 190)
  // side 1: apex to bottom-right
  for (let s = 0; s <= 12; s++) {
    const t = s / 12;
    pts.push([150 + 70 * t + (Math.random() - 0.5) * 3, 80 + 110 * t + (Math.random() - 0.5) * 3]);
  }
  // side 2: bottom-right to bottom-left
  for (let s = 1; s <= 14; s++) {
    const t = s / 14;
    pts.push([220 - 140 * t + (Math.random() - 0.5) * 3, 190 + (Math.random() - 0.5) * 3]);
  }
  // side 3: bottom-left back to apex
  for (let s = 1; s <= 12; s++) {
    const t = s / 12;
    pts.push([80 + 70 * t + (Math.random() - 0.5) * 3, 190 - 110 * t + (Math.random() - 0.5) * 3]);
  }
  return pts;
}

// 4. Natural heart
function drawHumanHeart(): Point[] {
  const pts: Point[] = [];
  // start at bottom point (150, 200), go up left lobe, cleft at (150, 120), right lobe, back to bottom
  for (let s = 0; s <= 36; s++) {
    const t = (s / 36) * Math.PI * 2;
    const x = 150 + 45 * Math.pow(Math.sin(t), 3) + (Math.random() - 0.5) * 3;
    const y = 140 - (40 * Math.cos(t) - 16 * Math.cos(2*t) - 6 * Math.cos(3*t) - 3 * Math.cos(4*t)) + (Math.random() - 0.5) * 3;
    pts.push([x, y]);
  }
  return pts;
}

// 5. Natural star (5 points)
function drawHumanStar(): Point[] {
  const order = [0, 2, 4, 1, 3, 0];
  const starVertices = order.map(idx => {
    const angle = (idx * (2 * Math.PI) / 5) - Math.PI / 2;
    return [150 + 55 * Math.cos(angle), 150 + 55 * Math.sin(angle)];
  });
  const pts: Point[] = [];
  for (let i = 0; i < starVertices.length - 1; i++) {
    const p1 = starVertices[i], p2 = starVertices[i + 1];
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      pts.push([p1[0] + (p2[0] - p1[0]) * t + (Math.random() - 0.5) * 4, p1[1] + (p2[1] - p1[1]) * t + (Math.random() - 0.5) * 4]);
    }
  }
  return pts;
}

// 6. Natural diamond
function drawHumanDiamond(): Point[] {
  const corners = [[150, 70], [220, 140], [150, 210], [80, 140], [152, 72]];
  const pts: Point[] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t + (Math.random() - 0.5) * 3,
                corners[i][1] + (corners[i+1][1] - corners[i][1]) * t + (Math.random() - 0.5) * 3]);
    }
  }
  return pts;
}

// 7. Natural arrow
function drawHumanArrow(): Point[] {
  const pts: Point[] = [];
  for (let s = 0; s <= 20; s++) pts.push([50 + s * 8, 100 + (Math.random() - 0.5) * 2]);
  for (let s = 1; s <= 6; s++) pts.push([210 - s * 5, 100 - s * 4]);
  return pts;
}

const tests = [
  { name: 'Human Circle', fn: drawHumanCircle },
  { name: 'Human Rectangle', fn: drawHumanRect },
  { name: 'Human Triangle', fn: drawHumanTriangle },
  { name: 'Human Heart', fn: drawHumanHeart },
  { name: 'Human Star', fn: drawHumanStar },
  { name: 'Human Diamond', fn: drawHumanDiamond },
  { name: 'Human Arrow', fn: drawHumanArrow },
];

console.log('--- Testing 10 Trials of Real Human Sketches ---');
for (const t of tests) {
  let matched = 0;
  const results: Record<string, number> = {};
  for (let trial = 0; trial < 10; trial++) {
    const data = t.fn();
    const res = recognizeSmartDrawing(data);
    results[res.kind] = (results[res.kind] || 0) + 1;
  }
  console.log(`${t.name}:`, JSON.stringify(results));
}

