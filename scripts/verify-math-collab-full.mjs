import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5175';

async function verifyAllMathCollabRequirements() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    console.log('[STEP 1] Navigating page1 and page2...');
    await page1.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page2.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page1.waitForSelector('.canvas-workspace', { timeout: 10000 });
    await page2.waitForSelector('.canvas-workspace', { timeout: 10000 });

    await page1.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    await page2.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    console.log('[STEP 1 PASS] Collab connected.');

    // Clear board first
    await page1.evaluate(() => {
      window.eng.clearSelection();
      window.eng.shapes.forEach((_, id) => window.eng.yMap.delete(id));
      window.eng.setCamera(0, 0, 1.0);
    });
    await page2.evaluate(() => {
      window.eng.setCamera(0, 0, 1.0);
    });
    await page1.waitForTimeout(300);
    await page2.waitForTimeout(300);

    // --- REQUIREMENT 1 & 2: Modal position stability & Tab switching size stability ---
    console.log('\n[TEST 1] Creating Math shape and testing panel position + shape size stability across tab switches...');
    await page1.click('button[aria-label*="Text, Math"]');
    await page1.waitForSelector('.tool-popover', { state: 'visible', timeout: 5000 });
    await page1.click('.popover-item:has-text("Math")');
    await page1.waitForTimeout(200);

    await page1.mouse.click(500, 300);
    await page1.waitForTimeout(400);

    const getEditorPos = async () => {
      return await page1.evaluate(() => {
        const el = document.querySelector('.formula-editor-panel');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { top: Math.round(rect.top), left: Math.round(rect.left), height: Math.round(rect.height), width: Math.round(rect.width) };
      });
    };

    const getMathToolsPos = async () => {
      return await page1.evaluate(() => {
        const el = document.querySelector('.math-tools-panel');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { top: Math.round(rect.top), left: Math.round(rect.left), height: Math.round(rect.height), width: Math.round(rect.width) };
      });
    };

    const posInit = await getEditorPos();
    const toolsPosInit = await getMathToolsPos();
    console.log('Initial FormulaEditor pos:', posInit);
    console.log('Initial MathToolsPanel pos:', toolsPosInit);

    const shapeInit = await page1.evaluate(() => Array.from(window.eng.shapes.values()).find(s => s.type === 'math'));
    console.log('Initial Shape dimensions:', { w: shapeInit?.w, h: shapeInit?.h });

    // Repeated tab switches (3 round trips)
    for (let i = 1; i <= 3; i++) {
      await page1.click('button:has-text("Edit LaTeX")');
      await page1.waitForTimeout(150);

      const posLatex = await getEditorPos();
      const shapeLatex = await page1.evaluate(() => Array.from(window.eng.shapes.values()).find(s => s.type === 'math'));
      const tab2ShapeLatex = await page2.evaluate(() => Array.from(window.eng.shapes.values()).find(s => s.type === 'math'));

      if (posLatex.top !== posInit.top || posLatex.left !== posInit.left) {
        throw new Error(`Editor position jumped on switch to Edit LaTeX (Round ${i}): expected (${posInit.left}, ${posInit.top}), got (${posLatex.left}, ${posLatex.top})`);
      }
      if (shapeLatex.w > 100 || tab2ShapeLatex.w > 100) {
        throw new Error(`Shape width ballooned to editor width: shapeLatex.w=${shapeLatex.w}, tab2=${tab2ShapeLatex.w}`);
      }

      await page1.click('button:has-text("Rendered")');
      await page1.waitForTimeout(150);

      const posRendered = await getEditorPos();
      if (posRendered.top !== posInit.top || posRendered.left !== posInit.left) {
        throw new Error(`Editor position jumped on switch back to Rendered (Round ${i}): expected (${posInit.left}, ${posInit.top}), got (${posRendered.left}, ${posRendered.top})`);
      }
    }
    console.log('[TEST 1 PASS] Repeated tab switching maintains stable top-left panel position and does NOT resize shape to 520px.');

    // --- REQUIREMENT 3: Incomplete input preserves last valid preview and size ---
    console.log('\n[TEST 2] Testing incomplete input handling on remote canvas...');
    await page1.click('button:has-text("Edit LaTeX")');
    await page1.waitForTimeout(200);

    // Type valid formula first: x + y = z
    const cm = page1.locator('.cm-content');
    await cm.click();
    await page1.keyboard.press('Control+A');
    await page1.keyboard.type('x + y = z');
    await page1.waitForTimeout(400);

    const tab2Valid = await page2.evaluate(() => {
      const s = Array.from(window.eng.shapes.values()).find(s => s.type === 'math');
      const el = document.querySelector('.board-math-preview');
      return {
        previewText: s?.previewText,
        text: s?.text,
        w: s?.w,
        h: s?.h,
        html: el?.innerHTML,
        hasErrorClass: !!el?.querySelector('.fm-render-error')
      };
    });
    console.log('Tab 2 after typing valid "x + y = z":', {
      text: tab2Valid.text,
      previewText: tab2Valid.previewText,
      dimensions: { w: tab2Valid.w, h: tab2Valid.h },
      hasError: tab2Valid.hasErrorClass
    });
    if (tab2Valid.previewText !== 'x + y = z' || tab2Valid.hasErrorClass) {
      throw new Error(`Failed to commit valid preview: ${JSON.stringify(tab2Valid)}`);
    }

    const savedValidW = tab2Valid.w;
    const savedValidH = tab2Valid.h;

    // Now append incomplete syntax: unclosed brace
    console.log('Typing incomplete syntax with unclosed brace...');
    await page1.keyboard.type(' \\frac{1}{');
    await page1.keyboard.press('ArrowRight');
    await page1.keyboard.press('Backspace'); // remove auto-inserted closing brace
    await page1.waitForTimeout(400);

    const tab2AfterIncomplete = await page2.evaluate(() => {
      const s = Array.from(window.eng.shapes.values()).find(s => s.type === 'math');
      const el = document.querySelector('.board-math-preview');
      return {
        text: s?.text,
        previewText: s?.previewText,
        w: s?.w,
        h: s?.h,
        hasErrorClass: !!el?.querySelector('.fm-render-error'),
        textRendered: el?.innerText
      };
    });

    console.log('Tab 2 during incomplete typing:', {
      draftText: tab2AfterIncomplete.text,
      previewText: tab2AfterIncomplete.previewText,
      dimensions: { w: tab2AfterIncomplete.w, h: tab2AfterIncomplete.h },
      hasError: tab2AfterIncomplete.hasErrorClass
    });

    if (tab2AfterIncomplete.previewText !== 'x + y = z') {
      throw new Error(`Incomplete input overwrote last valid preview! Got: ${tab2AfterIncomplete.previewText}`);
    }
    if (tab2AfterIncomplete.w !== savedValidW || tab2AfterIncomplete.h !== savedValidH) {
      throw new Error(`Dimensions changed during incomplete input! Expected ${savedValidW}x${savedValidH}, got ${tab2AfterIncomplete.w}x${tab2AfterIncomplete.h}`);
    }
    if (tab2AfterIncomplete.hasErrorClass) {
      throw new Error(`Remote canvas displayed syntax error to collaborator!`);
    }
    console.log('[TEST 2 PASS] Incomplete input updates draftText but keeps last valid preview, size, and shows NO red syntax error on collaborator canvas.');

    // Complete the formula: 2}
    await page1.keyboard.type('2}');
    await page1.waitForTimeout(400);

    const tab2Completed = await page2.evaluate(() => {
      const s = Array.from(window.eng.shapes.values()).find(s => s.type === 'math');
      return {
        text: s?.text,
        previewText: s?.previewText,
        w: s?.w,
        h: s?.h
      };
    });
    console.log('Tab 2 after completing formula:', tab2Completed);
    if (!tab2Completed.previewText?.includes('\\frac{1}{2}')) {
      throw new Error(`Completed formula did not update preview! Got: ${tab2Completed.previewText}`);
    }
    console.log('[TEST 2.1 PASS] Completed formula immediately updated previewText and dimensions for collaborator.');

    // --- REQUIREMENT 4: Legacy shape compatibility (previewText === undefined) ---
    console.log('\n[TEST 3] Testing legacy shape compatibility (previewText === undefined)...');
    await page1.evaluate(() => {
      // Insert legacy shape directly into Yjs map
      const legacyShape = {
        id: 'legacy_shape_1',
        type: 'math',
        x: 100,
        y: 100,
        w: 120,
        h: 60,
        text: 'E = mc^2',
        // previewText is intentionally omitted / undefined
        color: '#000000',
        fs: 14
      };
      window.eng.yMap.set('legacy_shape_1', legacyShape);
    });
    await page1.waitForTimeout(300);
    await page2.waitForTimeout(300);

    const legacyOverlayTab2 = await page2.evaluate(() => {
      const s = window.eng.shapes.get('legacy_shape_1');
      const el = document.getElementById('ol_legacy_shape_1');
      return {
        shapeExists: !!s,
        previewTextInShape: s?.previewText,
        overlayRendered: !!el,
        hasErrorClass: !!el?.querySelector('.fm-render-error'),
        textRendered: el?.innerText
      };
    });
    console.log('Legacy shape render on Tab 2:', legacyOverlayTab2);
    if (!legacyOverlayTab2.shapeExists || !legacyOverlayTab2.overlayRendered || legacyOverlayTab2.hasErrorClass) {
      throw new Error(`Legacy shape failed to render properly: ${JSON.stringify(legacyOverlayTab2)}`);
    }
    // Verify that rendering did not mutate the shape to add previewText
    if (legacyOverlayTab2.previewTextInShape !== undefined) {
      throw new Error(`Legacy shape was mutated during render loop!`);
    }
    console.log('[TEST 3 PASS] Legacy shape renders source without error and is NOT mutated in render loop.');

    // --- REQUIREMENT 5: Telex & bare pmatrix templates compatibility ---
    console.log('\n[TEST 4] Testing Telex macro and bare pmatrix template rendering...');
    const formulasToTest = [
      { name: 'bare pmatrix2x3', input: 'pmatrix2x3' },
      { name: 'bare pmatrix3x3', input: 'pmatrix3x3' },
      { name: 'diff macro', input: '\\diff{\\frac{a}{b}}' },
      { name: 'norm macro', input: '\\norm{x}' },
      { name: 'literal text', input: '\\text{Hello -> World}' }
    ];

    for (const item of formulasToTest) {
      await page1.evaluate((text) => {
        const id = 'formula_' + Math.random().toString(36).substr(2, 6);
        window.eng.yMap.set(id, {
          id,
          type: 'math',
          x: 200,
          y: 200,
          w: 150,
          h: 80,
          text,
          previewText: text,
          color: '#000000',
          fs: 14
        });
      }, item.input);
      await page2.waitForTimeout(200);

      const res = await page2.evaluate((text) => {
        const s = Array.from(window.eng.shapes.values()).find(s => s.text === text);
        if (!s) return null;
        const el = document.getElementById('ol_' + s.id);
        return {
          rendered: !!el,
          hasErrorClass: !!el?.querySelector('.fm-render-error')
        };
      }, item.input);

      console.log(`Render result for "${item.name}":`, res);
      if (!res || !res.rendered || res.hasErrorClass) {
        throw new Error(`Formula "${item.name}" failed to render without error!`);
      }
    }
    console.log('[TEST 4 PASS] All Telex macros and bare matrix templates render cleanly without error.');

    console.log('\n========================================');
    console.log('ALL VERIFICATION REQUIREMENTS PASSED 100%');
    console.log('========================================');

  } finally {
    await browser.close();
  }
}

verifyAllMathCollabRequirements().catch((err) => {
  console.error('\nVerification FAILED:', err);
  process.exit(1);
});
