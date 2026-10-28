import { chromium } from 'playwright';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:5175';

async function main() {
  console.log('--- Starting verification for Math Editor Zoom & Off-screen Indicators ---');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    page1.on('console', msg => console.log('PAGE1 LOG:', msg.text()));
    page1.on('pageerror', err => console.log('PAGE1 ERROR:', err));
    page2.on('console', msg => console.log('PAGE2 LOG:', msg.text()));
    page2.on('pageerror', err => console.log('PAGE2 ERROR:', err));

    console.log('Connecting Page 1 and Page 2...');
    await page1.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page2.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page1.waitForSelector('.canvas-workspace', { timeout: 10000 });
    await page2.waitForSelector('.canvas-workspace', { timeout: 10000 });

    // Wait for collaboration presence connection
    await page1.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    console.log('✓ Collaboration presence connected.');

    // ─── TEST 1: Math Formula Editor Zoom Independence ───
    console.log('\n--- Test 1: Math Formula Editor Zoom Independence ---');
    // Clear canvas on Page 1 and select Math tool
    await page1.evaluate(() => {
      window.eng.clearSelection();
      window.eng.shapes.forEach((_, id) => window.eng.yMap.delete(id));
      window.eng.setCamera(0, 0, 1.0);
    });
    await page1.waitForTimeout(300);

    await page1.click('button[aria-label*="Text, Math"]');
    await page1.waitForSelector('.tool-popover', { state: 'visible', timeout: 5000 });
    await page1.click('.popover-item:has-text("Math")');
    await page1.waitForTimeout(200);

    // Click canvas to create and open Math Editor
    await page1.mouse.click(500, 300);
    await page1.waitForTimeout(400);

    // Wait for formula editor panel
    const editorPanel = await page1.waitForSelector('.formula-editor-panel', { timeout: 5000 });
    assert(editorPanel, 'FormulaEditor panel should be visible');

    // Check initial CSS transform and width at 100% zoom
    const initialStyles = await editorPanel.evaluate(el => {
      const computed = window.getComputedStyle(el);
      return {
        transform: el.style.transform || computed.transform,
        width: computed.width,
        height: computed.height,
        left: computed.left,
        top: computed.top,
      };
    });
    console.log('Initial FormulaEditor styles (100% zoom):', initialStyles);
    assert.strictEqual(initialStyles.transform, 'none', 'Editor panel must have transform: none (no scale(zoom))');

    // Zoom in to 2.5x (250%) and zoom out to 0.4x (40%) using CanvasEngine API
    console.log('Zooming canvas to 250%...');
    await page1.evaluate(() => window.eng.setCamera(0, 0, 2.5));
    await page1.waitForTimeout(400);

    const zoomInStyles = await editorPanel.evaluate(el => {
      const computed = window.getComputedStyle(el);
      return {
        transform: el.style.transform || computed.transform,
        width: computed.width,
        left: computed.left,
        top: computed.top,
      };
    });
    console.log('FormulaEditor styles at 250% zoom:', zoomInStyles);
    assert.strictEqual(zoomInStyles.transform, 'none', 'Transform must remain none at 250% zoom');
    assert.strictEqual(zoomInStyles.width, initialStyles.width, 'Width in CSS pixels must remain constant and decoupled from zoom');

    console.log('Zooming canvas to 40% with wheel-like offset...');
    await page1.evaluate(() => window.eng.setCamera(100, 100, 0.4));
    await page1.waitForTimeout(400);

    const zoomOutStyles = await editorPanel.evaluate(el => {
      const computed = window.getComputedStyle(el);
      return {
        transform: el.style.transform || computed.transform,
        width: computed.width,
        left: computed.left,
        top: computed.top,
      };
    });
    console.log('FormulaEditor styles at 40% zoom:', zoomOutStyles);
    assert.strictEqual(zoomOutStyles.transform, 'none', 'Transform must remain none at 40% zoom');
    assert.strictEqual(zoomOutStyles.width, initialStyles.width, 'Width in CSS pixels must remain constant at 40% zoom');
    console.log('✓ Test 1 Passed: Math Formula Editor UI size is completely decoupled from canvas zoom.');

    // Commit or close editor on Page 1
    await page1.keyboard.press('Escape');
    await page1.waitForTimeout(300);

    // ─── TEST 2: Off-Screen Collaborator Indicator & Ray-Box Projection ───
    console.log('\n--- Test 2: Off-Screen Collaborators Indicator ---');
    // Reset camera on Page 1 to origin (0, 0)
    await page1.evaluate(() => window.eng.setCamera(0, 0, 1.0));

    // Page 2 moves cursor to far coordinates off-screen (e.g. worldX: 2500, worldY: 1800)
    await page2.evaluate(() => {
      window.eng.setCamera(2500, 1800, 1.0);
    });

    // Simulate mouse move on Page 2 in canvas workspace
    await page2.mouse.move(700, 500);
    await page2.waitForTimeout(600);

    // Check if Page 1 renders .offscreen-collab-pill
    const offscreenPill = await page1.waitForSelector('.offscreen-collab-pill', { timeout: 6000 });
    assert(offscreenPill, 'Off-screen collaborator pill must appear on Page 1');

    const pillInfo = await offscreenPill.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const text = el.textContent?.trim();
      const arrow = el.querySelector('.offscreen-collab-arrow');
      const arrowTransform = arrow ? window.getComputedStyle(arrow).transform : '';
      return {
        left: rect.left,
        top: rect.top,
        text,
        bg: style.backgroundColor,
        arrowTransform,
      };
    });
    console.log('Page 1 detected off-screen collaborator indicator:', pillInfo);
    assert(pillInfo.text && pillInfo.text.length > 0, 'Off-screen pill must display collaborator name');
    assert(pillInfo.arrowTransform && pillInfo.arrowTransform !== 'none', 'Off-screen pill must have directional arrow rotation');

    const pillClasses = await offscreenPill.evaluate(el => el.className);
    console.log('Off-screen pill classes:', pillClasses);
    assert(pillClasses.includes('offscreen-side-'), 'Pill must have a directional side class (e.g. offscreen-side-bottom or offscreen-side-right)');

    // Now test a peer purely to the right (worldX: 3500, worldY: 0)
    console.log('Testing collaborator purely to the right (worldX: 3500, worldY: 0)...');
    await page2.evaluate(() => {
      window.eng.setCamera(3500, 0, 1.0);
    });
    await page2.mouse.move(600, 400);
    await page1.waitForTimeout(600);

    const rightPillClasses = await page1.waitForSelector('.offscreen-side-right', { timeout: 5000 });
    assert(rightPillClasses, 'Pill must have .offscreen-side-right when peer is to the right');
    console.log('✓ Detected .offscreen-side-right with arrow on the right side!');

    // Now test a peer purely to the left (worldX: -3500, worldY: 0)
    console.log('Testing collaborator purely to the left (worldX: -3500, worldY: 0)...');
    await page2.evaluate(() => {
      window.eng.setCamera(-3500, 0, 1.0);
    });
    await page2.mouse.move(600, 400);
    await page1.waitForTimeout(600);

    const leftPill = await page1.waitForSelector('.offscreen-side-left', { timeout: 5000 });
    assert(leftPill, 'Pill must have .offscreen-side-left when peer is to the left');
    console.log('✓ Detected .offscreen-side-left with arrow on the left side!');

    // Test Click to Jump:
    console.log('Testing click on offscreen-collab-pill to jump camera...');
    const camBefore = await page1.evaluate(() => ({ x: window.eng.cam.x, y: window.eng.cam.y }));
    console.log('Camera before click jump:', camBefore);

    await offscreenPill.click();
    await page1.waitForTimeout(500);

    const camAfter = await page1.evaluate(() => ({ x: window.eng.cam.x, y: window.eng.cam.y }));
    console.log('Camera after click jump:', camAfter);
    assert(Math.abs(camAfter.x - (-3500)) < 200, 'Camera should have panned to remote peer coordinates around -3500');
    console.log('✓ Test 2 Passed: Off-screen indicator positioned accurately and camera jump works smoothly.');

    // ─── TEST 3: Presentation Mode Concurrency & Jitter Prevention ───
    console.log('\n--- Test 3: Presentation Mode Concurrency & Single Presenter Lock ---');
    // Page 1 starts presenting
    console.log('Page 1 starts presenting...');
    await page1.click('button[title*="Present board to everyone"]');
    await page1.waitForTimeout(400);

    const page1IsPresenting = await page1.evaluate(() => {
      return Boolean(document.querySelector('.presenting-indicator-pill')?.textContent?.includes('You are presenting'));
    });
    console.log('Page 1 presenting active:', page1IsPresenting);
    assert(page1IsPresenting, 'Page 1 should be presenting');

    // Page 2 starts presenting concurrently (Takeover)
    console.log('Page 2 starts presenting concurrently (taking over)...');
    await page2.click('button[title*="Present board to everyone"]');
    await page2.waitForTimeout(600);

    const page2IsPresenting = await page2.evaluate(() => {
      return Boolean(document.querySelector('.presenting-indicator-pill')?.textContent?.includes('You are presenting'));
    });
    console.log('Page 2 presenting active:', page2IsPresenting);
    assert(page2IsPresenting, 'Page 2 should be presenting after takeover');

    // Page 1 should gracefully yield: isPresenting is false, takeover notice is shown
    const page1Yielded = await page1.evaluate(() => {
      const text = document.querySelector('.presenting-indicator-pill')?.textContent || '';
      const toast = document.querySelector('.presentation-takeover-toast')?.textContent || '';
      return {
        isFollowingRemote: text.includes('is presenting'),
        hasToast: toast.length > 0,
        toastText: toast,
      };
    });
    console.log('Page 1 yielded state:', page1Yielded);
    assert(page1Yielded.isFollowingRemote, 'Page 1 must yield and become follower when Page 2 takes over');

    // Move camera on Page 2 and ensure NO JITTER / loop on Page 1
    console.log('Moving Page 2 camera and verifying zero camera jitter...');
    await page2.evaluate(() => window.eng.setCamera(500, 500, 1.2));
    await page1.waitForTimeout(600);

    const cam1 = await page1.evaluate(() => ({ x: window.eng.cam.x, y: window.eng.cam.y, z: window.eng.cam.zoom }));
    const cam2 = await page2.evaluate(() => ({ x: window.eng.cam.x, y: window.eng.cam.y, z: window.eng.cam.zoom }));
    console.log('Camera Page 1:', cam1);
    console.log('Camera Page 2:', cam2);
    assert.strictEqual(cam1.x, cam2.x, 'Page 1 should follow Page 2 camera cleanly without jitter');
    assert.strictEqual(cam1.y, cam2.y, 'Page 1 camera Y should match Page 2');
    console.log('✓ Test 3 Passed: Single Presenter Lock resolves concurrent presentations smoothly without jitter.');

    console.log('\n========================================');
    console.log('ALL VERIFICATION TESTS PASSED 100%');
    console.log('========================================');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
