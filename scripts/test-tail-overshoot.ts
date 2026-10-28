import { recognizeSmartDrawing } from '../src/engine/smartDrawing/recognizer';

// Create a sharp rectangle with 25% overshoot tail
function makeRectWithOvershoot(): number[][] {
  const corners = [[50, 50], [160, 50], [160, 110], [50, 110], [50, 50]];
  const pts: number[][] = [];
  // 4 edges = 40 points
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  // Now add 25% overshoot tail past [50, 50] continuing along top edge to [90, 50]
  for (let s = 1; s <= 10; s++) {
    const t = s / 10;
    pts.push([50 + (90 - 50) * t, 50]);
  }
  return pts;
}

// Create a circle with 25% overshoot tail
function makeCircleWithOvershoot(): number[][] {
  const pts: number[][] = [];
  // 1 full turn (0 to 2*pi) = 40 points
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([100 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)]);
  }
  // Overshoot 25% (0.25 * 2*pi = 0.5*pi) = 10 extra points
  for (let i = 1; i <= 10; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([100 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)]);
  }
  return pts;
}

const rectRes = recognizeSmartDrawing(makeRectWithOvershoot());
console.log('Rect with 25% overshoot:', rectRes.kind, rectRes.confidence.toFixed(3));

const circleRes = recognizeSmartDrawing(makeCircleWithOvershoot());
console.log('Circle with 25% overshoot:', circleRes.kind, circleRes.confidence.toFixed(3));

const allPass = rectRes.kind === 'rectangle' && circleRes.kind === 'ellipse';
console.log('Tail overshoot test:', allPass ? 'PASSED' : 'FAILED');
process.exit(allPass ? 0 : 1);

