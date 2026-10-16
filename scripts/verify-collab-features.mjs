import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const scratchDir = path.join(projectRoot, 'scratch');

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:5175';

async function main() {
  console.log('=== STARTING ADVANCED COLLABORATIVE FEATURES PLAYWRIGHT TEST ===');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const boardId = `collab-adv-${Date.now()}`;
  const targetUrl = `${BASE_URL}/?board=${boardId}`;
  console.log('Connecting to board:', targetUrl);

  const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  try {
    // Open Tab 1 and Tab 2
    await page1.goto(targetUrl, { waitUntil: 'networkidle' });
    await page2.goto(targetUrl, { waitUntil: 'networkidle' });

    // Wait for both tabs to mount
    await page1.waitForSelector('.presence-avatar', { timeout: 10000 });
    await page2.waitForSelector('.presence-avatar', { timeout: 10000 });
    await page1.waitForTimeout(1000);

    console.log('--- 1. TESTING FOLLOW COLLABORATOR MODE ---');
    // Tab 1 clicks avatar A2
    const avatarA2 = page1.locator('.presence-avatar', { hasText: 'A2' });
    await avatarA2.click();
    await page1.waitForTimeout(500);

    const isFollowingClass = await page1.evaluate(() => {
      const btn = document.querySelector('.presence-avatar.is-following');
      const pill = document.querySelector('.following-collab-pill');
      return {
        hasFollowingClass: Boolean(btn),
        pillText: pill?.textContent ?? null,
      };
    });
    console.log('Tab 1 following state:', isFollowingClass);
    if (!isFollowingClass.hasFollowingClass || !isFollowingClass.pillText?.includes('Following Anonymous 2')) {
      throw new Error('Follow mode failed to activate!');
    }
    console.log('✓ Follow mode successfully activated with glowing ring and floating pill');

    // Tab 1 breaks follow mode by zooming with wheel over canvas
    await page1.mouse.move(500, 400);
    await page1.mouse.wheel(0, 100);
    await page1.waitForTimeout(400);
    const brokenFollow = await page1.evaluate(() => Boolean(document.querySelector('.following-collab-pill')));
    console.log('Follow pill after wheel scroll (should be false):', brokenFollow);
    if (brokenFollow) throw new Error('Follow mode was not broken by wheel zoom!');
    console.log('✓ Follow mode gracefully disengaged upon user wheel zoom');

    console.log('--- 2. TESTING PRESENTER MODE ("Bring Everyone to Me") ---');
    // Tab 1 clicks Present button
    const presentBtn = page1.locator('.header-action-secondary');
    await presentBtn.click();
    await page1.waitForTimeout(800);

    const tab1PresentingState = await page1.evaluate(() => {
      const btn = document.querySelector('.header-action.is-presenting');
      const pill = document.querySelector('.presenting-indicator-pill');
      return {
        isPresentingBtn: Boolean(btn),
        btnText: btn?.textContent?.trim(),
        pillText: pill?.textContent?.trim(),
      };
    });
    console.log('Tab 1 presenter UI:', tab1PresentingState);
    if (!tab1PresentingState.isPresentingBtn || !tab1PresentingState.pillText?.includes('You are presenting')) {
      throw new Error('Presenter mode failed to activate on Tab 1!');
    }

    // Tab 2 should see presenter pill
    await page2.waitForTimeout(800);
    const tab2PresenterState = await page2.evaluate(() => {
      const pill = document.querySelector('.presenting-indicator-pill');
      return {
        pillText: pill?.textContent?.trim(),
      };
    });
    console.log('Tab 2 received presentation:', tab2PresenterState);
    if (!tab2PresenterState.pillText?.includes('Anonymous 1 is presenting')) {
      throw new Error('Presenter banner not received on Tab 2!');
    }
    console.log('✓ Presenter mode successfully broadcasted and followed by Tab 2');

    // Tab 1 stops presenting
    await presentBtn.click();
    await page1.waitForTimeout(500);
    await page2.waitForTimeout(500);

    console.log('--- 3. TESTING LIVE FLOATING EMOJI REACTIONS ---');
    // Tab 1 clicks reaction trigger
    const reactionTrigger = page1.locator('.reaction-trigger-btn');
    await reactionTrigger.click();
    await page1.waitForTimeout(400);

    const pickerVisible = await page1.evaluate(() => Boolean(document.querySelector('.reaction-picker-bar')));
    console.log('Reaction picker bar visible:', pickerVisible);
    if (!pickerVisible) throw new Error('Reaction picker bar failed to open!');

    // Click heart reaction
    const heartBtn = page1.locator('.reaction-emoji-btn', { hasText: '❤️' });
    await heartBtn.click();
    await page1.waitForTimeout(600);

    // Both tabs should see floating reaction
    const reactionState1 = await page1.evaluate(() => {
      const react = document.querySelector('.floating-reaction');
      return {
        hasFloatingReaction: Boolean(react),
        emoji: react?.textContent?.trim(),
      };
    });
    const reactionState2 = await page2.evaluate(() => {
      const react = document.querySelector('.floating-reaction');
      return {
        hasFloatingReaction: Boolean(react),
        emoji: react?.textContent?.trim(),
      };
    });

    console.log('Tab 1 floating reaction:', reactionState1);
    console.log('Tab 2 floating reaction:', reactionState2);
    if (!reactionState1.hasFloatingReaction || reactionState1.emoji !== '❤️') {
      throw new Error('Floating reaction not rendered on Tab 1!');
    }
    if (!reactionState2.hasFloatingReaction || reactionState2.emoji !== '❤️') {
      throw new Error('Floating reaction not received on Tab 2!');
    }
    console.log('✓ Floating emoji reaction animated and broadcasted in real-time across all clients');

    // Save screenshots
    await page1.screenshot({ path: path.join(scratchDir, 'screenshot_collab_follow_tab1.png') });
    await page2.screenshot({ path: path.join(scratchDir, 'screenshot_collab_follow_tab2.png') });
    console.log('✓ Saved visual verification screenshots to scratch/');

    console.log('=== ALL ADVANCED COLLABORATIVE FEATURES PASSED 100%! ===');
  } finally {
    await page1.close();
    await page2.close();
    await browser.close();
  }
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
