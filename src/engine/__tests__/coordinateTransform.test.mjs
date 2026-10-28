import assert from 'node:assert';
import * as Y from 'yjs';

// Setup minimal DOM mocks required for CanvasEngine in Node environment
if (typeof global.document === 'undefined') {
  global.document = {
    compatMode: 'CSS1Compat',
    documentElement: { style: {} },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        appendChild: () => {},
        remove: () => {},
      };
    },
  };
}
if (typeof global.requestAnimationFrame === 'undefined') {
  global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
}

// Import CanvasEngine
const { CanvasEngine } = await import('../CanvasEngine.ts');

function createMockCanvas(width, height, clientRect) {
  return {
    width,
    height,
    clientWidth: clientRect.width,
    clientHeight: clientRect.height,
    parentElement: {
      appendChild: () => {},
    },
    getBoundingClientRect() {
      return { ...clientRect };
    },
    getContext() {
      return new Proxy({}, {
        get: (_target, prop) => {
          if (prop === 'canvas') return null;
          return () => {};
        },
      });
    },
  };
}

function computeIndependentExpectedOverlay(wx, wy, cam, cvWidth, cvHeight, cvRect, overlayRect) {
  const scaleX = cvWidth > 0 ? cvRect.width / cvWidth : 1;
  const scaleY = cvHeight > 0 ? cvRect.height / cvHeight : 1;
  const centerOverlayX = (cvRect.left - overlayRect.left) + cvRect.width / 2;
  const centerOverlayY = (cvRect.top - overlayRect.top) + cvRect.height / 2;
  const deltaDisplayX = (wx - cam.x) * cam.zoom * scaleX;
  const deltaDisplayY = (wy - cam.y) * cam.zoom * scaleY;

  return {
    x: centerOverlayX + deltaDisplayX,
    y: centerOverlayY + deltaDisplayY,
  };
}

console.log('--- Testing Coordinate Transformations & worldToOverlay() ---');

const yDoc = new Y.Doc();
const yShapes = yDoc.getMap('shapes');

// ─────────────────────────────────────────────────────────────────────────────
// CASE 1: Standard Coincident Canvas & Overlay (1:1 Integer Layout)
// ─────────────────────────────────────────────────────────────────────────────
{
  const cvRect = { left: 56, top: 48, width: 1200, height: 800, right: 1256, bottom: 848 };
  const overlayRect = { left: 56, top: 48, width: 1200, height: 800, right: 1256, bottom: 848 };
  const mockCv = createMockCanvas(1200, 800, cvRect);
  const overlayEl = { getBoundingClientRect: () => overlayRect };

  const eng = new CanvasEngine(mockCv, yShapes);
  eng.setCamera(0, 0, 1.0);

  const testPoints = [
    { wx: 0, wy: 0 },
    { wx: 150, wy: -200 },
    { wx: -400, wy: 300 },
  ];

  for (const pt of testPoints) {
    const actual = eng.worldToOverlay(pt.wx, pt.wy, overlayEl);
    const expected = computeIndependentExpectedOverlay(pt.wx, pt.wy, eng.cam, 1200, 800, cvRect, overlayRect);

    assert.ok(Math.abs(actual.x - expected.x) < 1e-4, `Case 1 X mismatch for (${pt.wx}, ${pt.wy}): actual=${actual.x}, expected=${expected.x}`);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-4, `Case 1 Y mismatch for (${pt.wx}, ${pt.wy}): actual=${actual.y}, expected=${expected.y}`);
  }
  eng.destroy();
  console.log('✓ Case 1: Standard 1:1 coincident layout passed');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 2: Fractional Subpixel Display Dimensions
