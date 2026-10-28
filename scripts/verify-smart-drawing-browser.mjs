import { chromium } from 'playwright';
import assert from 'assert';

async function main() {
  console.log('--- Testing Smart Drawing Basic Shapes in Browser ---');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:5175');
  await page.waitForFunction(() => typeof window.eng?.setCamera === 'function');

  // Reset board
  await page.evaluate(() => {
    if (window.eng.yMap) {
      window.eng.doc?.transact(() => {
        for (const key of Array.from(window.eng.yMap.keys())) {
          window.eng.yMap.delete(key);
        }
      });
    }
    window.eng.shapes.clear();
    window.eng.rtree.clear();
    window.eng.setCamera(0, 0, 1.0);
    window.eng.setTool('pen');
    window.eng.setPenMode('smart');
  });
  await page.waitForTimeout(500);

  const initialIds = await page.evaluate(() => Array.from(window.eng.shapes.keys()));

  const canvas = page.locator('canvas.canvas-workspace, .canvas-workspace canvas');
  const box = await canvas.boundingBox();
  assert(box, 'Canvas bounding box must be available');

  // Helper to draw a path with mouse
  async function drawStroke(points) {
    const first = points[0];
    await page.mouse.move(box.x + first[0], box.y + first[1]);
    await page.mouse.down();
    await page.waitForTimeout(20);

    for (let i = 1; i < points.length; i++) {
      const pt = points[i];
      await page.mouse.move(box.x + pt[0], box.y + pt[1]);
      await page.waitForTimeout(16);
    }

    await page.mouse.up();
    await page.waitForTimeout(100);
  }

  // 1. Draw Circle (center: 150, 150, radius: 45)
  console.log('Drawing Circle...');
  const circlePts = [];
  for (let i = 0; i <= 36; i++) {
    const a = (i / 35) * Math.PI * 2;
    circlePts.push([150 + 45 * Math.cos(a), 150 + 45 * Math.sin(a)]);
  }
  await drawStroke(circlePts);

  // 2. Draw Sharp Rectangle (x: 250, y: 100, w: 90, h: 60)
  console.log('Drawing Sharp Rectangle...');
  const rectCorners = [[250, 100], [340, 100], [340, 160], [250, 160], [252, 98]];
  const rectPts = [];
  for (let i = 0; i < rectCorners.length - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      rectPts.push([
        rectCorners[i][0] + (rectCorners[i+1][0] - rectCorners[i][0]) * t,
        rectCorners[i][1] + (rectCorners[i+1][1] - rectCorners[i][1]) * t,
      ]);
    }
  }
  await drawStroke(rectPts);

  // 2b. Draw Rounded Rectangle (x: 250, y: 200, w: 90, h: 60 with curved corners)
  console.log('Drawing Rounded Rectangle...');
  const rx = 12, ry = 12, rw = 90, rh = 60, rx0 = 250, ry0 = 200;
  const roundedRectPts = [];
  for (let deg = 180; deg <= 270; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    roundedRectPts.push([rx0 + rx + rx * Math.cos(rad), ry0 + ry + ry * Math.sin(rad)]);
  }
  roundedRectPts.push([rx0 + rw - rx, ry0]);
  for (let deg = 270; deg <= 360; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    roundedRectPts.push([rx0 + rw - rx + rx * Math.cos(rad), ry0 + ry + ry * Math.sin(rad)]);
  }
  roundedRectPts.push([rx0 + rw, ry0 + rh - ry]);
  for (let deg = 0; deg <= 90; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    roundedRectPts.push([rx0 + rw - rx + rx * Math.cos(rad), ry0 + rh - ry + ry * Math.sin(rad)]);
  }
  roundedRectPts.push([rx0 + rx, ry0 + rh]);
  for (let deg = 90; deg <= 180; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    roundedRectPts.push([rx0 + rx + rx * Math.cos(rad), ry0 + rh - ry + ry * Math.sin(rad)]);
  }
  roundedRectPts.push(roundedRectPts[0]);
  await drawStroke(roundedRectPts);

  // 3. Draw Triangle (top: 450, 100; right: 500, 170; left: 400, 170)
  console.log('Drawing Triangle...');
  const triCorners = [[450, 100], [500, 170], [400, 170], [452, 102]];
  const triPts = [];
  for (let i = 0; i < triCorners.length - 1; i++) {
    for (let s = 0; s < 10; s++) {
      const t = s / 10;
      triPts.push([
        triCorners[i][0] + (triCorners[i+1][0] - triCorners[i][0]) * t,
        triCorners[i][1] + (triCorners[i+1][1] - triCorners[i][1]) * t,
      ]);
    }
  }
  await drawStroke(triPts);

  // 3b. Draw Heart (cx: 450, cy: 230, scale: 30)
  console.log('Drawing Heart...');
  const heartPts = [];
  for (let s = 0; s <= 36; s++) {
    const t = (s / 36) * Math.PI * 2;
    const x = 450 + 30 * Math.pow(Math.sin(t), 3);
    const y = 230 - (26 * Math.cos(t) - 10 * Math.cos(2 * t) - 4 * Math.cos(3 * t) - 2 * Math.cos(4 * t));
    heartPts.push([x, y]);
  }
  await drawStroke(heartPts);

  // 4. Draw Diamond (cx: 600, cy: 140, w: 80, h: 80)
  console.log('Drawing Diamond...');
  const diamCorners = [[600, 100], [640, 140], [600, 180], [560, 140], [602, 102]];
  const diamPts = [];
  for (let i = 0; i < diamCorners.length - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      diamPts.push([
        diamCorners[i][0] + (diamCorners[i+1][0] - diamCorners[i][0]) * t,
        diamCorners[i][1] + (diamCorners[i+1][1] - diamCorners[i][1]) * t,
      ]);
    }
  }
  await drawStroke(diamPts);

  // 5. Draw Straight Line (from 150, 300 to 280, 300)
  console.log('Drawing Line...');
  const linePts = [];
  for (let s = 0; s <= 15; s++) {
    const t = s / 15;
    linePts.push([150 + 130 * t, 300]);
  }
  await drawStroke(linePts);

  // 6. Draw Arrow (shaft 350, 300 to 480, 300; barb back to 460, 285)
  console.log('Drawing Arrow...');
  const arrowPts = [];
  for (let s = 0; s <= 20; s++) {
    const t = s / 20;
    arrowPts.push([350 + 130 * t, 300]);
  }
  for (let s = 1; s <= 6; s++) {
    const t = s / 6;
    arrowPts.push([480 - 20 * t, 300 - 15 * t]);
  }
  await drawStroke(arrowPts);

  // 7. Draw Star (cx: 600, cy: 300, r: 40)
  console.log('Drawing Star...');
  const starOrder = [0, 2, 4, 1, 3, 0];
  const starVertices = starOrder.map(idx => {
    const angle = (idx * (2 * Math.PI) / 5) - Math.PI / 2;
    return [600 + 40 * Math.cos(angle), 300 + 40 * Math.sin(angle)];
  });
  const starPts = [];
  for (let i = 0; i < starVertices.length - 1; i++) {
    for (let s = 0; s < 6; s++) {
      const t = s / 6;
      starPts.push([
        starVertices[i][0] + (starVertices[i+1][0] - starVertices[i][0]) * t,
        starVertices[i][1] + (starVertices[i+1][1] - starVertices[i][1]) * t,
      ]);
    }
  }
  await drawStroke(starPts);

  // 8. Draw an elongated quadrilateral / wide rectangle (150, 380, w: 120, h: 50)
  console.log('Drawing Wide Rectangle...');
  const wideRectCorners = [[150, 370], [270, 370], [270, 420], [150, 420], [152, 368]];
  const wideRectPts = [];
  for (let i = 0; i < wideRectCorners.length - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      wideRectPts.push([
        wideRectCorners[i][0] + (wideRectCorners[i+1][0] - wideRectCorners[i][0]) * t,
        wideRectCorners[i][1] + (wideRectCorners[i+1][1] - wideRectCorners[i][1]) * t,
      ]);
    }
  }
  await drawStroke(wideRectPts);

  // 9. Draw Parallelogram (slanted quadrilateral)
  console.log('Drawing Parallelogram...');
  const pgramCorners = [[360, 370], [450, 370], [430, 430], [340, 430], [362, 368]];
  const pgramPts = [];
  for (let i = 0; i < pgramCorners.length - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      pgramPts.push([
        pgramCorners[i][0] + (pgramCorners[i+1][0] - pgramCorners[i][0]) * t,
        pgramCorners[i][1] + (pgramCorners[i+1][1] - pgramCorners[i][1]) * t,
      ]);
    }
  }
  await drawStroke(pgramPts);

  // 10. Draw Trapezoid (parallel top and bottom, tapered sides)
  console.log('Drawing Trapezoid...');
  const trapCorners = [[510, 370], [580, 370], [605, 430], [485, 430], [512, 368]];
  const trapPts = [];
  for (let i = 0; i < trapCorners.length - 1; i++) {
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      trapPts.push([
        trapCorners[i][0] + (trapCorners[i+1][0] - trapCorners[i][0]) * t,
        trapCorners[i][1] + (trapCorners[i+1][1] - trapCorners[i][1]) * t,
      ]);
    }
  }
  await drawStroke(trapPts);

  await page.waitForTimeout(300);

  // Inspect newly created shapes on canvas
  const shapeTypes = await page.evaluate((init) => {
    const initSet = new Set(init);
    const list = Array.from(window.eng.shapes.values()).filter(s => !initSet.has(s.id));
    return list.map(s => ({
      id: s.id,
      type: s.type,
      shapeId: s.shapeId,
      cornerRadius: s.cornerRadius,
      w: s.w ?? s.width,
      h: s.h ?? s.height,
      x: s.x ?? s.x1,
      y: s.y ?? s.y1,
    }));
  }, initialIds);

  console.log('\nShapes detected on Canvas:', JSON.stringify(shapeTypes, null, 2));

  // Take screenshot for visual verification
  const screenshotPath = 'reports/smart-drawing-basic-shapes.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to ${screenshotPath}`);

  // Also copy screenshot to artifact dir
  const artifactPath = 'C:/Users/ADMIN/.gemini/antigravity/brain/233ea1a9-60cb-4a73-b1ba-e544e8a1c43a/smart-drawing-basic-shapes.png';
  try {
    await page.screenshot({ path: artifactPath });
    console.log(`Artifact screenshot saved to ${artifactPath}`);
  } catch (e) {
    console.warn('Failed to save to artifact path:', e.message);
  }

  // Verify each shape type is present
  const types = shapeTypes.map(s => s.type);
  assert(types.includes('ellipse'), 'Must recognize circle as ellipse');
  assert(types.includes('rect'), 'Must recognize rect');
  assert(!types.includes('rounded-rect'), 'Must NEVER produce rounded-rect (all rects are sharp)');
  assert(shapeTypes.some(s => s.type === 'diagram' && s.shapeId === 'basic.heart'), 'Must recognize heart');
  assert(types.includes('triangle'), 'Must recognize triangle');
  assert(types.includes('diamond'), 'Must recognize diamond');
  assert(types.includes('line'), 'Must recognize line');
  assert(types.includes('arrow'), 'Must recognize arrow');
  assert(types.includes('star'), 'Must recognize star');
  assert(types.includes('parallelogram'), 'Must recognize parallelogram');
  assert(types.includes('trapezoid'), 'Must recognize trapezoid');

  // Verify circle is strictly 1:1 round (w === h)
  const circles = shapeTypes.filter(s => s.type === 'ellipse');
  assert(circles.length >= 1, 'Must have at least 1 circle');
  for (const c of circles) {
    assert(Math.abs(c.w - c.h) < 0.01, `Circle must be perfectly 1:1 round ("hình tròn chịa"): got ${c.w}x${c.h}`);
  }

  console.log('\n--- ALL BASIC SHAPES (RECT, TRUE 1:1 CIRCLE, HEART, TRIANGLE, DIAMOND, PARALLELOGRAM, TRAPEZOID, LINE, ARROW, STAR) VERIFIED ON CANVAS IN BROWSER! ---');
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

