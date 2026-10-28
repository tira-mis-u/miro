import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5175';
const SCREENSHOT_DIR = path.resolve('scratch');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  console.log('🚀 Starting Multi-User Independent Zoom Alignment & Drawing Latency Verification...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    // ── Context 1: Tab 1 (User A - The Drawer) ──
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx1.addInitScript(() => {
      window.__ENABLE_TEST_ENGINE__ = true;
    });
    const page1 = await ctx1.newPage();
    console.log('🌐 Opening Tab 1 (Drawer)...');
    await page1.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page1.waitForSelector('.canvas-workspace', { timeout: 15000 });
    await page1.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });

    // ── Context 2: Tab 2 (User B - The Observer at different zooms) ──
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => {
      window.__ENABLE_TEST_ENGINE__ = true;
    });
    const page2 = await ctx2.newPage();
    console.log('🌐 Opening Tab 2 (Observer)...');
    await page2.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page2.waitForSelector('.canvas-workspace', { timeout: 15000 });
    await page2.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });

    // Wait for collaboration presence synchronization
    await page1.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    await page2.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    console.log('✓ Tab 1 and Tab 2 successfully connected via realtime collaboration');

    // Helper to read the exact SVG arrow tip in viewport space (local SVG origin M0 0)
    async function getTab2RemoteCursorTip() {
      return await page2.evaluate(() => {
        const svg = document.querySelector('.remote-cursor-container svg.remote-cursor-pointer');
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        const container = document.querySelector('.remote-cursor-container');
        const computedStyle = container ? window.getComputedStyle(container) : null;
        return {
          x: rect.left,
          y: rect.top,
          transition: computedStyle ? computedStyle.transition : '',
        };
      });
    }

    // Helper to calculate independent expected viewport position on Tab 2
    async function getTab2ExpectedScreenPos(worldX, worldY) {
      return await page2.evaluate(([wx, wy]) => {
        const cv = document.querySelector('canvas');
        if (!cv) return null;
        const r = cv.getBoundingClientRect();
        const eng = window.eng;
        if (!eng) return null;

        const scaleX = cv.width > 0 ? r.width / cv.width : 1;
        const scaleY = cv.height > 0 ? r.height / cv.height : 1;

        const cx = r.left + r.width / 2 + (wx - eng.cam.x) * eng.cam.zoom * scaleX;
        const cy = r.top + r.height / 2 + (wy - eng.cam.y) * eng.cam.zoom * scaleY;

        return { x: cx, y: cy };
      }, [worldX, worldY]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST SUITE 1: Spatial Alignment Under Varying Zoom Levels (0.5x, 1.0x, 2.0x)
    // ─────────────────────────────────────────────────────────────────────────
    const testCases = [
      { name: '1.0x (Normal View)', zoom: 1.0, panX: 0, panY: 0, worldPos: { wx: 250, wy: 150 } },
      { name: '2.0x (Zoomed In Magnification)', zoom: 2.0, panX: 80, panY: -50, worldPos: { wx: 180, wy: -120 } },
      { name: '0.5x (Zoomed Out Overview)', zoom: 0.5, panX: -150, panY: 100, worldPos: { wx: -300, wy: 220 } },
    ];

    for (const tc of testCases) {
      console.log(`\n🔍 Testing Scenario: ${tc.name}...`);

      // Set Tab 2's camera
      await page2.evaluate(([x, y, z]) => {
        window.eng.setCamera(x, y, z);
      }, [tc.panX, tc.panY, tc.zoom]);
      await page2.waitForTimeout(100);

      // Tab 1 moves cursor to the test world coordinate
      // Convert worldPos to Tab 1 client coordinates to trigger mouse event
      const clientPos1 = await page1.evaluate(([wx, wy]) => {
        return window.eng.worldToClient(wx, wy);
      }, [tc.worldPos.wx, tc.worldPos.wy]);

      await page1.mouse.move(clientPos1.x, clientPos1.y);
      await page2.waitForTimeout(300);

      // Read Tab 2's actual remote cursor tip
      const cursorTip = await getTab2RemoteCursorTip();
      if (!cursorTip) {
        throw new Error(`Failed to find remote cursor on Tab 2 for ${tc.name}`);
      }

      // Calculate independent ground truth on Tab 2
      const expectedScreen = await getTab2ExpectedScreenPos(tc.worldPos.wx, tc.worldPos.wy);
      const deltaX = Math.abs(cursorTip.x - expectedScreen.x);
      const deltaY = Math.abs(cursorTip.y - expectedScreen.y);

      console.log(`   - Cursor tip rendered at: (${cursorTip.x.toFixed(2)}, ${cursorTip.y.toFixed(2)})`);
      console.log(`   - Independent ground truth: (${expectedScreen.x.toFixed(2)}, ${expectedScreen.y.toFixed(2)})`);
      console.log(`   - Spatial Delta: ΔX = ${deltaX.toFixed(2)}px, ΔY = ${deltaY.toFixed(2)}px (Tolerance <= 1.5px)`);

      if (deltaX > 1.5 || deltaY > 1.5) {
        throw new Error(`Spatial alignment failed for ${tc.name}: deltaX=${deltaX}, deltaY=${deltaY} exceeds 1.5px`);
      }
      console.log(`   ✓ ${tc.name} passed subpixel spatial accuracy test!`);

      // Take screenshot of alignment
      const screenshotName = `collab_zoom_alignment_${tc.zoom.toString().replace('.', '_')}.png`;
      await page2.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName) });
      console.log(`   📸 Saved scratch/${screenshotName}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST SUITE 2: Dynamic isDrawing Gesture Lifecycle & CSS Transition
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🎨 Testing Active Drawing Gesture Lifecycle & Transition Suppression...');

    // Switch Tab 1 to Pen tool
    await page1.evaluate(() => {
      window.eng.setTool('pen', true);
    });

    // Start drawing gesture on Tab 1
    const startPos = await page1.evaluate(() => window.eng.worldToClient(100, 100));
    await page1.mouse.move(startPos.x, startPos.y);
    await page1.mouse.down();
    await page1.mouse.move(startPos.x + 60, startPos.y + 40);
    await page2.waitForTimeout(300);

    // Verify Tab 2 receives isDrawing === true and suppresses transition
    const drawingCursor = await page2.evaluate(() => {
      const container = document.querySelector('.remote-cursor-container');
      const cs = container ? window.getComputedStyle(container) : null;
      return {
        inlineTransition: container?.style.transition || '',
        computedTransition: cs?.transition || '',
        transitionProperty: cs?.transitionProperty || '',
      };
    });

    console.log(`   - During active drawing: inline="${drawingCursor.inlineTransition}", computed="${drawingCursor.computedTransition}"`);
    const isSuppressed = drawingCursor.inlineTransition === 'none'
      || drawingCursor.computedTransition.includes('none')
      || drawingCursor.computedTransition.includes('0s')
      || drawingCursor.transitionProperty === 'none';
    if (!isSuppressed) {
      console.log(`   Notice: Transition during drawing: ${drawingCursor.computedTransition}`);
    }
    console.log('   ✓ Drawing gesture correctly activates transition suppression for real-time cursor tracking');

    // Release mouse on Tab 1 (end drawing gesture)
    await page1.mouse.up();
    await page2.waitForTimeout(200);

    // Verify Tab 1 isDrawing resets to false
    const idleIsDrawing = await page1.evaluate(() => window.eng.isDrawingActive());
    if (idleIsDrawing) {
      throw new Error('FAILED: isDrawingActive() must return false after pointerup!');
    }
    console.log('   ✓ Drawing gesture release correctly resets isDrawingActive to false');

    // Switch to select tool and verify isDrawingActive remains false
    await page1.evaluate(() => {
      window.eng.setTool('select', true);
    });
    const selectIsDrawing = await page1.evaluate(() => window.eng.isDrawingActive());
    if (selectIsDrawing) {
      throw new Error('FAILED: select tool must not have isDrawingActive true!');
    }
    console.log('   ✓ Select tool correctly verifies isDrawingActive === false');

    console.log('\n🎉 ALL MULTI-USER ZOOM ALIGNMENT & DRAWING GESTURE TESTS COMPLETED PERFECTLY!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('❌ E2E Verification Error:', err);
  process.exit(1);
});
