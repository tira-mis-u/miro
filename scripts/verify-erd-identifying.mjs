import { chromium } from 'playwright';

async function main() {
  console.log('--- Starting ERD Identifying Relationship Verification ---');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const baseUrl = (process.env.APP_URL || process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 5175}`).replace(/\/$/, '');
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.canvas-workspace', { timeout: 10000 });
  await page.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });
  await page.waitForTimeout(500);

  const testResults = await page.evaluate(async () => {
    const win = window;
    const eng = win.eng;
    if (!eng) return { success: false, reason: 'CanvasEngine instance not found' };

    // Clear and center camera
    eng.shapes.clear();
    eng.sel.clear();
    eng.cam.x = 650;
    eng.cam.y = 260;
    eng.cam.zoom = 1.0;

    // 1. Weak Entity (double rectangle)
    eng.put({
      id: 'test-weak-entity',
      type: 'diagram',
      shapeId: 'erd.weak-entity',
      x: 200,
      y: 200,
      w: 130,
      h: 80,
      fill: '#ffffff',
      stroke: '#2563eb',
      sw: 1.5,
      text: 'Order_Item',
      params: { doubleBorder: true },
    });

    // 2. Identifying Relationship (Chen double diamond)
    eng.put({
      id: 'test-identifying-rel',
      type: 'diagram',
      shapeId: 'erd.identifying-relationship',
      x: 420,
      y: 195,
      w: 120,
      h: 90,
      fill: '#ffffff',
      stroke: '#2563eb',
      sw: 1.5,
      text: 'identifies',
      params: { doubleBorder: true },
    });

    // 3. Strong Entity (rectangle)
    eng.put({
      id: 'test-strong-entity',
      type: 'diagram',
      shapeId: 'erd.entity',
      x: 630,
      y: 200,
      w: 130,
      h: 80,
      fill: '#ffffff',
      stroke: '#2563eb',
      sw: 1.5,
      text: 'Orders',
    });

    // 4. ER Table with PK, PK,FK, FK, UK columns
    eng.put({
      id: 'test-table-schema',
      type: 'diagram',
      shapeId: 'erd.er-table',
      x: 840,
      y: 150,
      w: 240,
      h: 210,
      fill: '#ffffff',
      stroke: '#0f172a',
      sw: 1.5,
      text: 'order_items',
      data: {
        table: {
          columns: [
            { id: 'c1', name: 'order_id', type: 'bigint', key: 'primary_foreign', nullable: false },
            { id: 'c2', name: 'item_no', type: 'integer', key: 'primary', nullable: false },
            { id: 'c3', name: 'sku_code', type: 'varchar(64)', key: 'unique', nullable: false },
            { id: 'c4', name: 'product_id', type: 'bigint', key: 'foreign', nullable: true },
            { id: 'c5', name: 'quantity', type: 'integer', key: 'none', nullable: false },
          ]
        }
      }
    });

    // 5. Connect weak entity to identifying relationship with ER Line
    eng.put({
      id: 'conn-weak-to-rel',
      type: 'connector',
      shapeId: 'erd.line',
      x1: 330,
      y1: 240,
      x2: 420,
      y2: 240,
      sw: 1.5,
      color: '#334155',
      routeKind: 'straight',
      lineStyle: 'solid',
      startMarker: 'none',
      endMarker: 'none',
      sourceId: 'test-weak-entity',
      targetId: 'test-identifying-rel',
      sourcePointId: 'right',
      targetPointId: 'left',
    });

    // 6. Connect identifying relationship to strong entity
    eng.put({
      id: 'conn-rel-to-strong',
      type: 'connector',
      shapeId: 'erd.line',
      x1: 540,
      y1: 240,
      x2: 630,
      y2: 240,
      sw: 1.5,
      color: '#334155',
      routeKind: 'straight',
      lineStyle: 'solid',
      startMarker: 'none',
      endMarker: 'none',
      sourceId: 'test-identifying-rel',
      targetId: 'test-strong-entity',
      sourcePointId: 'right',
      targetPointId: 'left',
    });

    // Select the identifying relationship to verify selection visuals
    eng.sel.add('test-identifying-rel');
    eng.render();

    return {
      success: true,
      shapesCount: eng.shapes.size,
    };
  });

  console.log('Test results:', testResults);

  // Select and double-click the identifying relationship to test inline editing
  const canvasEl = page.locator('.canvas-workspace');
  const box = await canvasEl.boundingBox();
  if (box) {
    // Coordinates corresponding to center of identifying relationship: world (480, 240) -> client
    const clickCoords = await page.evaluate(() => {
      const eng = window.eng;
      return eng.worldToClient(480, 240);
    });
    await page.mouse.dblclick(clickCoords.x, clickCoords.y);
    await page.waitForTimeout(300);
  }

  // Take screenshot with active text editor
  const screenshotPath = 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/f3241f77-cde0-43cc-aa6f-c837a800e3e1/screenshot_erd_identifying_verified.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Saved screenshot to:', screenshotPath);

  await browser.close();
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
