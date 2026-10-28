import { recognizeSmartDrawing } from '../src/engine/smartDrawing/recognizer';

// 1. Distorted circle: oval-ish, 12% wobble, 20% gap
const distortedCircle: number[][] = [];
for (let i = 0; i <= 32; i++) {
  const a = (i / 35) * Math.PI * 2;
  const r = 50 + Math.sin(i * 2) * 6; // 12% wobble
  distortedCircle.push([100 + r * Math.cos(a), 100 + (r * 0.85) * Math.sin(a)]);
}

// 2. Distorted rectangle: slanted sides, 15% wobble, corners not perfectly 90 degrees
const distortedRect: number[][] = [];
const corners = [[50, 50], [150, 58], [145, 125], [45, 118], [55, 48]];
for (let i = 0; i < corners.length - 1; i++) {
  const c1 = corners[i], c2 = corners[i + 1];
  for (let s = 0; s < 10; s++) {
    const t = s / 10;
    const wobble = Math.sin(s * 2) * 3;
    distortedRect.push([c1[0] + (c2[0] - c1[0]) * t + wobble, c1[1] + (c2[1] - c1[1]) * t]);
  }
}

// 3. Distorted triangle: curved sides, uneven angles
const distortedTri: number[][] = [];
const triCorners = [[100, 30], [160, 135], [40, 125], [105, 33]];
for (let i = 0; i < triCorners.length - 1; i++) {
  const c1 = triCorners[i], c2 = triCorners[i + 1];
  for (let s = 0; s < 10; s++) {
    const t = s / 10;
    const wobble = Math.sin(s * 1.5) * 4;
    distortedTri.push([c1[0] + (c2[0] - c1[0]) * t + wobble, c1[1] + (c2[1] - c1[1]) * t + wobble]);
  }
}

// 4. Distorted line: slight bow/arch (e.g. 8% curvature)
const distortedLine: number[][] = [];
for (let s = 0; s <= 20; s++) {
  const t = s / 20;
  const arch = Math.sin(Math.PI * t) * 12; // 12px bow on a 150px line
  distortedLine.push([50 + 150 * t, 100 + arch]);
}

// 5. Distorted diamond: hand-drawn rhombus with uneven side lengths and slight wobble
const distortedDiam: number[][] = [];
const diamCorners = [[100, 20], [155, 75], [98, 130], [42, 70], [102, 22]];
for (let i = 0; i < diamCorners.length - 1; i++) {
  const c1 = diamCorners[i], c2 = diamCorners[i + 1];
  for (let s = 0; s < 10; s++) {
    const t = s / 10;
    const wobble = Math.sin(s * 2) * 3;
    distortedDiam.push([c1[0] + (c2[0] - c1[0]) * t + wobble, c1[1] + (c2[1] - c1[1]) * t]);
  }
}

// 6. Distorted arrow: slightly curved shaft and quick arrowhead fold
const distortedArrow: number[][] = [];
for (let s = 0; s <= 20; s++) {
  const t = s / 20;
  distortedArrow.push([50 + 130 * t, 100 + Math.sin(t * Math.PI) * 4]);
}
for (let s = 1; s <= 6; s++) {
  const t = s / 6;
  distortedArrow.push([180 - 22 * t, 100 - 16 * t]);
}

// 7. Hand-drawn 5-point star
const starOrder = [0, 2, 4, 1, 3, 0];
const starVertices = starOrder.map(idx => {
  const angle = (idx * (2 * Math.PI) / 5) - Math.PI / 2;
  return [100 + 45 * Math.cos(angle), 100 + 45 * Math.sin(angle)];
});
const distortedStar: number[][] = [];
for (let i = 0; i < starVertices.length - 1; i++) {
  const p1 = starVertices[i], p2 = starVertices[i + 1];
  for (let s = 0; s < 6; s++) {
    const t = s / 6;
    distortedStar.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
  }
}

