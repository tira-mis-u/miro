import { chromium } from 'playwright';
import assert from 'assert';

async function run() {
  console.log('--- Starting verification for Real Arrow, Authentic Hand Cursor & Share Roles ---');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:5175');
  await page.waitForTimeout(1000);

  // --- Test 1: Authentic Hand Cursor ---
  console.log('--- Test 1: Authentic Hand Cursor ---');
  const handCursors = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const grab = shell.style.getPropertyValue('--aw-cursor-grab');
    const grabbing = shell.style.getPropertyValue('--aw-cursor-grabbing');
    return { grab, grabbing };
  });

  const grabDecoded = decodeURIComponent(handCursors.grab);
  const grabbingDecoded = decodeURIComponent(handCursors.grabbing);
  console.log('Grab SVG decoded snippet:', grabDecoded.slice(0, 150));
  
  // Verify it contains the new proportional finger curves and no broken v5-7 artifacts
  assert(!grabDecoded.includes('v5-7'), 'Old broken grabPath artifact v5-7 must be removed');
  assert(grabDecoded.includes('M9 21'), 'New authentic hand path M9 21 must be present');
  assert(grabbingDecoded.includes('M9 20.5'), 'New authentic grabbing fist path must be present');
  console.log('✓ Test 1 Passed: Authentic hand cursor paths (grab & grabbing) verified with natural finger anatomy.');

  // --- Test 2: Share Modal Permission Dropdown ---
  console.log('--- Test 2: Share Modal Permission Dropdown ---');
  // Open Share modal
  await page.click('.header-action-share');
  await page.waitForSelector('.share-modal-card', { timeout: 3000 });

  // Check default permission
  const defaultPillText = await page.textContent('.share-permission-pill');
  console.log('Default permission pill text:', defaultPillText.trim());
  assert(defaultPillText.includes('Can edit'), 'Default permission must be "Can edit"');

  // Click permission pill to open dropdown
  await page.click('.share-permission-pill');
  await page.waitForSelector('.share-permission-dropdown', { timeout: 2000 });

  const optionLabels = await page.$$eval('.share-permission-option-label', els => els.map(e => e.textContent.trim()));
  console.log('Available permission options:', optionLabels);
  assert(optionLabels.includes('Can edit'), 'Must have "Can edit"');
  assert(optionLabels.includes('Can comment'), 'Must have "Can comment"');
  assert(optionLabels.includes('Can view'), 'Must have "Can view"');

  // Select "Can view"
  const viewOption = (await page.$$('.share-permission-option'))[2];
  await viewOption.click();
  await page.waitForTimeout(200);

  // Check updated pill text and link input
  const updatedPillText = await page.textContent('.share-permission-pill');
  console.log('Updated permission pill text:', updatedPillText.trim());
  assert(updatedPillText.includes('Can view'), 'Pill text must be updated to "Can view"');

  const linkVal = await page.inputValue('.share-link-input');
  console.log('Generated share link with role:', linkVal);
  assert(linkVal.includes('&role=view'), 'Share link must include &role=view parameter');

  // Verify description updated
  const descText = await page.textContent('.share-access-desc');
  console.log('Updated access description:', descText.trim());
  assert(descText.includes('view only'), 'Access description must update to view only');

  // Close share modal
  await page.click('.share-done-button');
  await page.waitForTimeout(300);
  console.log('✓ Test 2 Passed: Share Modal permission dropdown allows selecting "Can edit", "Can comment", "Can view" and updates link seamlessly.');

  // --- Test 3: Real Arrow Shape for Off-Screen Indicator ---
  console.log('--- Test 3: Real Arrow Shape for Off-Screen Indicator ---');
  // Launch page 2 to trigger off-screen indicator on page 1
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.goto('http://localhost:5175');
  await page2.waitForTimeout(1000);

  // Move page 2 far to the right
  await page2.evaluate(() => {
    window.eng.setCamera(3500, 0, 1.0);
  });
  await page2.mouse.move(600, 400);
  await page.waitForTimeout(700);

  const arrowDetails = await page.evaluate(() => {
    const pill = document.querySelector('.offscreen-side-right');
    if (!pill) return null;
    const arrow = pill.querySelector('.offscreen-collab-arrow');
    if (!arrow) return null;
    const paths = Array.from(arrow.querySelectorAll('path')).map(p => p.getAttribute('d'));
    const width = arrow.getAttribute('width');
    const height = arrow.getAttribute('height');
    return { width, height, paths };
  });

  console.log('Arrow details on off-screen indicator:', arrowDetails);
  assert(arrowDetails, 'Offscreen arrow must exist');
  assert(parseInt(arrowDetails.width) >= 32, `Arrow width must be at least 32px (found: ${arrowDetails.width})`);
  assert(arrowDetails.paths.some(p => p.includes('M3 11h22')), 'Arrow must have a true horizontal shaft M3 11h22 (-->)');
  assert(arrowDetails.paths.some(p => p.includes('M18 4l8 7-8 7')), 'Arrow must have a distinct arrowhead M18 4l8 7-8 7');
  console.log('✓ Test 3 Passed: Off-screen indicator features a genuine, prominent arrow (-->) with shaft and head.');

  console.log('\n========================================');
  console.log('ALL VERIFICATION TESTS COMPLETED & PASSED 100%');
  console.log('========================================');

  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
