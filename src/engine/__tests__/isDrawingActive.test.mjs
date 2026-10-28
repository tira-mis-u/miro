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
      return { left: 0, top: 0, width, height, right: width, bottom: height };
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

function makePointerEvent(type, opts = {}) {
  return {
    clientX: opts.clientX ?? 200,
    clientY: opts.clientY ?? 200,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? 1,
    pointerId: 1,
    isPrimary: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    target: { closest: () => null },
    ...opts,
  };
}

console.log('--- Testing Phase 3: isDrawingActive() vs Engine Gesture States ---');

const yDoc = new Y.Doc();
const yShapes = yDoc.getMap('shapes');
const mockCv = createMockCanvas(1000, 800);
const eng = new CanvasEngine(mockCv, yShapes);

// 1. Initial idle state
assert.strictEqual(eng.isDrawingActive(), false, 'Idle engine must have isDrawingActive === false');
console.log('✓ 1. Initial idle state is false');

// 2. Pen tool drawing
eng.setTool('pen');
assert.strictEqual(eng.isDrawingActive(), false, 'Pen tool before pointerDown is false');
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
assert.strictEqual(eng.isDrawingActive(), true, 'Pen tool during pointerDown must be true');
eng.pointerMove(makePointerEvent('pointermove', { clientX: 150, clientY: 120 }));
assert.strictEqual(eng.isDrawingActive(), true, 'Pen tool during pointerMove must remain true');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 150, clientY: 120 }));
assert.strictEqual(eng.isDrawingActive(), false, 'Pen tool after pointerUp must reset to false');
console.log('✓ 2. Pen tool continuous drawing lifecycle verified (false -> true -> true -> false)');

// 3. Box shape tool (rect)
eng.setTool('rect');
assert.strictEqual(eng.isDrawingActive(), false, 'Rect tool before pointerDown is false');
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 200, clientY: 200 }));
assert.strictEqual(eng.isDrawingActive(), true, 'Rect creation gesture during pointerDown must be true');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 300, clientY: 250 }));
assert.strictEqual(eng.isDrawingActive(), false, 'Rect tool after pointerUp must reset to false');
console.log('✓ 3. Box shape tool (rect) creation gesture verified');

// 4. Connector tool (line)
eng.setTool('line');
assert.strictEqual(eng.isDrawingActive(), false, 'Line tool before pointerDown is false');
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 200, clientY: 200 }));
assert.strictEqual(eng.isDrawingActive(), true, 'Connector creation gesture during pointerDown must be true');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 400, clientY: 300 }));
assert.strictEqual(eng.isDrawingActive(), false, 'Connector tool after pointerUp must reset to false');
console.log('✓ 4. Connector tool (line) creation gesture verified');

// 5. Select tool box selection (marquee) - must NOT be considered active drawing!
eng.setTool('select');
eng.clearSelection();
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
assert.strictEqual(eng.isDrawingActive(), false, 'Marquee selection must NOT be active drawing');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 50, clientY: 50 }));
assert.strictEqual(eng.isDrawingActive(), false, 'After marquee selection, isDrawingActive must remain false');
console.log('✓ 5. Marquee box selection correctly excluded from isDrawingActive');

// 6. Select tool shape dragging - must NOT be considered active drawing!
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 220, clientY: 220 })); // click the rect created earlier
assert.strictEqual(eng.isDrawingActive(), false, 'Shape dragging must NOT be active drawing');
eng.pointerMove(makePointerEvent('pointermove', { clientX: 260, clientY: 240 }));
assert.strictEqual(eng.isDrawingActive(), false, 'During shape drag, isDrawingActive must remain false');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 260, clientY: 240 }));
assert.strictEqual(eng.isDrawingActive(), false, 'After shape drag, isDrawingActive must remain false');
console.log('✓ 6. Shape translation/dragging correctly excluded from isDrawingActive');

// 7. Lasso selection tool - must NOT be considered active drawing!
eng.setTool('lasso-select');
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
assert.strictEqual(eng.isDrawingActive(), false, 'Lasso selection must NOT be active drawing');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 40, clientY: 40 }));
assert.strictEqual(eng.isDrawingActive(), false, 'After lasso selection, isDrawingActive must remain false');
console.log('✓ 7. Lasso selection correctly excluded from isDrawingActive');

// 8. Eraser tool - must NOT be considered active drawing!
eng.setTool('eraser');
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
assert.strictEqual(eng.isDrawingActive(), false, 'Eraser tool must NOT be active drawing');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 10, clientY: 10 }));
assert.strictEqual(eng.isDrawingActive(), false, 'After erasing, isDrawingActive must remain false');
console.log('✓ 8. Eraser tool correctly excluded from isDrawingActive');

// 9. Panning gesture (right-click button 2) - must NOT be active drawing!
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 2 }));
assert.strictEqual(eng.isDrawingActive(), false, 'Panning gesture must NOT be active drawing');
eng.pointerUp(makePointerEvent('pointerup', { clientX: 150, clientY: 150, button: 2 }));
assert.strictEqual(eng.isDrawingActive(), false, 'After panning, isDrawingActive must remain false');
console.log('✓ 9. Canvas panning gesture correctly excluded from isDrawingActive');

// 10. cancelPointer aborts active drawing cleanly
eng.setTool('pen');
eng.pointerDown(makePointerEvent('pointerdown', { clientX: 200, clientY: 200 }));
assert.strictEqual(eng.isDrawingActive(), true, 'Pen drawing active before cancelPointer');
eng.cancelPointer();
assert.strictEqual(eng.isDrawingActive(), false, 'cancelPointer() must immediately reset isDrawingActive to false');
console.log('✓ 10. cancelPointer() aborts active drawing cleanly');

eng.destroy();
console.log('🎉 ALL isDrawingActive() GESTURE CORRELATION TESTS PASSED!');
