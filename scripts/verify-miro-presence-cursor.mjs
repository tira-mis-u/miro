import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5175';
const SCREENSHOT_DIR = path.resolve('scratch');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  console.log('🚀 Starting Pure Miro-style Presence & Random RGB Cursor Verification...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    // ── Context 1: Local User (You) ──
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await ctx1.newPage();
    console.log('🌐 Opening Tab 1 (User 1)...');
    await page1.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page1.waitForSelector('.header-presence', { timeout: 15000 });

    // Verify self avatar is visible in presence bar with green dot
    const selfAvatar = page1.locator('.presence-avatar.is-self');
    await selfAvatar.waitFor({ state: 'visible', timeout: 5000 });
    const selfDot = page1.locator('.presence-avatar.is-self .presence-self-dot');
    await selfDot.waitFor({ state: 'visible', timeout: 5000 });

    // Verify NO generic "Solo" label appears
    const soloLabel = page1.locator('.presence-alone-label');
    const isSoloVisible = await soloLabel.isVisible();
    if (isSoloVisible) {
      throw new Error('FAILED: "Solo" label should not be visible when user is in the presence stack!');
    }

    const selfTitle = await selfAvatar.getAttribute('title');
    console.log(`✓ Tab 1 assigned: "${selfTitle}" with green active pulse dot in presence stack (No "Solo" chip)`);

    // Screenshot 1: Header Presence Stack (Self)
    const headerEl1 = page1.locator('.header-presence');
    await headerEl1.screenshot({ path: path.join(SCREENSHOT_DIR, 'miro_presence_self.png') });
    console.log('📸 Saved scratch/miro_presence_self.png');

    // ── Context 2: Collaborator ──
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await ctx2.newPage();
    console.log('🌐 Opening Tab 2 (Collaborator)...');
    await page2.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page2.waitForSelector('.header-presence', { timeout: 15000 });

    // Wait for presence synchronization (both should see 2 avatars)
    await page1.waitForFunction(() => {
      return document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2;
    }, { timeout: 10000 });
    await page2.waitForFunction(() => {
      return document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2;
    }, { timeout: 10000 });
    console.log('✓ Multi-user presence verified: both tabs display overlapping avatar stack');

    // Screenshot 2: Multi-user Presence Stack
    await headerEl1.screenshot({ path: path.join(SCREENSHOT_DIR, 'miro_presence_multi.png') });
    console.log('📸 Saved scratch/miro_presence_multi.png');

    // ── Move Tab 2 Cursor to trigger Miro Arrow Cursor on Tab 1 ──
    console.log('🖱️ Moving Tab 2 mouse to canvas coordinate (620, 380)...');
    await page2.mouse.move(620, 380);
    await page2.waitForTimeout(300);

    // Verify Tab 1 renders remote cursor
    const remoteCursor = page1.locator('.remote-cursor-container');
    await remoteCursor.waitFor({ state: 'visible', timeout: 5000 });

    const cursorPointer = page1.locator('.remote-cursor-pointer path');
    const cursorPath = await cursorPointer.getAttribute('d');
    const expectedPath = 'M0 0L0 16.5L4.5 12.5L8.2 20.5L10.8 19.5L7.2 11.5L13.5 11.5Z';
    if (cursorPath !== expectedPath) {
      throw new Error(`FAILED: Cursor path is ${cursorPath}, expected ${expectedPath}`);
    }

    const cursorColor = await cursorPointer.getAttribute('fill');
    console.log(`✓ Tab 2 cursor color verified in random RGB format: ${cursorColor}`);
    if (!cursorColor.startsWith('rgb(')) {
      throw new Error(`Expected random RGB color format rgb(...), got ${cursorColor}`);
    }

    const cursorBadge = page1.locator('.remote-cursor-badge');
    await cursorBadge.waitFor({ state: 'visible', timeout: 5000 });
    const badgeText = await cursorBadge.innerText();
    console.log(`✓ Tab 1 sees Tab 2's authentic Miro arrow cursor and anchored badge: "${badgeText}" with color ${cursorColor}`);

    // Screenshot 3: Full canvas with Miro cursor
    await page1.screenshot({ path: path.join(SCREENSHOT_DIR, 'miro_cursor_verified.png') });
    console.log('📸 Saved scratch/miro_cursor_verified.png');

    // ── Move Tab 1 Cursor to trigger Tab 1 cursor on Tab 2 ──
    console.log('🖱️ Moving Tab 1 mouse to canvas coordinate (450, 300)...');
    await page1.mouse.move(450, 300);
    await page1.waitForTimeout(300);

    const remoteCursorOnTab2 = page2.locator('.remote-cursor-container');
    await remoteCursorOnTab2.waitFor({ state: 'visible', timeout: 5000 });

    const tab1PointerOnTab2 = page2.locator('.remote-cursor-pointer path');
    const tab1Fill = await tab1PointerOnTab2.getAttribute('fill');
    const badgeOnTab2 = page2.locator('.remote-cursor-badge');
    const badgeTextOnTab2 = await badgeOnTab2.innerText();
    console.log(`✓ Tab 2 sees Tab 1's cursor: "${badgeTextOnTab2}" with random RGB color ${tab1Fill}`);
    if (!tab1Fill.startsWith('rgb(')) {
      throw new Error(`Expected random RGB color format rgb(...), got ${tab1Fill}`);
    }

    // Screenshot 4: Tab 2 seeing Tab 1 cursor
    await page2.screenshot({ path: path.join(SCREENSHOT_DIR, 'miro_cursor_seen_by_peer.png') });
    console.log('📸 Saved scratch/miro_cursor_seen_by_peer.png');

    // ── Follow Collaborator Mode ──
    console.log('🎯 Tab 1 clicks peer avatar to follow screen...');
    const peerAvatar = page1.locator('.presence-avatars button.presence-avatar').first();
    await peerAvatar.click();
    await page1.waitForTimeout(300);

    const followPill = page1.locator('.following-collab-pill');
    await followPill.waitFor({ state: 'visible', timeout: 5000 });
    const followText = await followPill.innerText();
    console.log(`✓ Follow mode activated: "${followText.replace(/\n/g, ' ')}"`);

    // Screenshot 5: Follow mode active
    await page1.screenshot({ path: path.join(SCREENSHOT_DIR, 'miro_follow_mode.png') });
    console.log('📸 Saved scratch/miro_follow_mode.png');

    console.log('🎉 ALL MIRO COLLABORATION, PRESENCE & RANDOM RGB CURSOR VERIFICATIONS PASSED PERFECTLY!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('❌ Verification Error:', err);
  process.exit(1);
});
