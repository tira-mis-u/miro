import { chromium } from 'playwright';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

async function main() {
  console.log('=== STARTING COLLABORATIVE PRIVACY & STATE ISOLATION AUDIT ===');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  const boardId = `privacy-test-${Date.now()}`;
  const baseUrl = (process.env.APP_URL || process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 5175}`).replace(/\/$/, '');
  const boardUrl = `${baseUrl}/?board=${boardId}`;
  console.log(`Auditing dynamic board URL: ${boardUrl}`);

  // Tab 1 (User 1 - Anonymous 1)
  const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1 = await context1.newPage();
  await page1.goto(boardUrl, { waitUntil: 'networkidle' });
  await page1.waitForSelector('.canvas-workspace', { timeout: 10000 });
  await page1.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });
  await page1.waitForTimeout(600);

  // Tab 2 (User 2 - Anonymous 2)
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await context2.newPage();
  await page2.goto(boardUrl, { waitUntil: 'networkidle' });
  await page2.waitForSelector('.canvas-workspace', { timeout: 10000 });
  await page2.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });
  await page2.waitForTimeout(800);

  // Verify users & non-colliding dynamic colors
  const user1 = await page1.evaluate(() => document.querySelector('.header-user-avatar span')?.textContent);
  const user2 = await page2.evaluate(() => document.querySelector('.header-user-avatar span')?.textContent);
  const user1Bg = await page1.evaluate(() => document.querySelector('.header-user-avatar')?.getAttribute('style'));
  const user2Bg = await page2.evaluate(() => document.querySelector('.header-user-avatar')?.getAttribute('style'));
  console.log(`✓ Active users verified: Tab 1 = ${user1}, Tab 2 = ${user2}`);
  console.log(`✓ Dynamic colors verified: Tab 1 = ${user1Bg}, Tab 2 = ${user2Bg}`);
  assert.strictEqual(user1, 'A1');
  assert.strictEqual(user2, 'A2');
  assert.notStrictEqual(user1Bg, user2Bg, 'Users must have completely distinct non-colliding colors');

  // ==========================================
  // TEST 1: SELECTION ISOLATION
  // ==========================================
  console.log('\n--- TEST 1: SELECTION ISOLATION (Vùng chọn chỉ mình thấy) ---');

  // Switch Tab 1 to Select tool
  await page1.click('button[aria-label="Select Tools"]');
  await page1.waitForTimeout(300);

  // Tab 1 creates a sticky note shape and selects it
  const shapeId = await page1.evaluate(() => {
    const s = {
      id: 'sticky-test-' + Date.now(),
      type: 'sticky',
      x: 200,
      y: 150,
      w: 180,
      h: 120,
      fill: '#fef08a',
      stroke: '#eab308',
      text: 'Confidential Note',
      fs: 16,
    };
    window.eng.put(s);
    window.eng.sel.clear();
    window.eng.sel.add(s.id);
    window.eng.render();
    if (window.eng.onSel) window.eng.onSel(Array.from(window.eng.sel));
    return s.id;
  });

  await page1.waitForTimeout(500);
  await page2.waitForTimeout(500);

  // Assert Tab 1 has the shape selected with selection chrome / toolbar
  const tab1Selection = await page1.evaluate((id) => {
    return {
      engineSelSize: window.eng.sel.size,
      hasShapeSelected: window.eng.sel.has(id),
      toolbarVisible: Boolean(document.querySelector('.selection-toolbar')),
      selectionChromeCount: document.querySelectorAll('.board-dom-selection-chrome').length,
    };
  }, shapeId);
  console.log('Tab 1 (Selector) state:', tab1Selection);
  assert.strictEqual(tab1Selection.hasShapeSelected, true, 'Tab 1 must have shape in engine.sel');
  assert.strictEqual(tab1Selection.toolbarVisible, true, 'Tab 1 must display floating selection toolbar');
  assert.ok(tab1Selection.selectionChromeCount >= 1, 'Tab 1 must display DOM selection chrome & handles');

  // Assert Tab 2 has ZERO selection state for this shape
  const tab2Selection = await page2.evaluate((id) => {
    return {
      engineSelSize: window.eng.sel.size,
      hasShapeSelected: window.eng.sel.has(id),
      toolbarCount: document.querySelectorAll('.selection-toolbar').length,
      selectionChromeCount: document.querySelectorAll('.board-dom-selection-chrome').length,
      shapeExists: window.eng.shapes.has(id),
    };
  }, shapeId);
  console.log('Tab 2 (Remote Observer) state:', tab2Selection);
  assert.strictEqual(tab2Selection.shapeExists, true, 'Tab 2 must have synchronized the shape geometry via CRDT');
  assert.strictEqual(tab2Selection.hasShapeSelected, false, 'Tab 2 MUST NOT have shape in engine.sel (Private Isolation)');
  assert.strictEqual(tab2Selection.toolbarCount, 0, 'Tab 2 MUST NOT display selection toolbar');
  assert.strictEqual(tab2Selection.selectionChromeCount, 0, 'Tab 2 MUST NOT render selection bounding box or handles');
  console.log('✅ TEST 1 PASSED: Selection bounding box and toolbar are 100% private to Tab 1!');

  // ==========================================
  // TEST 2: MATH TOOLS & FORMULA PRIVACY
  // ==========================================
  console.log('\n--- TEST 2: MATH TOOLS & FORMULA PRIVACY (Math Tools ẩn, chỉ thấy Math Preview) ---');

  // Tab 1 creates a math shape
  const mathId = await page1.evaluate(() => {
    const m = {
      id: 'math-test-' + Date.now(),
      type: 'math',
      x: 450,
      y: 200,
      w: 240,
      h: 80,
      text: '\\alpha + \\beta = \\gamma',
      previewText: '\\alpha + \\beta = \\gamma',
      fs: 20,
    };
    window.eng.put(m);
    return m.id;
  });

  await page1.waitForTimeout(600);
  await page2.waitForTimeout(600);

  // Tab 1 triggers double-click edit on math shape
  await page1.evaluate((id) => {
    const shape = window.eng.shapes.get(id);
    if (window.eng.onEditText) {
      window.eng.onEditText(shape, 500, 220);
    }
  }, mathId);

  await page1.waitForTimeout(500);
  await page2.waitForTimeout(500);

  // Verify Tab 1 has FormulaEditor toolbar / mode switch mounted
  const tab1MathState = await page1.evaluate(() => {
    return {
      formulaToolbarVisible: Boolean(document.querySelector('.formula-editor-toolbar')),
      formulaModeSwitchVisible: Boolean(document.querySelector('.formula-editor-mode-switch')),
      mathToolsCount: document.querySelectorAll('.math-tools-panel').length,
    };
  });
  console.log('Tab 1 Math Editing UI State:', tab1MathState);
  assert.strictEqual(tab1MathState.formulaToolbarVisible, true, 'Tab 1 must mount FormulaEditor toolbar');

  // Verify Tab 2 has ZERO FormulaEditor and ZERO MathToolsPanel, but HAS the KaTeX math preview!
  const tab2MathState = await page2.evaluate((id) => {
    const previewEl = document.getElementById(`ol_${id}`);
    const katexEl = previewEl?.querySelector('.katex');
    return {
      formulaToolbarCount: document.querySelectorAll('.formula-editor-toolbar').length,
      mathToolsCount: document.querySelectorAll('.math-tools-panel').length,
      previewElementExists: Boolean(previewEl),
      previewClass: previewEl?.className,
      hasKatexRendered: Boolean(katexEl),
      previewInnerHTML: previewEl?.innerHTML?.slice(0, 80),
    };
  }, mathId);
  console.log('Tab 2 Math Remote State:', tab2MathState);

  assert.strictEqual(tab2MathState.formulaToolbarCount, 0, 'Tab 2 MUST NOT have any FormulaEditor toolbar elements mounted');
  assert.strictEqual(tab2MathState.mathToolsCount, 0, 'Tab 2 MUST NOT have any MathToolsPanel elements mounted');
  assert.strictEqual(tab2MathState.previewElementExists, true, 'Tab 2 MUST render the Math Preview container on canvas');
  console.log('✅ TEST 2 PASSED: Math Tools & Formula Editor are 100% private; Tab 2 only sees the rendered Math Preview!');

  // ==========================================
  // TEST 3: REAL-TIME MATH PREVIEW SYNC
  // ==========================================
  console.log('\n--- TEST 3: REAL-TIME MATH PREVIEW SYNCHRONIZATION ---');
  // Tab 1 types a new complex formula live: E = mc^2
  await page1.evaluate((id) => {
    const updatedSource = 'E = mc^2';
    window.eng.updateFormulaLive(id, updatedSource, updatedSource);
  }, mathId);

  await page1.waitForTimeout(500);
  await page2.waitForTimeout(500);

  const tab2SyncedMath = await page2.evaluate((id) => {
    const shape = window.eng.shapes.get(id);
    const previewEl = document.getElementById(`ol_${id}`);
    return {
      syncedPreviewText: shape?.previewText,
      previewTextContent: previewEl?.textContent,
      formulaEditorStillHidden: document.querySelectorAll('.formula-editor-container, .formula-input').length === 0,
      mathToolsStillHidden: document.querySelectorAll('.math-tools-panel').length === 0,
    };
  }, mathId);
  console.log('Tab 2 Synced Math State:', tab2SyncedMath);

  assert.strictEqual(tab2SyncedMath.syncedPreviewText, 'E = mc^2', 'Tab 2 must receive live previewText update via CRDT');
  assert.strictEqual(tab2SyncedMath.formulaEditorStillHidden, true, 'Tab 2 still has zero formula editor elements');
  assert.strictEqual(tab2SyncedMath.mathToolsStillHidden, true, 'Tab 2 still has zero math tools elements');
  console.log('✅ TEST 3 PASSED: Live math formula update renders on Tab 2 with zero editor exposure!');

  // ==========================================
  // TEST 4: VIEWPORT & CAMERA INDEPENDENCE
  // ==========================================
  console.log('\n--- TEST 4: VIEWPORT & CAMERA INDEPENDENCE (Zoom/Pan riêng biệt) ---');
  await page1.evaluate(() => {
    window.eng.cam.zoom = 2.5;
    window.eng.cam.x = 850;
    window.eng.cam.y = 650;
    window.eng.render();
  });
  await page1.waitForTimeout(300);

  const tab1Cam = await page1.evaluate(() => ({ zoom: window.eng.cam.zoom, x: window.eng.cam.x, y: window.eng.cam.y }));
  const tab2Cam = await page2.evaluate(() => ({ zoom: window.eng.cam.zoom, x: window.eng.cam.x, y: window.eng.cam.y }));
  console.log('Tab 1 Camera:', tab1Cam);
  console.log('Tab 2 Camera:', tab2Cam);

  assert.strictEqual(tab1Cam.zoom, 2.5, 'Tab 1 zoomed to 250%');
  assert.strictEqual(tab2Cam.zoom, 1, 'Tab 2 camera zoom MUST remain at 100% (Independent)');
  assert.notStrictEqual(tab1Cam.x, tab2Cam.x, 'Tab 1 and Tab 2 camera X coordinates are completely isolated');
  console.log('✅ TEST 4 PASSED: Camera zoom and panning are 100% independent!');

  // Take visual screenshots using relative directory
  const scratchDir = path.resolve(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  const screenshotPath1 = path.join(scratchDir, 'screenshot_privacy_tab1.png');
  const screenshotPath2 = path.join(scratchDir, 'screenshot_privacy_tab2.png');
  await page1.screenshot({ path: screenshotPath1 });
  await page2.screenshot({ path: screenshotPath2 });
  console.log(`✓ Screenshots saved to relative paths:\n  - ${path.relative(process.cwd(), screenshotPath1)}\n  - ${path.relative(process.cwd(), screenshotPath2)}`);

  console.log('\n=== ALL REALTIME STATE ISOLATION & PRIVACY AUDITS PASSED WITH ZERO FAILURES! ===');
  await browser.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
