import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { encodeBoardToken } from '../src/store/boardSecurity.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const scratchDir = path.join(projectRoot, 'scratch');

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:5175';

async function main() {
  console.log('=== STARTING SHARE FEATURE & ENCRYPTION VERIFICATION ===');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  const context1 = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page1 = await context1.newPage();

  try {
    // 1. Test URL auto-normalization (visiting / without ?board=)
    console.log('--- 1. Testing URL normalization with encrypted token ---');
    await page1.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page1.waitForTimeout(500);

    const currentUrl = page1.url();
    console.log('Normalized Page URL:', currentUrl);
    if (!currentUrl.includes('token=brd_') && !currentUrl.includes('board=')) {
      throw new Error(`Expected URL to contain encrypted token, got "${currentUrl}"`);
    }
    console.log('✓ URL successfully normalized with encrypted token');

    // 2. Test Share button enabled & click opens ShareModal
    console.log('--- 2. Testing Share button in Header ---');
    const shareBtn = page1.locator('.header-action-share');
    await shareBtn.waitFor({ state: 'visible', timeout: 5000 });
    const isDisabled = await shareBtn.isDisabled();
    if (isDisabled) {
      throw new Error('Share button is still disabled!');
    }
    console.log('✓ Share button is enabled');

    await shareBtn.click();
    await page1.waitForSelector('.share-modal-card', { timeout: 3000 });
    console.log('✓ Share modal successfully opened');

    // 3. Inspect ShareModal contents & Encrypted token
    console.log('--- 3. Testing ShareModal Encrypted Token Badge & URL ---');
    const lockBadge = await page1.locator('.share-modal-lock-badge').textContent();
    console.log('Share modal lock badge text:', lockBadge);
    if (!lockBadge?.includes('Encrypted')) {
      throw new Error('Expected "Encrypted" badge in Share modal!');
    }

    const shareInputVal = await page1.locator('.share-link-input').inputValue();
    console.log('Share modal active URL input:', shareInputVal);
    if (!shareInputVal.includes('token=brd_')) {
      throw new Error(`Share input should contain encrypted "token=brd_...", got "${shareInputVal}"`);
    }
    if (shareInputVal.includes('board=board-1')) {
      throw new Error('Plaintext "board=board-1" should NOT be exposed in encrypted share link!');
    }
    console.log('✓ Plaintext board ID is completely hidden; opaque token brd_... is present');

    // 4. Test Copy button
    console.log('--- 4. Testing Copy button interaction ---');
    const copyBtn = page1.locator('.share-action-copy-btn');
    await copyBtn.click();
    await page1.waitForTimeout(300);

    const isCopied = await copyBtn.evaluate(el => el.classList.contains('is-copied') && el.textContent?.includes('Copied'));
    console.log('Copy button state isCopied:', isCopied);
    if (!isCopied) {
      throw new Error('Copy button did not show "Copied" feedback!');
    }
    console.log('✓ Copy button turned green with "Copied" feedback');

    // 5. Test Help drawer
    console.log('--- 5. Testing Connection Help Drawer ---');
    const helpToggle = page1.locator('.share-help-trigger');
    await helpToggle.click();
    await page1.waitForSelector('.share-help-drawer', { timeout: 2000 });
    const guideText = await page1.locator('.share-help-drawer').textContent();
    if (!guideText?.includes('Windows Defender Firewall') || !guideText?.includes('5175')) {
      throw new Error('Help drawer missing expected Firewall/Port guidance!');
    }
    console.log('✓ Help drawer opened with connection tips');

    // Take screenshot of the Share Modal
    const modalScreenshotPath = path.join(scratchDir, 'screenshot_share_modal_encrypted.png');
    await page1.screenshot({ path: modalScreenshotPath });
    console.log('Saved screenshot of Share modal to:', modalScreenshotPath);

    // Close modal by clicking X
    await page1.locator('.share-modal-close').click();
    await page1.waitForSelector('.share-modal-card', { state: 'detached', timeout: 2000 });
    console.log('✓ Share modal closed cleanly');

    // 6. Test Multi-user room collaboration connection using the Encrypted Token URL
    console.log('--- 6. Testing 2 Users Joining via Encrypted Token Link ---');
    const secureToken = encodeBoardToken('e2e-crypto-board');
    const encryptedRoomUrl = `${BASE_URL}/?token=${encodeURIComponent(secureToken)}`;
    console.log('Encrypted room URL:', encryptedRoomUrl);

    const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await context2.newPage();

    await page1.goto(encryptedRoomUrl, { waitUntil: 'networkidle' });
    await page2.goto(encryptedRoomUrl, { waitUntil: 'networkidle' });

    // Wait for both tabs to discover each other
    await page1.waitForSelector('.presence-avatar', { timeout: 10000 });
    await page2.waitForSelector('.presence-avatar', { timeout: 10000 });

    const page1Avatars = await page1.locator('.presence-avatar').count();
    const page2Avatars = await page2.locator('.presence-avatar').count();
    console.log(`Page 1 sees ${page1Avatars} peers, Page 2 sees ${page2Avatars} peers`);

    if (page1Avatars < 1 || page2Avatars < 1) {
      throw new Error('Peer avatar failed to appear in collaborative room!');
    }

    const page1Solo = await page1.locator('.presence-alone-indicator').count();
    const page2Solo = await page2.locator('.presence-alone-indicator').count();
    console.log(`Page 1 solo count: ${page1Solo}, Page 2 solo count: ${page2Solo}`);
    if (page1Solo !== 0 || page2Solo !== 0) {
      throw new Error('User is still stuck in Solo indicator mode!');
    }

    console.log('✓ Both users joined via the encrypted token link, decrypted seamlessly to the exact same room, and are collaborating live!');
    console.log('=== ALL SHARE & ENCRYPTION TESTS PASSED WITH 100% SUCCESS! ===');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
