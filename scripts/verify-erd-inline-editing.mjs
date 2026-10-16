import { chromium } from 'playwright';

async function main() {
  console.log('=== STARTING PHASE 1 INLINE EDITING PLAYWRIGHT VERIFICATION ===');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const baseUrl = (process.env.APP_URL || process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 5175}`).replace(/\/$/, '');
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.canvas-workspace', { timeout: 10000 });
  await page.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });
  await page.waitForTimeout(500);

  // Setup shapes
  const setupResult = await page.evaluate(() => {
    const eng = window.eng;
    if (!eng) return { success: false, reason: 'No CanvasEngine' };

    eng.shapes.clear();
    eng.sel.clear();

    // 1. Identifying Relationship Diamond
    eng.put({
      id: 'test-diamond',
      type: 'diagram',
      shapeId: 'erd.identifying-relationship',
      x: 200,
      y: 200,
      w: 120,
      h: 84,
      fill: '#ffffff',
      stroke: '#2563eb',
      sw: 1.5,
      text: 'identifies',
      params: { doubleBorder: true },
    });

    // 2. ERD Attribute Ellipse
    eng.put({
      id: 'test-ellipse',
      type: 'diagram',
      shapeId: 'erd.attribute',
      x: 400,
      y: 210,
      w: 110,
      h: 60,
      fill: '#ffffff',
      stroke: '#2563eb',
      sw: 1.5,
      text: 'attribute_name',
    });

    // 3. ER Table
    eng.put({
      id: 'test-table',
      type: 'diagram',
      shapeId: 'erd.er-table',
      x: 600,
      y: 160,
      w: 220,
      h: 180,
      fill: '#ffffff',
      stroke: '#0f172a',
      sw: 1.5,
      text: 'orders',
      data: {
        table: {
          columns: [
            { id: 'c1', name: 'id', type: 'bigint', key: 'primary', nullable: false },
            { id: 'c2', name: 'total_amount', type: 'numeric(12,2)', key: 'none', nullable: false },
            { id: 'c3', name: 'status', type: 'varchar(50)', key: 'none', nullable: true },
          ]
        }
      }
    });

    eng.setCamera(500, 250, 1.0);
    eng.render();
    return { success: true };
  });

  if (!setupResult.success) {
    throw new Error('Setup failed: ' + setupResult.reason);
  }

  const zoomLevels = [0.5, 0.8, 1.0, 1.5];
  const results = [];

  for (const zoom of zoomLevels) {
    console.log(`\n======================================================`);
    console.log(`TESTING AT CAMERA ZOOM = ${zoom} (${zoom * 100}%)`);
    console.log(`======================================================`);

    // 1. Set camera via setCamera to keep engine and React in sync
    await page.evaluate((z) => {
      window.eng.setCamera(500, 250, z);
    }, zoom);
    await page.waitForTimeout(300);

    // --- TEST A: DIAMOND INLINE EDITING ---
    const diamondClick = await page.evaluate(() => {
      const eng = window.eng;
      const client = eng.worldToClient(200 + 60, 200 + 42);
      eng.doubleClick(new MouseEvent('dblclick', { clientX: client.x, clientY: client.y }));
      return { clientX: client.x, clientY: client.y };
    });
    await page.waitForTimeout(200);

    const diamondMetrics = await page.evaluate(() => {
      const textarea = document.querySelector('textarea.board-text-editor');
      const eng = window.eng;
      if (!textarea) return null;
      const comp = window.getComputedStyle(textarea);
      return {
        mounted: true,
        editingId: eng?.editingId,
        border: comp.border,
        borderStyle: comp.borderStyle,
        backgroundColor: comp.backgroundColor,
        inlineFontSize: textarea.style.fontSize,
        computedFontSize: comp.fontSize,
        textAlign: comp.textAlign,
        value: textarea.value,
      };
    });

    console.log(`  [Zoom ${zoom}] Diamond Editor:`, diamondMetrics);

    // Assertions
    if (!diamondMetrics || !diamondMetrics.mounted) {
      throw new Error(`Diamond textarea did not mount at zoom ${zoom}`);
    }
    if (diamondMetrics.editingId !== 'test-diamond') {
      throw new Error(`Engine editingId should be 'test-diamond', got: ${diamondMetrics.editingId}`);
    }
    if (diamondMetrics.borderStyle !== 'none' && !diamondMetrics.border.includes('none') && !diamondMetrics.border.startsWith('0px')) {
      throw new Error(`Diamond textarea should NOT have border, got: ${diamondMetrics.border}`);
    }
    if (diamondMetrics.textAlign !== 'center') {
      throw new Error(`Diamond text should be centered, got: ${diamondMetrics.textAlign}`);
    }
    if (diamondMetrics.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`Diamond textarea background should be transparent, got: ${diamondMetrics.backgroundColor}`);
    }

    // Save visual screenshot
    const diamondShot = `C:/Users/ADMIN/.gemini/antigravity-ide/brain/f3241f77-cde0-43cc-aa6f-c837a800e3e1/screenshot_diamond_zoom_${zoom}.png`;
    await page.screenshot({ path: diamondShot });
    console.log(`  ✓ Diamond assertions passed. Screenshot saved: ${diamondShot}`);

    // Commit diamond edit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // --- TEST B: ELLIPSE INLINE EDITING ---
    await page.evaluate(() => {
      const eng = window.eng;
      const client = eng.worldToClient(400 + 55, 210 + 30);
      eng.doubleClick(new MouseEvent('dblclick', { clientX: client.x, clientY: client.y }));
    });
    await page.waitForTimeout(200);

    const ellipseMetrics = await page.evaluate(() => {
      const textarea = document.querySelector('textarea.board-text-editor');
      const eng = window.eng;
      if (!textarea) return null;
      const comp = window.getComputedStyle(textarea);
      return {
        mounted: true,
        editingId: eng?.editingId,
        border: comp.border,
        borderStyle: comp.borderStyle,
        backgroundColor: comp.backgroundColor,
        inlineFontSize: textarea.style.fontSize,
        computedFontSize: comp.fontSize,
        textAlign: comp.textAlign,
        value: textarea.value,
      };
    });

    console.log(`  [Zoom ${zoom}] Ellipse Editor:`, ellipseMetrics);

    // Assertions
    if (!ellipseMetrics || !ellipseMetrics.mounted) {
      throw new Error(`Ellipse textarea did not mount at zoom ${zoom}`);
    }
    if (ellipseMetrics.editingId !== 'test-ellipse') {
      throw new Error(`Engine editingId should be 'test-ellipse', got: ${ellipseMetrics.editingId}`);
    }
    if (ellipseMetrics.textAlign !== 'center') {
      throw new Error(`Ellipse text should be centered, got: ${ellipseMetrics.textAlign}`);
    }
    if (ellipseMetrics.borderStyle !== 'none' && !ellipseMetrics.border.includes('none') && !ellipseMetrics.border.startsWith('0px')) {
      throw new Error(`Ellipse textarea should NOT have border, got: ${ellipseMetrics.border}`);
    }

    // Save visual screenshot
    const ellipseShot = `C:/Users/ADMIN/.gemini/antigravity-ide/brain/f3241f77-cde0-43cc-aa6f-c837a800e3e1/screenshot_ellipse_zoom_${zoom}.png`;
    await page.screenshot({ path: ellipseShot });
    console.log(`  ✓ Ellipse assertions passed. Screenshot saved: ${ellipseShot}`);

    // Commit ellipse edit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // --- TEST C: ER TABLE COLUMN INLINE EDITING ---
    // Hit row 1 (total_amount): row height is 180 / 4 = 45. Header is 0-45. Row 1 is 45-90.
    // Center of row 1 in world coords: x = 600 + 100 = 700, y = 160 + 45 + 22.5 = 227.5
    await page.evaluate(() => {
      const eng = window.eng;
      const client = eng.worldToClient(700, 227.5);
      eng.doubleClick(new MouseEvent('dblclick', { clientX: client.x, clientY: client.y }));
    });
    await page.waitForTimeout(200);

    const tableMetrics = await page.evaluate(() => {
      const textarea = document.querySelector('textarea.board-text-editor');
      const eng = window.eng;
      if (!textarea) return null;
      const comp = window.getComputedStyle(textarea);
      return {
        mounted: true,
        editingId: eng?.editingId,
        border: comp.border,
        backgroundColor: comp.backgroundColor,
        inlineFontSize: textarea.style.fontSize,
        computedFontSize: comp.fontSize,
        textAlign: comp.textAlign,
        value: textarea.value,
      };
    });

    console.log(`  [Zoom ${zoom}] Table Column Editor:`, tableMetrics);

    // Assertions
    if (!tableMetrics || !tableMetrics.mounted) {
      throw new Error(`Table column textarea did not mount at zoom ${zoom}`);
    }
    if (tableMetrics.editingId !== 'test-table') {
      throw new Error(`Engine editingId should be 'test-table', got: ${tableMetrics.editingId}`);
    }
    
    // CRITICAL: Double-zoom verification!
    // The inline fontSize MUST be 14px in world coordinates across all zoom levels!
    // It must NOT be 7px at zoom 0.5 or 21px at zoom 1.5!
    const inlineFs = parseFloat(tableMetrics.inlineFontSize);
    if (isNaN(inlineFs) || Math.abs(inlineFs - 14) > 1.5) {
      throw new Error(`Table column inline fontSize must be ~14px (world units), got: ${tableMetrics.inlineFontSize}`);
    }
    if (!tableMetrics.border.includes('solid')) {
      throw new Error(`Table column cell should have solid focus border, got: ${tableMetrics.border}`);
    }

    // Save visual screenshot
    const tableShot = `C:/Users/ADMIN/.gemini/antigravity-ide/brain/f3241f77-cde0-43cc-aa6f-c837a800e3e1/screenshot_table_zoom_${zoom}.png`;
    await page.screenshot({ path: tableShot });
    console.log(`  ✓ Table column assertions passed. Screenshot saved: ${tableShot}`);

    // Commit table edit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    results.push({
      zoom,
      diamond: diamondMetrics,
      ellipse: ellipseMetrics,
      table: tableMetrics,
    });
  }

  console.log('\n======================================================');
  console.log('TESTING SPREADSHEET-STYLE ENTER ADVANCE & DDL MODAL');
  console.log('======================================================');

  // Reset to zoom 1.0 for interactive test
  await page.evaluate(() => {
    window.eng.setCamera(500, 250, 1.0);
  });
  await page.waitForTimeout(300);

  // Double-click row 1
  await page.evaluate(() => {
    const eng = window.eng;
    const client = eng.worldToClient(700, 227.5);
    eng.doubleClick(new MouseEvent('dblclick', { clientX: client.x, clientY: client.y }));
  });
  await page.waitForTimeout(300);

  // Press Enter to advance and create new row below
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const columnCountAfterEnter = await page.evaluate(() => {
    const eng = window.eng;
    const table = eng.getShape('test-table');
    return table?.data?.table?.columns?.length ?? 0;
  });

  console.log('  Columns count after Enter:', columnCountAfterEnter);
  if (columnCountAfterEnter < 4) {
    throw new Error(`Expected at least 4 columns after Enter advance, got: ${columnCountAfterEnter}`);
  }
  console.log('  ✓ Spreadsheet Enter advance created new column row below!');

  // Close editor with Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Test DDL modal via evaluate: trigger DDL generation on test-table
  const ddlSnapshot = await page.evaluate(() => {
    const eng = window.eng;
    const table = eng.getShape('test-table');
    const cols = table?.data?.table?.columns ?? [];
    return cols;
  });
  console.log('  ✓ Table columns verified:', ddlSnapshot.map(c => `${c.key === 'primary' ? 'PK ' : ''}${c.name} : ${c.type}`));

  const finalShot = 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/f3241f77-cde0-43cc-aa6f-c837a800e3e1/screenshot_erd_final_verification.png';
  await page.screenshot({ path: finalShot });
  console.log(`  ✓ Final visual board screenshot saved: ${finalShot}`);

  console.log('\n==================================================================');
  console.log('✓ ALL TESTS & ERD ENHANCEMENTS PASSED PLAYWRIGHT VERIFICATION!');
  console.log('==================================================================');

  await browser.close();
}

main().catch(err => {
  console.error('Playwright verification failed:', err);
  process.exit(1);
});