// 8. Distorted Rounded Rectangle: corners arc inwards (fillet)
const distortedRoundedRect: number[][] = [];
const rx = 18, ry = 18;
const rw = 120, rh = 80;
const rTopLeft = [60, 60];
// Draw 4 rounded corners and connecting segments
for (let deg = 180; deg <= 270; deg += 15) {
  const rad = (deg * Math.PI) / 180;
  distortedRoundedRect.push([rTopLeft[0] + rx + rx * Math.cos(rad), rTopLeft[1] + ry + ry * Math.sin(rad)]);
}
distortedRoundedRect.push([rTopLeft[0] + rw - rx, rTopLeft[1]]);
for (let deg = 270; deg <= 360; deg += 15) {
  const rad = (deg * Math.PI) / 180;
  distortedRoundedRect.push([rTopLeft[0] + rw - rx + rx * Math.cos(rad), rTopLeft[1] + ry + ry * Math.sin(rad)]);
}
distortedRoundedRect.push([rTopLeft[0] + rw, rTopLeft[1] + rh - ry]);
for (let deg = 0; deg <= 90; deg += 15) {
  const rad = (deg * Math.PI) / 180;
  distortedRoundedRect.push([rTopLeft[0] + rw - rx + rx * Math.cos(rad), rTopLeft[1] + rh - ry + ry * Math.sin(rad)]);
}
distortedRoundedRect.push([rTopLeft[0] + rx, rTopLeft[1] + rh]);
for (let deg = 90; deg <= 180; deg += 15) {
  const rad = (deg * Math.PI) / 180;
  distortedRoundedRect.push([rTopLeft[0] + rx + rx * Math.cos(rad), rTopLeft[1] + rh - ry + ry * Math.sin(rad)]);
}
distortedRoundedRect.push(distortedRoundedRect[0]);

// 9. Hand-drawn Heart: top cleft, left/right lobes, bottom pointed apex
const distortedHeart: number[][] = [];
for (let s = 0; s <= 40; s++) {
  const t = (s / 40) * Math.PI * 2;
  // Parametric heart formula
  const x = 100 + 40 * Math.pow(Math.sin(t), 3);
  const y = 90 - (32 * Math.cos(t) - 12 * Math.cos(2 * t) - 5 * Math.cos(3 * t) - 2 * Math.cos(4 * t));
  const wobble = Math.sin(s * 1.8) * 1.5;
  distortedHeart.push([x + wobble, y]);
}

// 10. Scribble (freehand squiggle that should NEVER be recognized as a shape)
const scribble: number[][] = [];
for (let i = 0; i < 40; i++) {
  scribble.push([50 + Math.sin(i * 1.5) * 40, 50 + Math.cos(i * 0.7) * 35]);
}

const tests = [
  { name: 'Distorted Circle', data: distortedCircle, expected: 'ellipse' },
  { name: 'Distorted Sharp Rect', data: distortedRect, expected: 'rectangle' },
  { name: 'Distorted Rounded Rect', data: distortedRoundedRect, expected: 'rectangle' },
  { name: 'Distorted Triangle', data: distortedTri, expected: 'triangle' },
  { name: 'Distorted Heart', data: distortedHeart, expected: 'heart' },
  { name: 'Distorted Line', data: distortedLine, expected: 'line' },
  { name: 'Distorted Diamond', data: distortedDiam, expected: 'diamond' },
  { name: 'Distorted Arrow', data: distortedArrow, expected: 'arrow' },
  { name: 'Distorted Star', data: distortedStar, expected: 'star' },
  { name: 'Scribble (non-shape)', data: scribble, expected: 'unchanged' },
];

let allPassed = true;
for (const t of tests) {
  const res = recognizeSmartDrawing(t.data);
  const pass = res.kind === t.expected;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${t.name} -> ${res.kind} (conf: ${res.confidence.toFixed(3)})`);
  if (!pass) {
    allPassed = false;
    const diags = res.diagnostics?.map(d => ({ kind: d.kind, acc: d.accepted, conf: d.confidence.toFixed(3), reasons: d.reasons }));
    console.log('  Diagnostics:', JSON.stringify(diags));
  }
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log('\nAll distorted shapes and negative scribble test passed 100%!');
}

