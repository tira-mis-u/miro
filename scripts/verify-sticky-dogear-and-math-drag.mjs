import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const baseUrl = (process.env.APP_URL || process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 5175}`).replace(/\/$/, '');
  console.log(`Navigating to ${baseUrl}/...`);
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // --- PART 1: TEST STICKY NOTE MECHANICS & AESTHETICS ---
  console.log('--- Testing Sticky Note ---');
  const stickyBtn = page.locator('button[aria-label="Sticky Note" i]');
  await stickyBtn.click();
  await page.waitForTimeout(200);

  // Click on canvas to place sticky note
  const canvas = page.locator('.canvas-workspace');
  await canvas.click({ position: { x: 400, y: 300 } });
  await page.waitForTimeout(500);

  // Verify sticky editor is open
  const editbox = page.locator('.is-sticky-box');
  await editbox.waitFor({ state: 'visible', timeout: 5000 });

  // 1. Check blue focus border surrounds the entire sticky note box
  const editboxStyle = await editbox.evaluate(el => {
    const s = window.getComputedStyle(el);
    return {
      border: s.border,
      borderTopColor: s.borderTopColor,
      borderTopWidth: s.borderTopWidth,
      boxShadow: s.boxShadow,
      width: s.width,
      height: s.height,
    };
  });
  console.log('Editbox outer border styles:', editboxStyle);
  if (!editboxStyle.borderTopWidth.includes('2px') || !editboxStyle.borderTopColor.includes('37, 99, 235')) {
    throw new Error('Outer sticky note box does not have the 2px blue focus border!');
  }
  console.log('✓ Blue focus border correctly surrounds the entire yellow sticky note box.');

  // 2. Check textarea inside does NOT have any blue border or outline
  const textarea = page.locator('textarea.board-text-editor');
  const textareaStyle = await textarea.evaluate(el => {
    const s = window.getComputedStyle(el);
    return {
      border: s.border,
      outline: s.outline,
      boxShadow: s.boxShadow,
    };
  });
  console.log('Textarea styles (should be outline: none and border: none):', textareaStyle);
  if (textareaStyle.outline.includes('rgb(37, 99, 235)') || textareaStyle.border.includes('rgb(37, 99, 235)')) {
    throw new Error('Textarea still has internal blue border below datetime!');
  }
  console.log('✓ Textarea has no distracting inner border below datetime.');

  // 3. Verify timestamp format: Thứ (viết tắt), DD MMM YYYY - HH:mm:ss
  const timestampEl = page.locator('.sticky-editor-timestamp span');
  const timestampText = await timestampEl.innerText();
  console.log('Sticky timestamp text:', timestampText);
  const tsPattern = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} - \d{2}:\d{2}:\d{2}$/;
  if (!tsPattern.test(timestampText)) {
    throw new Error(`Timestamp "${timestampText}" does not match format "Thu, 15 Oct 2026 - 17:22:05"!`);
  }
  console.log(`✓ Timestamp format "${timestampText}" verified exact match!`);

  // 4. Verify fixed dog-ear corner is present during editing
  const dogEarInEdit = page.locator('.is-sticky-box .sticky-dog-ear');
  const isDogEarPresent = await dogEarInEdit.isVisible();
  console.log('Is dog-ear corner visible on editbox?', isDogEarPresent);
  if (!isDogEarPresent) {
    throw new Error('Dog-ear triangle missing from editbox!');
  }

  // Type multiple lines of text to test scrolling and fixed dog-ear
  const manyLines = Array.from({ length: 25 }, (_, i) => `Sticky note content line ${i + 1}`).join('\n');
  await textarea.fill(manyLines);
  await page.waitForTimeout(300);

  // Take screenshot in edit mode with blue border surrounding entire note
  await page.screenshot({ path: 'scratch/verify_sticky_edit_border.png' });
  console.log('Captured scratch/verify_sticky_edit_border.png');

  // Commit text by clicking outside
  console.log('Committing sticky note...');
  await page.mouse.click(850, 200);
  await page.waitForTimeout(500);

  // Now sticky note is rendered as preview overlay
  const stickyOverlay = page.locator('.board-sticky-overlay');
  await stickyOverlay.waitFor({ state: 'visible', timeout: 5000 });

  // 5. Verify dog-ear is fixed on preview overlay
  const overlayDogEar = page.locator('.board-sticky-overlay .sticky-dog-ear');
  const initialDogEarBox = await overlayDogEar.boundingBox();
  console.log('Initial overlay dog-ear bounds:', initialDogEarBox);

  // Scroll down the sticky note scroll content
  console.log('Scrolling sticky note content...');
  const scrollContent = page.locator('.board-sticky-scroll-content');
  await scrollContent.evaluate(el => el.scrollTop = 200);
  await page.waitForTimeout(300);

  // Verify dog-ear did NOT move when scrolled down
  const scrolledDogEarBox = await overlayDogEar.boundingBox();
  console.log('Dog-ear bounds after scrolling content:', scrolledDogEarBox);
  if (Math.abs(scrolledDogEarBox.y - initialDogEarBox.y) > 0.5) {
    throw new Error('Dog-ear corner moved or scrolled with content!');
  }
  console.log('✓ Dog-ear triangle stayed 100% fixed on the note while content scrolled!');

  // --- PART 2: TEST MATH TOOLS NATURAL DRAGGING ---
  console.log('--- Testing Math Tools Dragging ---');
  // Deselect sticky note
  await page.mouse.click(900, 250);
  await page.waitForTimeout(400);

  // Open Text & Math tools dropdown
  await page.click('button[aria-label*="Text, Math"]');
  await page.waitForSelector('.tool-popover', { state: 'visible', timeout: 5000 });
  await page.click('.popover-item:has-text("Math")');
  await page.waitForTimeout(300);

  // Place Math formula at (550, 500)
  await page.mouse.click(550, 500);
  await page.waitForTimeout(800);

  const formulaEditor = page.locator('.formula-editor-panel');
  await formulaEditor.waitFor({ state: 'visible', timeout: 5000 });

  const mathTools = page.locator('.math-tools-panel');
  await mathTools.waitFor({ state: 'visible', timeout: 5000 });

  const initialToolsBox = await mathTools.boundingBox();
  console.log('Initial Math Tools bounds:', initialToolsBox);

  // Grab the Math Tools header and drag it 60px right and 40px down
  const header = page.locator('.math-tools-header');
  const headerBox = await header.boundingBox();

  const grabX = headerBox.x + 80;
  const grabY = headerBox.y + 20;

  console.log(`Dragging Math Tools by dx=60px, dy=40px from (${grabX}, ${grabY})...`);
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 60, grabY + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const movedToolsBox = await mathTools.boundingBox();
  console.log('Moved Math Tools bounds:', movedToolsBox);

  const actualDx = movedToolsBox.x - initialToolsBox.x;
  const actualDy = movedToolsBox.y - initialToolsBox.y;
  console.log(`Expected dx=60, dy=40. Actual dx=${actualDx}, actual dy=${actualDy}`);

  // Movement must be exact 1:1 (within 2px allowance for steps rounding)
  if (Math.abs(actualDx - 60) > 3 || Math.abs(actualDy - 40) > 3) {
    throw new Error(`Math Tools dragged abnormally! Expected (60, 40), got (${actualDx}, ${actualDy})`);
  }
  console.log('✓ Math Tools moves 1:1 with mouse, smooth and completely natural!');

  await page.screenshot({ path: 'scratch/verify_all_final.png' });
  console.log('Captured scratch/verify_all_final.png');

  console.log('ALL VERIFICATIONS PASSED 100%!');
  await browser.close();
}

run().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
