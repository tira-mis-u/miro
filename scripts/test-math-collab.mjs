import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5175';

async function testMathCollab() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    console.log('Navigating page1 and page2...');
    await page1.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page2.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page1.waitForSelector('.canvas-workspace', { timeout: 10000 });
    await page2.waitForSelector('.canvas-workspace', { timeout: 10000 });

    // Wait for collab connection
    await page1.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    await page2.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    console.log('Collab connected!');

    // Clear board first to test cleanly
    await page1.evaluate(() => {
      window.eng.clearSelection();
      window.eng.shapes.forEach((_, id) => window.eng.yMap.delete(id));
      window.eng.setCamera(0, 0, 1.0);
    });
    await page2.evaluate(() => {
      window.eng.setCamera(0, 0, 1.0);
    });
    await page1.waitForTimeout(400);
    await page2.waitForTimeout(400);

    // Tab 1 creates a Math shape via tool
    console.log('Tab 1 placing Math shape at (400, 300)...');
    await page1.click('button[aria-label*="Text, Math"]');
    await page1.waitForSelector('.tool-popover', { state: 'visible', timeout: 5000 });
    await page1.click('.popover-item:has-text("Math")');
    await page1.waitForTimeout(200);

    // Click canvas to create math shape
    await page1.mouse.click(400, 300);
    await page1.waitForTimeout(500);

    // Tab 1 should now have .formula-editor-panel open
    const hasEditor1 = await page1.locator('.formula-editor-panel').isVisible();
    console.log('Tab 1 formula editor visible:', hasEditor1);

    // Let's inspect shape in Tab 1 and Tab 2
    const shapeTab1 = await page1.evaluate(() => {
      const eng = window.eng;
      return Array.from(eng.shapes.values()).find(s => s.type === 'math');
    });
    console.log('Tab 1 shape after creation:', shapeTab1);

    const shapeTab2 = await page2.evaluate(() => {
      const eng = window.eng;
      return Array.from(eng.shapes.values()).find(s => s.type === 'math');
    });
    console.log('Tab 2 shape after creation:', shapeTab2);

    // Tab 2 overlay element
    const tab2Overlay = await page2.evaluate(() => {
      const el = document.querySelector('.board-math-preview');
      return el ? {
        outerHTML: el.outerHTML,
        text: el.innerText,
        box: el.getBoundingClientRect(),
      } : null;
    });
    console.log('Tab 2 initial overlay:', tab2Overlay);

    // Now, Tab 1 switches to "Edit LaTeX" tab
    console.log('\n--- Tab 1 switches to Edit LaTeX tab ---');
    await page1.click('button:has-text("Edit LaTeX")');
    await page1.waitForTimeout(300);

    const shapeAfterLatexTab = await page1.evaluate(() => {
      const eng = window.eng;
      return Array.from(eng.shapes.values()).find(s => s.type === 'math');
    });
    console.log('Tab 1 shape after Edit LaTeX tab clicked:', { w: shapeAfterLatexTab?.w, h: shapeAfterLatexTab?.h });

    const tab2AfterLatexTab = await page2.evaluate(() => {
      const el = document.querySelector('.board-math-preview');
      return el ? {
        box: el.getBoundingClientRect(),
      } : null;
    });
    console.log('Tab 2 bounds after Tab 1 clicked Edit LaTeX tab:', tab2AfterLatexTab?.box);

    // Tab 1 switches back to "Rendered" tab
    console.log('\n--- Tab 1 switches back to Rendered tab ---');
    await page1.click('button:has-text("Rendered")');
    await page1.waitForTimeout(300);

    const shapeAfterRenderedTab = await page1.evaluate(() => {
      const eng = window.eng;
      return Array.from(eng.shapes.values()).find(s => s.type === 'math');
    });
    console.log('Tab 1 shape after Rendered tab clicked:', { w: shapeAfterRenderedTab?.w, h: shapeAfterRenderedTab?.h });

    const tab2AfterRenderedTab = await page2.evaluate(() => {
      const el = document.querySelector('.board-math-preview');
      return el ? {
        box: el.getBoundingClientRect(),
      } : null;
    });
    console.log('Tab 2 bounds after Tab 1 clicked Rendered tab:', tab2AfterRenderedTab?.box);

    // Now Tab 1 types LaTeX in CodeMirror
    console.log('\n--- Tab 1 switches to Edit LaTeX and types new formula ---');
    await page1.click('button:has-text("Edit LaTeX")');
    await page1.waitForTimeout(300);

    // Focus editor and type
    const cm = page1.locator('.cm-content');
    await cm.click();
    await page1.keyboard.press('Control+A');
    await page1.keyboard.type('E = mc^2');
    await page1.waitForTimeout(500);

    const shapeWhileTyping = await page2.evaluate(() => {
      const eng = window.eng;
      return Array.from(eng.shapes.values()).find(s => s.type === 'math');
    });
    console.log('Tab 2 shape while Tab 1 typed "E = mc^2":', {
      text: shapeWhileTyping?.text,
      previewText: shapeWhileTyping?.previewText,
    });

    const tab2HtmlWhileTyping = await page2.evaluate(() => {
      const el = document.querySelector('.board-math-preview');
      return el ? {
        html: el.innerHTML,
        text: el.innerText,
      } : null;
    });
    console.log('Tab 2 preview content while Tab 1 typing:', tab2HtmlWhileTyping);

  } finally {
    await browser.close();
  }
}

testMathCollab().catch(console.error);
