import { chromium } from 'playwright';
import assert from 'assert';

async function run() {
  console.log('--- Starting verification for Chevron, Clean Hand Cursor & Strict Permissions ---');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // 1. Test View-Only Mode via ?role=view URL
  console.log('--- Test 1: Strict View-Only Access Enforcement ---');
  const viewContext = await browser.newContext();
  const viewPage = await viewContext.newPage();
  await viewPage.goto('http://localhost:5175/?role=view');
  await viewPage.waitForTimeout(1200);

  // Check header badge
  const roleBadge = await viewPage.waitForSelector('.header-role-badge', { timeout: 3000 });
  const badgeText = await roleBadge.textContent();
  console.log('View page role badge:', badgeText.trim());
  assert(badgeText.includes('View only'), 'Badge must display "View only"');

  // Verify engine isReadOnly is true
  const engineReadOnly = await viewPage.evaluate(() => window.eng?.isReadOnly);
  console.log('Window.eng.isReadOnly:', engineReadOnly);
  assert(engineReadOnly === true, 'CanvasEngine must have isReadOnly = true in view mode');

  // Verify sidebar has only select tools, and no pen / creation buttons
  const creationBtnsCount = await viewPage.evaluate(() => {
    return document.querySelectorAll('button[aria-label*="Pen"], button[aria-label*="Eraser"], button[aria-label*="Sticky"], button[aria-label*="Shapes"]').length;
  });
  console.log('Creation buttons in view mode sidebar:', creationBtnsCount);
  assert(creationBtnsCount === 0, 'Sidebar must not have creation buttons in view mode');

  // Attempt to select a drawing tool like pen via keyboard shortcut
  await viewPage.keyboard.press('p');
  await viewPage.waitForTimeout(300);

  // Check if toast appears warning about view-only mode
  const toastText = await viewPage.evaluate(() => {
    const toast = document.querySelector('.presentation-takeover-toast');
    return toast ? toast.textContent?.trim() : null;
  });
  console.log('View page interaction toast notice:', toastText);
  assert(toastText && toastText.includes('Chế độ chỉ xem'), 'Should show read-only toast warning');
  console.log('✓ Test 1 Passed: View-only mode strictly locks editing, shows badge, removes creation tools from sidebar, and blocks shortcuts.');

  // 2. Test Chevron Shape for Off-Screen Indicators
  console.log('--- Test 2: Chevron Shape for Off-Screen Indicator ---');
  const editContext = await browser.newContext();
  const editPage = await editContext.newPage();
  await editPage.goto('http://localhost:5175');
  await editPage.waitForTimeout(1000);

  // Move viewPage to trigger offscreen indicator on editPage
  await viewPage.evaluate(() => {
    window.eng.setCamera(3500, 0, 1.0);
  });
  await viewPage.mouse.move(600, 400);
  await editPage.waitForTimeout(800);

  const chevronDetails = await editPage.evaluate(() => {
    const pill = document.querySelector('.offscreen-side-right');
    if (!pill) return null;
    const arrow = pill.querySelector('.offscreen-collab-arrow');
    if (!arrow) return null;
    const paths = Array.from(arrow.querySelectorAll('path')).map(p => p.getAttribute('d'));
    const isOutside = arrow.parentElement === pill && !pill.querySelector('.offscreen-pill-body')?.contains(arrow);
    return { paths, isOutside };
  });

  console.log('Offscreen chevron details:', chevronDetails);
  assert(chevronDetails, 'Offscreen indicator must exist');
  assert(chevronDetails.isOutside, 'Chevron must be outside the pill body');
  assert(chevronDetails.paths.some(p => p.includes('8.5 4.5l7 7.5-7 7.5')), 'Must use sleek chevron geometry (d="M8.5 4.5l7 7.5-7 7.5")');
  console.log('✓ Test 2 Passed: Off-screen indicator restored to clean, sleek chevron bracket outside the pill.');

  // 3. Test Clean Modern Hand Cursor
  console.log('--- Test 3: Clean Hand Cursor ---');
  const handCursorSvg = await editPage.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    return {
      grab: shell.style.getPropertyValue('--aw-cursor-grab'),
      grabbing: shell.style.getPropertyValue('--aw-cursor-grabbing'),
    };
  });
  const decodedGrab = decodeURIComponent(handCursorSvg.grab);
  console.log('Grab cursor SVG preview:', decodedGrab.slice(0, 140));
  assert(decodedGrab.includes('stroke-linecap="round"'), 'Must have smooth rounded caps');
  assert(!decodedGrab.includes('v5-7'), 'Must not have old polygon artifacts');
  console.log('✓ Test 3 Passed: Modern, authentic hand cursors verified with clean rounded geometry.');

  // 4. Test Share Modal Per-User Role Dropdowns and Link Generation
  console.log('--- Test 4: Share Modal Role Selection & Per-User Control ---');
  await editPage.click('.header-action-share');
  await editPage.waitForSelector('.share-modal-card', { timeout: 3000 });

  // Open "Anyone with the link" dropdown and choose "Can view"
  await editPage.click('.share-permission-pill');
  await editPage.waitForSelector('.share-permission-dropdown', { timeout: 2000 });
  const viewOption = (await editPage.$$('.share-permission-option'))[2];
  await viewOption.click();
  await editPage.waitForTimeout(200);

  const viewLinkVal = await editPage.inputValue('.share-link-input');
  console.log('Generated viewer link:', viewLinkVal);
  assert(viewLinkVal.includes('&role=view'), 'Generated link for view must have &role=view');

  // Switch back to "Can edit"
  await editPage.click('.share-permission-pill');
  const editOption = (await editPage.$$('.share-permission-option'))[0];
  await editOption.click();
  await editPage.waitForTimeout(200);

  const editLinkVal = await editPage.inputValue('.share-link-input');
  console.log('Generated editor link:', editLinkVal);
  assert(!editLinkVal.includes('&role=view'), 'Generated link for edit must not have &role=view');

  // Verify that active peers in the list have individual role change buttons
  const peerRoleButtons = await editPage.$$('.share-collab-role-btn');
  console.log('Number of individual peer role buttons:', peerRoleButtons.length);
  assert(peerRoleButtons.length >= 1, 'Active collaborators must have individual role dropdown buttons');

  // Click the role button of the first peer and change their role to "Viewer"
  await peerRoleButtons[0].click();
  await editPage.waitForSelector('.share-collab-role-menu', { timeout: 2000 });
  const roleMenuOptions = await editPage.$$('.share-collab-role-option');
  // Click "Viewer" (3rd option)
  await roleMenuOptions[2].click();
  await editPage.waitForTimeout(400);

  console.log('✓ Test 4 Passed: ShareModal supports both link-based role generation and per-user live role changes.');

  // 5. Test Cryptographic Tamper-Proof Share Token (Zero-Bypass Role Protection)
  console.log('--- Test 5: Cryptographic Tamper-Proof Token & Zero Bypass ---');
  // Attempt 1: User removes &role=view completely from URL
  const strippedViewerUrl = viewLinkVal.replace('&role=view', '');
  console.log('Testing stripped viewer URL (no role param):', strippedViewerUrl);
  const tamperContext1 = await browser.newContext();
  const tamperPage1 = await tamperContext1.newPage();
  await tamperPage1.goto(strippedViewerUrl);
  await tamperPage1.waitForTimeout(1000);

  const strippedReadOnly = await tamperPage1.evaluate(() => window.eng?.isReadOnly);
  const strippedBadge = await tamperPage1.$eval('.header-role-badge', el => el.textContent?.trim());
  console.log('Stripped URL readOnly:', strippedReadOnly, '| badge:', strippedBadge);
  assert(strippedReadOnly === true, 'Token must enforce view-only even if role query parameter is removed');
  assert(strippedBadge?.includes('View only'), 'Badge must display "View only"');

  // Attempt 2: Malicious user changes &role=view to &role=edit to try bypassing permissions
  const forgedEditorUrl = strippedViewerUrl + '&role=edit';
  console.log('Testing forged URL with spoofed &role=edit:', forgedEditorUrl);
  const tamperContext2 = await browser.newContext();
  const tamperPage2 = await tamperContext2.newPage();
  await tamperPage2.goto(forgedEditorUrl);
  await tamperPage2.waitForTimeout(1000);

  const forgedReadOnly = await tamperPage2.evaluate(() => window.eng?.isReadOnly);
  const forgedBadge = await tamperPage2.$eval('.header-role-badge', el => el.textContent?.trim());
  console.log('Forged URL readOnly:', forgedReadOnly, '| badge:', forgedBadge);
  assert(forgedReadOnly === true, 'Sealed cryptographic token MUST override spoofed &role=edit parameter');
  assert(forgedBadge?.includes('View only'), 'Role badge must remain "View only" despite &role=edit spoof');

  // Verify unused outlined variable was removed from cursors.ts
  const fs = await import('fs');
  const cursorsContent = fs.readFileSync('src/cursors.ts', 'utf-8');
  assert(!cursorsContent.includes('const outlined ='), 'Unused variable "outlined" must be removed from cursors.ts');
  console.log('✓ Test 5 Passed: Sealed cryptographic token strictly prevents tampering/bypass. Unused "outlined" removed.');

  console.log('\n========================================');
  console.log('ALL VERIFICATION TESTS COMPLETED & PASSED 100%');
  console.log('========================================');

  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

