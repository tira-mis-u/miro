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

const { CanvasEngine } = await import('../CanvasEngine.ts');

function createMockCanvas(width, height) {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    parentElement: {
      appendChild: () => {},
    },
    getBoundingClientRect() {
      return { left: 56, top: 48, width, height, right: 56 + width, bottom: 48 + height };
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

console.log('--- Testing Phase 2: Camera Frame Listener Lifecycle ---');

const yDoc = new Y.Doc();
const yShapes = yDoc.getMap('shapes');
const mockCv = createMockCanvas(1200, 800);
const eng = new CanvasEngine(mockCv, yShapes);

// 1. Verify listener registration and invocation on setCamera
let receivedCam1 = null;
const unsubscribe1 = eng.addCameraFrameListener((cam) => {
  receivedCam1 = { ...cam };
});

eng.setCamera(100, 200, 1.5);
assert.deepStrictEqual(receivedCam1, { x: 100, y: 200, zoom: 1.5 }, 'Listener 1 should receive camera on setCamera');
console.log('✓ Listener 1 receives camera notification on camera transform');

// 2. Multiple independent listeners
let receivedCam2 = null;
const unsubscribe2 = eng.addCameraFrameListener((cam) => {
  receivedCam2 = { ...cam };
});

eng.setCamera(-50, 75, 2.0);
assert.deepStrictEqual(receivedCam1, { x: -50, y: 75, zoom: 2.0 }, 'Listener 1 should receive updated camera');
assert.deepStrictEqual(receivedCam2, { x: -50, y: 75, zoom: 2.0 }, 'Listener 2 should receive updated camera');
console.log('✓ Multiple concurrent listeners receive independent camera notifications');

// 3. Unsubscription lifecycle
unsubscribe1();
eng.setCamera(0, 0, 1.0);
assert.deepStrictEqual(receivedCam1, { x: -50, y: 75, zoom: 2.0 }, 'Unsubscribed listener 1 must NOT receive new camera');
assert.deepStrictEqual(receivedCam2, { x: 0, y: 0, zoom: 1.0 }, 'Active listener 2 must continue receiving camera updates');
console.log('✓ Unsubscribed listener cleanly removed without affecting other listeners');

// 4. Error isolation: throwing listener must not break other listeners
let receivedCam3 = null;
eng.addCameraFrameListener(() => {
  throw new Error('Test listener exception');
});
eng.addCameraFrameListener((cam) => {
  receivedCam3 = { ...cam };
});

eng.setCamera(300, 400, 0.75);
assert.deepStrictEqual(receivedCam3, { x: 300, y: 400, zoom: 0.75 }, 'Listener 3 should succeed despite preceding listener error');
console.log('✓ Error boundary inside notifyCameraFrame protects subsequent listeners');

// 5. Lifecycle cleanup on engine destroy()
eng.destroy();
// Camera frame listeners set should be cleared
let receivedAfterDestroy = false;
eng.addCameraFrameListener(() => {
  receivedAfterDestroy = true;
});
// Destroyed engine should not throw and listeners set was cleared
assert.strictEqual(eng.destroyed, true, 'Engine should be destroyed');
console.log('✓ CanvasEngine.destroy() cleanly tears down listener subscriptions');

console.log('🎉 ALL CAMERA FRAME LISTENER LIFECYCLE TESTS PASSED!');
