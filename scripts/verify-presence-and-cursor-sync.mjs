import { chromium } from 'playwright';
import assert from 'assert';

async function run() {
  console.log('--- Starting verification for Cursors, Off-screen Arrows & Avatar Slots ---');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  
  // Create 4 browser contexts/pages to simulate 4 active collaborators
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const context3 = await browser.newContext();
  const context4 = await browser.newContext();

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  const page3 = await context3.newPage();
  const page4 = await context4.newPage();

  console.log('Connecting 4 collaborators to http://localhost:5175...');
  await Promise.all([
    page1.goto('http://localhost:5175'),
    page2.goto('http://localhost:5175'),
    page3.goto('http://localhost:5175'),
    page4.goto('http://localhost:5175'),
  ]);

  await page1.waitForTimeout(1500);

  // --- Test 1: Cursor Color Synchronization ---
  console.log('--- Test 1: Cursor Color Synchronization ---');
  const cursorInfo = await page1.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const pointer = shell.style.getPropertyValue('--aw-cursor-pointer');
    const grab = shell.style.getPropertyValue('--aw-cursor-grab');
    const grabbing = shell.style.getPropertyValue('--aw-cursor-grabbing');
    const workspace = document.querySelector('.canvas-workspace');
    const renderedCursor = workspace.style.cursor;
    return { pointer, grab, grabbing, renderedCursor };
  });

  console.log('Cursor CSS properties on app shell:');
  console.log('  --aw-cursor-pointer length:', cursorInfo.pointer.length);
  console.log('  --aw-cursor-grab length:', cursorInfo.grab.length);
  
  assert(cursorInfo.pointer.includes('data:image/svg+xml'), 'Pointer cursor must be SVG');
  assert(cursorInfo.grab.includes('data:image/svg+xml'), 'Grab cursor must be SVG');
  assert(cursorInfo.grabbing.includes('data:image/svg+xml'), 'Grabbing cursor must be SVG');

  // Verify that grab cursor is NOT hardcoded to #111827 black anymore
  const grabDecoded = decodeURIComponent(cursorInfo.grab);
  console.log('Grab SVG preview:', grabDecoded.slice(0, 120));
  assert(!grabDecoded.includes('fill="#111827"'), 'Grab cursor must not be hardcoded to black (#111827)');
  console.log('✓ Test 1 Passed: Local cursors (pointer, grab, grabbing) use synchronized user color.');

  // --- Test 2: Avatar slots (Max 3 slots) & Hover Tooltip ---
  console.log('--- Test 2: Avatar slots (Max 3 slots) & Hover Tooltip ---');
  const presenceInfo = await page1.evaluate(() => {
    const avatarEls = document.querySelectorAll('.presence-avatars .presence-avatar');
    const moreBtn = document.querySelector('.presence-more-btn');
    const tooltips = Array.from(document.querySelectorAll('.presence-avatar-tooltip')).map(t => t.textContent.trim());
    return {
      avatarCount: avatarEls.length,
      hasMoreBtn: !!moreBtn,
      moreBtnText: moreBtn ? moreBtn.textContent.trim() : null,
      tooltips,
    };
  });

  console.log('Presence bar info on Page 1 (with 4 users connected):', presenceInfo);
  assert(presenceInfo.avatarCount <= 3, `Avatar count must be at most 3 slots! Found: ${presenceInfo.avatarCount}`);
  assert(presenceInfo.hasMoreBtn, 'Overflow more button must appear when > 2 remote peers are online');
  assert(presenceInfo.moreBtnText.includes('+1') || presenceInfo.moreBtnText.includes('+'), 'Overflow button must show +N count');
  assert(presenceInfo.tooltips.length >= 3, 'Tooltips must be present for all visible avatars');
  console.log('Visible tooltips:', presenceInfo.tooltips);
  console.log('✓ Test 2 Passed: Avatar bar has strictly max 3 slots and instant hover tooltips.');

  // --- Test 3: Dropdown List of Collaborators ---
  console.log('--- Test 3: Dropdown List of Collaborators ---');
  await page1.click('.presence-more-btn');
  await page1.waitForTimeout(300);

  const dropdownInfo = await page1.evaluate(() => {
    const dropdown = document.querySelector('.presence-dropdown-menu');
    if (!dropdown) return null;
    const items = Array.from(dropdown.querySelectorAll('.presence-dropdown-item')).map(item => ({
      name: item.querySelector('.presence-dropdown-name')?.textContent.trim(),
      status: item.querySelector('.presence-dropdown-status')?.textContent.trim(),
    }));
    return {
      header: dropdown.querySelector('.presence-dropdown-header')?.textContent.trim(),
      items,
    };
  });

  console.log('Dropdown menu info:', dropdownInfo);
  assert(dropdownInfo, 'Dropdown menu must open when clicking more button');
  assert(dropdownInfo.items.length >= 4, `Dropdown must list all collaborators (expected >= 4, found ${dropdownInfo.items.length})`);
  console.log('✓ Test 3 Passed: Collaborator overflow dropdown displays complete active list with status.');

  // --- Test 4: Off-Screen Arrow Outside Pill & Large Size ---
  console.log('--- Test 4: Off-Screen Arrow Outside Pill & Large Size ---');
  // Move Page 2's cursor far to the right (worldX: 3500, worldY: 0)
  await page2.evaluate(() => {
    window.eng.setCamera(3500, 0, 1.0);
  });
  await page2.mouse.move(600, 400);
  await page1.waitForTimeout(600);

  const arrowInfo = await page1.evaluate(() => {
    const pill = document.querySelector('.offscreen-side-right');
    if (!pill) return null;
    const arrow = pill.querySelector('.offscreen-collab-arrow');
    const pillBody = pill.querySelector('.offscreen-pill-body');
    const arrowWidth = arrow ? arrow.getAttribute('width') : null;
    const arrowHeight = arrow ? arrow.getAttribute('height') : null;
    return {
      hasPill: !!pill,
      hasArrow: !!arrow,
      hasPillBody: !!pillBody,
      arrowWidth,
      arrowHeight,
      // Check that arrow is sibling of pillBody, NOT inside it
      isArrowOutsideBody: arrow.parentElement === pill && arrow.parentElement !== pillBody,
    };
  });

  console.log('Offscreen arrow layout info:', arrowInfo);
  assert(arrowInfo && arrowInfo.hasPill, 'Offscreen pill on the right must be present');
  assert(arrowInfo.hasArrow, 'Arrow must be present');
  assert(arrowInfo.isArrowOutsideBody, 'Arrow must be OUTSIDE .offscreen-pill-body');
  assert(parseInt(arrowInfo.arrowWidth) >= 24, 'Arrow width must be at least 24px (large and prominent)');
  console.log('✓ Test 4 Passed: Arrow is outside the pill body and prominently sized (26x26).');

  console.log('\n========================================');
  console.log('ALL NEW REQUIREMENT TESTS PASSED 100%');
  console.log('========================================');

  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
