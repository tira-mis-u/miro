import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const scratchDir = path.join(projectRoot, 'scratch');

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:5175';

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const boardId = `collab-pill-snap-${Date.now()}`;
  const targetUrl = `${BASE_URL}/?board=${boardId}`;

  const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  try {
    await page1.goto(targetUrl, { waitUntil: 'networkidle' });
    await page2.goto(targetUrl, { waitUntil: 'networkidle' });

    await page1.waitForSelector('.presence-avatar', { timeout: 10000 });
    await page2.waitForSelector('.presence-avatar', { timeout: 10000 });
    await page1.waitForTimeout(600);

    // 1. Follow pill snapshot
    const avatarA2 = page1.locator('.presence-avatar', { hasText: 'A2' });
    await avatarA2.click();
    await page1.waitForSelector('.following-collab-pill');
    await page1.screenshot({ path: path.join(scratchDir, 'screenshot_collab_follow_pill.png') });

    // Open reaction picker on Tab 1
    const reactionTrigger = page1.locator('.reaction-trigger-btn');
    await reactionTrigger.click();
    await page1.waitForSelector('.reaction-picker-bar');
    await page1.screenshot({ path: path.join(scratchDir, 'screenshot_collab_reaction_picker.png') });

    // 2. Presenter pill snapshot
    const presentBtn = page1.locator('.header-action-secondary');
    await presentBtn.click();
    await page1.waitForSelector('.header-action.is-presenting');
    await page2.waitForSelector('.presenting-indicator-pill');
    await page1.screenshot({ path: path.join(scratchDir, 'screenshot_collab_presenter_tab1.png') });
    await page2.screenshot({ path: path.join(scratchDir, 'screenshot_collab_presenter_tab2.png') });

    console.log('✓ All snapshot pills captured successfully!');
  } finally {
    await page1.close();
    await page2.close();
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
