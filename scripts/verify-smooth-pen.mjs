import { chromium } from 'playwright';
import assert from 'assert';

async function main() {
  console.log('--- Testing Smooth Pen Stabilization & Zoom Tremor Filtering ---');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:5175');
  await page.waitForFunction(() => typeof window.eng?.setCamera === 'function');

  // Set zoom to 300% (3.0) to test pen at high zoom
  await page.evaluate(() => {
    window.eng.setCamera(0, 0, 3.0);
    window.eng.setTool('pen');
  });

  const canvas = page.locator('canvas.canvas-workspace, .canvas-workspace canvas');
  const box = await canvas.boundingBox();
  assert(box, 'Canvas bounding box must be available');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // 1. Mouse down
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(50);

  const currId = await page.evaluate(() => window.eng.currId);
  assert(currId, 'Current drawing ID must be active');

  // 2. Simulate holding pen in place with tiny 0.3px-0.5px subpixel jitter (sensor noise) 30 times
  for (let i = 0; i < 30; i++) {
    const jitterX = startX + (i % 2 === 0 ? 0.3 : -0.3);
    const jitterY = startY + (i % 2 === 0 ? 0.3 : -0.3);
    await page.mouse.move(jitterX, jitterY);
    await page.waitForTimeout(16);
  }

  // 3. Draw a smooth stroke across 100 screen pixels
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(startX + i * 5, startY + Math.sin(i * 0.5) * 10);
    await page.waitForTimeout(16);
  }

  await page.mouse.up();
  await page.waitForTimeout(200);

  // Inspect the created pen shape in engine
  const strokeInfo = await page.evaluate((id) => {
    const pen = window.eng.shapes.get(id);
    if (!pen || pen.type !== 'pen') return null;
    return {
      id: pen.id,
      pointCount: pen.pts.length,
      firstPt: pen.pts[0],
      lastPt: pen.pts[pen.pts.length - 1],
    };
  }, currId);

  console.log('Stroke info at 300% zoom:', strokeInfo);
  assert(strokeInfo, 'Pen stroke must be created');
  assert(strokeInfo.pointCount <= 25, `Stroke point count (${strokeInfo.pointCount}) must filter out subpixel jitter noise (expected <= 25, got ${strokeInfo.pointCount})`);
  assert(strokeInfo.pointCount >= 20, `Stroke point count (${strokeInfo.pointCount}) must capture real strokes`);

  console.log('✓ Smooth Pen test passed: Zoom-invariant distance threshold successfully filters tremors!');
  await browser.close();
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