// (Backing buffer integer 1200x750, but CSS layout rect has subpixels 1224.6 x 752.4)
// ─────────────────────────────────────────────────────────────────────────────
{
  const cvRect = { left: 56.4, top: 48.2, width: 1224.6, height: 752.4, right: 1281.0, bottom: 800.6 };
  const overlayRect = { left: 56.4, top: 48.2, width: 1224.6, height: 752.4, right: 1281.0, bottom: 800.6 };
  const mockCv = createMockCanvas(1200, 750, cvRect);
  const overlayEl = { getBoundingClientRect: () => overlayRect };

  const eng = new CanvasEngine(mockCv, yShapes);
  eng.setCamera(100, -50, 1.5);

  const testPoints = [
    { wx: 100, wy: -50 }, // exactly on camera center -> should map to canvas physical center
    { wx: 250, wy: 100 },
    { wx: -150, wy: -300 },
  ];

  for (const pt of testPoints) {
    const actual = eng.worldToOverlay(pt.wx, pt.wy, overlayEl);
    const expected = computeIndependentExpectedOverlay(pt.wx, pt.wy, eng.cam, 1200, 750, cvRect, overlayRect);

    assert.ok(Math.abs(actual.x - expected.x) < 1e-3, `Case 2 X fractional mismatch for (${pt.wx}, ${pt.wy}): actual=${actual.x}, expected=${expected.x}`);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-3, `Case 2 Y fractional mismatch for (${pt.wx}, ${pt.wy}): actual=${actual.y}, expected=${expected.y}`);
  }
  eng.destroy();
  console.log('✓ Case 2: Fractional subpixel display scaling passed');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 3: Overlay Origin Offset from Canvas Display Rect
// (e.g. padding/border difference where overlay starts at 40, 32 while canvas is at 56, 48)
// ─────────────────────────────────────────────────────────────────────────────
{
  const cvRect = { left: 56, top: 48, width: 1200, height: 800, right: 1256, bottom: 848 };
  const overlayRect = { left: 40, top: 32, width: 1240, height: 820, right: 1280, bottom: 852 };
  const mockCv = createMockCanvas(1200, 800, cvRect);
  const overlayEl = { getBoundingClientRect: () => overlayRect };

  const eng = new CanvasEngine(mockCv, yShapes);
  eng.setCamera(0, 0, 1.0);

  // Center of board (0, 0) should be at center of canvas + (56 - 40) = 600 + 16 = 616 in overlay space
  const actualCenter = eng.worldToOverlay(0, 0, overlayEl);
  const expectedCenter = computeIndependentExpectedOverlay(0, 0, eng.cam, 1200, 800, cvRect, overlayRect);

  assert.strictEqual(expectedCenter.x, 616);
  assert.strictEqual(expectedCenter.y, 416);
  assert.ok(Math.abs(actualCenter.x - expectedCenter.x) < 1e-4, `Case 3 offset X mismatch: actual=${actualCenter.x}, expected=616`);
  assert.ok(Math.abs(actualCenter.y - expectedCenter.y) < 1e-4, `Case 3 offset Y mismatch: actual=${actualCenter.y}, expected=416`);

  eng.destroy();
  console.log('✓ Case 3: Origin offset compensation passed');
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE 4: Zoom Variations (0.25x, 0.5x, 2.0x, 4.0x) with Pan
// ─────────────────────────────────────────────────────────────────────────────
{
  const cvRect = { left: 56, top: 48, width: 1200, height: 800, right: 1256, bottom: 848 };
  const overlayRect = { left: 56, top: 48, width: 1200, height: 800, right: 1256, bottom: 848 };
  const mockCv = createMockCanvas(1200, 800, cvRect);
  const overlayEl = { getBoundingClientRect: () => overlayRect };

  const eng = new CanvasEngine(mockCv, yShapes);

  const zoomLevels = [0.25, 0.5, 1.0, 2.0, 4.0];
  for (const zoom of zoomLevels) {
    eng.setCamera(-120, 85, zoom);
    const pt = { wx: 340, wy: -210 };

    const actual = eng.worldToOverlay(pt.wx, pt.wy, overlayEl);
    const expected = computeIndependentExpectedOverlay(pt.wx, pt.wy, eng.cam, 1200, 800, cvRect, overlayRect);

    assert.ok(Math.abs(actual.x - expected.x) < 1e-4, `Case 4 Zoom ${zoom} X mismatch`);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-4, `Case 4 Zoom ${zoom} Y mismatch`);
  }

  eng.destroy();
  console.log('✓ Case 4: Zoom variations from 0.25x to 4.0x verified');
}

console.log('🎉 ALL worldToOverlay() INDEPENDENT COORDINATE TRANSFORM TESTS PASSED!');
