import { chromium } from 'playwright';

async function main() {
  console.log('=== STARTING REALTIME COLLABORATION PLAYWRIGHT VERIFICATION ===');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  const boardId = `collab-test-${Date.now()}`;
  const baseUrl = (process.env.APP_URL || process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 5175}`).replace(/\/$/, '');
  const boardUrl = `${baseUrl}/?board=${boardId}`;

  console.log(`Connecting to dynamic board URL: ${boardUrl}`);

  // Tab 1 (User 1)
  const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1 = await context1.newPage();
  await page1.goto(boardUrl, { waitUntil: 'networkidle' });
  await page1.waitForSelector('.canvas-workspace', { timeout: 10000 });
  await page1.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });
  await page1.waitForTimeout(600);

  // Verify Tab 1 User profile
  const user1Info = await page1.evaluate(() => {
    const avatar = document.querySelector('.header-user-avatar');
    const alone = document.querySelector('.presence-alone-label');
    return {
      title: avatar?.getAttribute('title'),
      label: avatar?.querySelector('span')?.textContent,
      aloneLabel: alone?.textContent,
    };
  });
  console.log('Tab 1 User Profile:', user1Info);
  if (!user1Info.title?.includes('Anonymous 1') || user1Info.label !== 'A1') {
    throw new Error(`Expected Tab 1 to be Anonymous 1 (A1), got: ${JSON.stringify(user1Info)}`);
  }
  console.log('✓ Tab 1 assigned Anonymous 1 with avatar A1');

  // Tab 2 (User 2)
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await context2.newPage();
  await page2.goto(boardUrl, { waitUntil: 'networkidle' });
  await page2.waitForSelector('.canvas-workspace', { timeout: 10000 });
  await page2.waitForFunction(() => Boolean(window.eng), { timeout: 10000 });
  await page2.waitForTimeout(800);

  // Wait for Tab 2 to sync awareness and resolve Anonymous 2
  await page2.waitForFunction(() => {
    const avatar = document.querySelector('.header-user-avatar');
    return avatar?.querySelector('span')?.textContent === 'A2';
  }, { timeout: 10000 });

  // Verify Tab 2 User profile
  const user2Info = await page2.evaluate(() => {
    const avatar = document.querySelector('.header-user-avatar');
    return {
      title: avatar?.getAttribute('title'),
      label: avatar?.querySelector('span')?.textContent,
    };
  });
  console.log('Tab 2 User Profile:', user2Info);
  if (!user2Info.title?.includes('Anonymous 2') || user2Info.label !== 'A2') {
    throw new Error(`Expected Tab 2 to be Anonymous 2 (A2), got: ${JSON.stringify(user2Info)}`);
  }
  console.log('✓ Tab 2 assigned Anonymous 2 with avatar A2');

  // Verify presence avatars in both headers
  await page1.waitForTimeout(400);
  const page1Presence = await page1.evaluate(() => {
    const avatars = Array.from(document.querySelectorAll('.header-presence .presence-avatar'));
    return avatars.map(el => ({
      text: el.textContent?.trim(),
      title: el.getAttribute('title'),
    }));
  });
  console.log('Tab 1 sees peers:', page1Presence);
  const foundA2OnTab1 = page1Presence.some(p => p.text === 'A2' && p.title?.includes('Anonymous 2'));
  if (!foundA2OnTab1) {
    throw new Error(`Tab 1 did not find Anonymous 2 in header presence: ${JSON.stringify(page1Presence)}`);
  }
  console.log('✓ Tab 1 sees Anonymous 2 (A2) in header presence');

  const page2Presence = await page2.evaluate(() => {
    const avatars = Array.from(document.querySelectorAll('.header-presence .presence-avatar'));
    return avatars.map(el => ({
      text: el.textContent?.trim(),
      title: el.getAttribute('title'),
    }));
  });
  console.log('Tab 2 sees peers:', page2Presence);
  const foundA1OnTab2 = page2Presence.some(p => p.text === 'A1' && p.title?.includes('Anonymous 1'));
  if (!foundA1OnTab2) {
    throw new Error(`Tab 2 did not find Anonymous 1 in header presence: ${JSON.stringify(page2Presence)}`);
  }
  console.log('✓ Tab 2 sees Anonymous 1 (A1) in header presence');

  // Test real-time cursor movement: Move mouse on page 1
  console.log('Moving cursor on Tab 1 to (450, 350)...');
  await page1.mouse.move(450, 350);
  await page1.waitForTimeout(300);

  // Check if Tab 2 renders Tab 1's cursor
  const cursorOnTab2 = await page2.evaluate(() => {
    const container = document.querySelector('.remote-cursor-container');
    const badge = document.querySelector('.remote-cursor-badge');
    const name = document.querySelector('.remote-cursor-name');
    const pointer = document.querySelector('.remote-cursor-pointer path');
    return {
      hasContainer: Boolean(container),
      transform: container ? container.style.transform : null,
      badgeText: name?.textContent,
      fillColor: pointer?.getAttribute('fill'),
    };
  });
  console.log('Tab 2 sees remote cursor:', cursorOnTab2);
  if (!cursorOnTab2.hasContainer || !cursorOnTab2.badgeText?.includes('Anonymous 1')) {
    throw new Error(`Tab 2 failed to render remote cursor for Anonymous 1: ${JSON.stringify(cursorOnTab2)}`);
  }
  console.log('✓ Tab 2 rendered remote cursor for Anonymous 1 with SVG pointer and badge');

  // Test real-time shape synchronization: Tab 1 adds an ER Table
  console.log('Tab 1 adding an ER Table shape...');
  await page1.evaluate(() => {
    const eng = window.eng;
    eng.put({
      id: 'collab-er-table-1',
      type: 'diagram',
      shapeId: 'erd.er-table',
      x: 300,
      y: 220,
      w: 180,
      h: 148,
      fill: '#ffffff',
      stroke: '#2563eb',
      sw: 1.5,
      text: 'Users',
      params: { compartments: 2, rowCount: 3 },
      data: {
        table: {
          columns: [
            { id: 'col-id', name: 'id', type: 'bigint', key: 'primary', nullable: false },
            { id: 'col-email', name: 'email', type: 'varchar(255)', key: 'unique', nullable: false },
          ],
        },
      },
    });
  });

  // Wait for sync on Tab 2
  await page2.waitForFunction(() => {
    const eng = window.eng;
    return Boolean(eng && eng.shapes.has('collab-er-table-1'));
  }, { timeout: 5000 });

  const tab2Shape = await page2.evaluate(() => {
    const shape = window.eng?.getShape('collab-er-table-1');
    return {
      id: shape?.id,
      text: shape?.text,
      columnsCount: shape?.data?.table?.columns?.length,
    };
  });
  console.log('Tab 2 received shape:', tab2Shape);
  if (tab2Shape.id !== 'collab-er-table-1' || tab2Shape.text !== 'Users') {
    throw new Error(`Tab 2 did not receive the created shape: ${JSON.stringify(tab2Shape)}`);
  }
  console.log('✓ Tab 2 received real-time shape synchronization via Yjs');

  // Take visual screenshots for proof
  await page1.screenshot({ path: 'scratch/collab_tab1_verified.png' });
  await page2.screenshot({ path: 'scratch/collab_tab2_verified.png' });
  console.log('✓ Saved visual verification screenshots to scratch/');

  await browser.close();
  console.log('=== REALTIME COLLABORATION VERIFICATION PASSED 100% ===');
}

main().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
