import { recognizeSmartDrawing } from '../src/engine/smartDrawing/recognizer';
import { preprocessSmartStroke } from '../src/engine/smartDrawing/preprocess';
import { analyzeSmartStroke } from '../src/engine/smartDrawing/geometry';
import type { CandidateDiagnostic, SmartDrawingResult } from '../src/engine/smartDrawing/types';

// ============================================================================
// 1. ASPECT RATIO AUDIT (Circle vs Ellipse, Square vs Rectangle)
// ============================================================================
function makeEllipseWithRatio(rx: number, ry: number, wobble = 0): number[][] {
  const pts: number[][] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const noise = wobble ? Math.sin(i * 3) * wobble : 0;
    pts.push([100 + (rx + noise) * Math.cos(a), 100 + (ry + noise) * Math.sin(a)]);
  }
  return pts;
}

function makeRectWithRatio(w: number, h: number, wobble = 0): number[][] {
  const corners = [[50, 50], [50 + w, 50], [50 + w, 50 + h], [50, 50 + h], [50, 50]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      const noise = wobble ? Math.sin(s * 2) * wobble : 0;
      pts.push([
        corners[i][0] + (corners[i+1][0] - corners[i][0]) * t + noise,
        corners[i][1] + (corners[i+1][1] - corners[i][1]) * t + noise
      ]);
    }
  }
  return pts;
}

// ============================================================================
// 2. SELF-INTERSECTION & TOPOLOGY AUDIT
// ============================================================================
// Figure 8 (lemniscate)
function makeFigure8(): number[][] {
  const pts: number[][] = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const scale = 2 / (3 - Math.cos(2 * t));
    const x = 100 + 60 * scale * Math.cos(t);
    const y = 100 + 40 * scale * Math.sin(2 * t) / 2;
    pts.push([x, y]);
  }
  return pts;
}

// Bowtie quadrilateral (self-crossing quad: (50,50) -> (150,150) -> (150,50) -> (50,150) -> (50,50))
function makeBowtie(): number[][] {
  const corners = [[50, 50], [150, 150], [150, 50], [50, 150], [50, 50]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([
        corners[i][0] + (corners[i+1][0] - corners[i][0]) * t,
        corners[i][1] + (corners[i+1][1] - corners[i][1]) * t
      ]);
    }
  }
  return pts;
}

// Circle with 10% natural overlap (start & end cross by a few pixels)
function makeCircleWithSmallOverlap(): number[][] {
  const pts: number[][] = [];
  const N = 44; // 10% more than 40
  for (let i = 0; i <= N; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([100 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)]);
  }
  return pts;
}

// Circle with 25% tail overshoot
function makeCircleWithLargeOvershoot(): number[][] {
  const pts: number[][] = [];
  const N = 50; // 25% overshoot
  for (let i = 0; i <= N; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([100 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)]);
  }
  return pts;
}

// Rectangle with 25% overshoot
function makeRectWithLargeOvershoot(): number[][] {
  const corners = [[50, 50], [150, 50], [150, 120], [50, 120], [50, 50]];
  const pts: number[][] = [];
  for (let i = 0; i < 4; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      pts.push([corners[i][0] + (corners[i+1][0] - corners[i][0]) * t, corners[i][1] + (corners[i+1][1] - corners[i][1]) * t]);
    }
  }
  // overshoot along the top edge again
  for (let s = 0; s < 10; s++) {
    const t = s / 10;
    pts.push([corners[0][0] + (corners[1][0] - corners[0][0]) * t, corners[0][1]]);
  }
  return pts;
}

// ============================================================================
// 3. NEGATIVE / TRICKY PAIR CASES
// ============================================================================
// Irregular curvy loop (potato / bean shape that should NOT match heart or circle)
function makePotato(): number[][] {
  const pts: number[][] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 40 + Math.sin(a * 3) * 12 + Math.cos(a * 2) * 8;
    pts.push([100 + r * Math.cos(a), 100 + r * Math.sin(a)]);
  }
  return pts;
}

