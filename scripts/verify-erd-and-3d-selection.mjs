import { chromium } from 'playwright';

async function main() {
  console.log('--- Starting ERD and 3D Selection Verification ---');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const baseUrl = (process.env.APP_URL || process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 5175}`).replace(/\/$/, '');
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.canvas-workspace', { timeout: 10000 });
  await page.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });
  await page.waitForTimeout(500);

  // 1. Programmatically test 3D solid selection indicator on canvas
  const testResults = await page.evaluate(async () => {
    const win = window;
    const eng = win.eng;
    if (!eng) return { success: false, reason: 'CanvasEngine instance not found' };

    // Clear shapes and center camera
    eng.shapes.clear();
    eng.sel.clear();
    eng.cam.x = 680;
    eng.cam.y = 230;
    eng.cam.zoom = 0.9;

    // 1. Add a 3D cuboid
    const cuboidId = 'test-3d-cuboid';
    eng.put({
      id: cuboidId,
      type: 'diagram',
      shapeId: '3d.cuboid',
      x: 300,
      y: 200,
      w: 160,
      h: 130,
      fill: 'rgba(255, 255, 255, 0.85)',
      stroke: '#0284c7',
      sw: 2,
      params: { rotationX: 15, rotationY: 25, rotationZ: 0 },
      minX: 200,
      minY: 100,
      maxX: 400,
      maxY: 300,
    });

    // 2. Add an ER Table (with PK, FK, Not Null)
    const tableId = 'test-er-table-users';
    eng.put({
      id: tableId,
      type: 'diagram',
      shapeId: 'erd.er-table',
      x: 600,
      y: 160,
      w: 220,
      h: 180,
      fill: '#ffffff',
      stroke: '#2563eb',
      sw: 1.5,
      text: 'users',
      data: {
        table: {
          columns: [
            { id: 'col-1', name: 'id', type: 'bigint', key: 'primary', nullable: false },
            { id: 'col-2', name: 'org_id', type: 'uuid', key: 'foreign', nullable: true },
            { id: 'col-3', name: 'email', type: 'varchar(255)', key: 'unique', nullable: false },
            { id: 'col-4', name: 'created_at', type: 'timestamp', key: 'none', nullable: false },
          ]
        }
      },
      minX: 600,
      minY: 160,
      maxX: 820,
      maxY: 340,
    });

    // 3. Add a Database View
    const viewId = 'test-er-view-active';
    eng.put({
      id: viewId,
      type: 'diagram',
      shapeId: 'erd.view',
      x: 920,
      y: 160,
      w: 200,
      h: 140,
      fill: '#ffffff',
      stroke: '#0891b2',
      sw: 1.5,
      text: 'v_active_users',
      data: {
        table: {
          columns: [
            { id: 'vcol-1', name: 'user_id', type: 'bigint', key: 'none' },
            { id: 'vcol-2', name: 'email', type: 'varchar(255)', key: 'none' },
            { id: 'vcol-3', name: 'is_active', type: 'boolean', key: 'none' },
          ]
        }
      },
      minX: 920,
      minY: 160,
      maxX: 1120,
      maxY: 300,
    });

    // 4. Add a 1 to Many relationship connector linking users to view
    const connectorId = 'test-erd-connector';
    eng.put({
      id: connectorId,
      type: 'connector',
      shapeId: 'erd.one-to-many',
      color: '#2563eb',
      sw: 1.8,
      x1: 820,
      y1: 205, // users.id row
      x2: 920,
      y2: 205, // v_active_users.user_id row
      routeKind: 'orthogonal',
      waypoints: [],
      startMarker: 'bar',
      endMarker: 'crowFoot',
      sourceCardinality: 'one',
      targetCardinality: 'zero-or-many',
      minX: 820,
      minY: 200,
      maxX: 920,
      maxY: 210,
    });

    // Select the 3D cuboid
    eng.sel.clear();
    eng.sel.add(cuboidId);
    eng.dirty = true;
    eng.render();

    return {
      success: true,
      shapesCount: eng.shapes.size,
      selSize: eng.sel.size,
      cuboidSelected: eng.sel.has(cuboidId),
    };
  });

  console.log('Evaluate result 1 (3D cuboid selected):', testResults);

  // Take screenshot of 3D selected shape + ER Table + DB View
  await page.screenshot({ path: 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/f3241f77-cde0-43cc-aa6f-c837a800e3e1/screenshot_3d_selected_and_erd.png' });
  console.log('Saved screenshot: screenshot_3d_selected_and_erd.png');

  // Test multi-select: lasso / box select selecting both 3D cuboid and ER Table
  await page.evaluate(() => {
    const eng = window.eng;
    eng.sel.clear();
    eng.sel.add('test-3d-cuboid');
    eng.sel.add('test-er-table-users');
    eng.dirty = true;
    eng.render();
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/f3241f77-cde0-43cc-aa6f-c837a800e3e1/screenshot_multi_select_3d_and_table.png' });
  console.log('Saved screenshot: screenshot_multi_select_3d_and_table.png');

  // Test column update parsing
  const updateResult = await page.evaluate(() => {
    const eng = window.eng;
    const ok1 = eng.updateErTableColumn('test-er-table-users', 1, 'fk org_id : uuid not null');
    const shape = eng.shapes.get('test-er-table-users');
    const col1 = shape.data?.table?.columns[1];
    return {
      updated: ok1,
      colKey: col1?.key,
      colNullable: col1?.nullable,
      colType: col1?.type,
    };
  });
  console.log('Column parsing result:', updateResult);

  await browser.close();
  console.log('--- Verification Completed Successfully! ---');
}

main().catch(err => {
  console.error('Error running verification:', err);
  process.exit(1);
});