// Open spiral
function makeSpiral(): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 15) * Math.PI;
    const r = 5 + i * 1.2;
    pts.push([100 + r * Math.cos(a), 100 + r * Math.sin(a)]);
  }
  return pts;
}

// Straight line with small hook (should stay line, NOT arrow)
function makeLineWithHook(): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= 30; i++) {
    pts.push([50 + i * 5, 100]);
  }
  // 5px tiny recoil at the end
  pts.push([198, 98], [195, 96]);
  return pts;
}

// ============================================================================
// RUN AUDIT
// ============================================================================
export function runAudit() {
  console.log('=== RUNNING SMART DRAWING AUDIT SUITE ===\n');

  let passed = 0;
  let total = 0;

  function test(name: string, data: number[][], check: (res: SmartDrawingResult) => { pass: boolean; reason?: string }) {
    total++;
    const res = recognizeSmartDrawing(data);
    const { pass, reason } = check(res);
    const status = pass ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} [${name}]: kind='${res.kind}' conf=${res.confidence.toFixed(3)}${reason ? ' (' + reason + ')' : ''}`);
    if (pass) passed++;
    return pass;
  }

  console.log('--- 1. Snap & Aspect Ratio Audit ---');
  // 1.1 Circle near 1:1 (ratio 1.04) -> should be ellipse, AND snapped bounds should have aspect 1:1
  test('Circle 1:1 (ratio 1.04)', makeEllipseWithRatio(50, 48), res => {
    if (res.kind !== 'ellipse') return { pass: false, reason: 'Expected ellipse' };
    const b = res.bounds;
    const aspect = b ? Math.max(b.w, b.h) / Math.min(b.w, b.h) : 0;
    return { pass: aspect <= 1.02, reason: `bounds aspect=${aspect.toFixed(3)} (expected 1.00)` };
  });

  // 1.2 Ellipse ratio 1.10 -> borderline hand circle (should snap to circle 1:1)
  test('Circle with hand wobble (ratio 1.10)', makeEllipseWithRatio(55, 50), res => {
    if (res.kind !== 'ellipse') return { pass: false, reason: 'Expected ellipse' };
    const b = res.bounds;
    const aspect = b ? Math.max(b.w, b.h) / Math.min(b.w, b.h) : 0;
    return { pass: aspect <= 1.02, reason: `bounds aspect=${aspect.toFixed(3)}` };
  });

  // 1.3 Ellipse ratio 1.20 -> clearly intended Oval! Must NOT be snapped to 1:1 circle
  test('Intentional Oval (ratio 1.20)', makeEllipseWithRatio(60, 50), res => {
    if (res.kind !== 'ellipse') return { pass: false, reason: 'Expected ellipse' };
    const b = res.bounds;
    const aspect = b ? Math.max(b.w, b.h) / Math.min(b.w, b.h) : 0;
    const preserved = aspect >= 1.15;
    return { pass: preserved, reason: `bounds aspect=${aspect.toFixed(3)} (must NOT snap to 1:1 circle)` };
  });

  // 1.4 Ellipse ratio 1.30 -> clearly intended Oval!
  test('Intentional Oval (ratio 1.30)', makeEllipseWithRatio(65, 50), res => {
    if (res.kind !== 'ellipse') return { pass: false, reason: 'Expected ellipse' };
    const b = res.bounds;
    const aspect = b ? Math.max(b.w, b.h) / Math.min(b.w, b.h) : 0;
    return { pass: aspect >= 1.25, reason: `bounds aspect=${aspect.toFixed(3)}` };
  });

  // 1.5 Square 1:1 (ratio 1.03) -> should snap to 1:1 square
  test('Square 1:1 (ratio 1.03)', makeRectWithRatio(100, 97), res => {
    if (res.kind !== 'rectangle') return { pass: false, reason: 'Expected rectangle' };
    const b = res.bounds;
    const aspect = b ? Math.max(b.w, b.h) / Math.min(b.w, b.h) : 0;
    return { pass: aspect <= 1.02, reason: `bounds aspect=${aspect.toFixed(3)} (expected 1.00)` };
  });

  // 1.7 Browser Parallelogram test
  const pgramCorners = [[360, 370], [450, 370], [430, 430], [340, 430], [362, 368]];
  const pgramPts: number[][] = [];
  for (let i = 0; i < pgramCorners.length - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      pgramPts.push([
        pgramCorners[i][0] + (pgramCorners[i+1][0] - pgramCorners[i][0]) * t,
        pgramCorners[i][1] + (pgramCorners[i+1][1] - pgramCorners[i][1]) * t,
      ]);
    }
  }
  test('Browser Parallelogram', pgramPts, res => {
    if (res.kind !== 'parallelogram') {
      const prep = preprocessSmartStroke(pgramPts)!;
      const feat = analyzeSmartStroke(prep);
      console.log('Browser Parallelogram circularity:', feat.circularity);
      console.log('Browser Parallelogram diag:', JSON.stringify(res.diagnostics?.find((d: CandidateDiagnostic) => d.kind === 'parallelogram')));
    }
    return { pass: res.kind === 'parallelogram', reason: `Got '${res.kind}'` };
  });

  console.log('\n--- 2. Self-Intersection & Topology Audit ---');
  // 2.1 Figure-8 (lemniscate) -> MUST be unchanged! (MUST NOT become ellipse or diamond)
  test('Figure-8 (self-crossing loop)', makeFigure8(), res => {
    return { pass: res.kind === 'unchanged', reason: `Got '${res.kind}' (forbidden to be closed shape)` };
  });

  // 2.2 Bowtie quadrilateral (self-crossing quad) -> MUST be unchanged! (MUST NOT become rect/diamond)
  test('Bowtie (self-crossing quad)', makeBowtie(), res => {
    return { pass: res.kind === 'unchanged', reason: `Got '${res.kind}' (forbidden to be rect/diamond)` };
  });

  // 2.3 Circle with natural start/end crossing (small overlap) -> should be recognized as ellipse
  test('Circle with natural small overlap', makeCircleWithSmallOverlap(), res => {
    return { pass: res.kind === 'ellipse', reason: `Got '${res.kind}'` };
  });

  // 2.4 Circle with 25% tail overshoot -> should be recognized as ellipse
  test('Circle with 25% tail overshoot', makeCircleWithLargeOvershoot(), res => {
    return { pass: res.kind === 'ellipse', reason: `Got '${res.kind}'` };
  });

  // 2.5 Rectangle with 25% tail overshoot -> should be recognized as rectangle
  test('Rectangle with 25% tail overshoot', makeRectWithLargeOvershoot(), res => {
    return { pass: res.kind === 'rectangle', reason: `Got '${res.kind}'` };
  });

  console.log('\n--- 3. Negative / Safe Fallback Audit ---');
  // 3.1 Potato / bumpy asymmetric blob -> unchanged (safe fallback, don't guess circle/heart)
  test('Irregular Potato / Asymmetric Blob', makePotato(), res => {
    return { pass: res.kind === 'unchanged', reason: `Got '${res.kind}' (should not force into shape)` };
  });

  // 3.2 Open Spiral -> unchanged (must not become circle or line)
  test('Open Spiral', makeSpiral(), res => {
    return { pass: res.kind === 'unchanged', reason: `Got '${res.kind}'` };
  });

  // 3.3 Straight line with tiny end hook -> line (must NOT become arrow)
  test('Line with tiny end recoil', makeLineWithHook(), res => {
    if (res.kind !== 'line') {
      console.log('Line recoil diagnostics:', JSON.stringify(res.diagnostics?.map((d: CandidateDiagnostic) => ({ kind: d.kind, acc: d.accepted, conf: d.confidence, reasons: d.reasons }))));
    }
    return { pass: res.kind === 'line', reason: `Got '${res.kind}' (must not be arrow)` };
  });

  console.log(`\nAudit Score: ${passed} / ${total} passed.`);
  if (passed < total) process.exit(1);
}

runAudit();
