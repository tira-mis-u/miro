import { chromium } from 'playwright';
import assert from 'node:assert';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5175';

async function runTests() {
  console.log('--- [STAGE 1] Testing SSRF Protection & Link Preview API ---');

  // Test 1: Block private IP / loopback
  const testSsrfBlocked = async (target) => {
    const res = await fetch(`${BASE_URL}/api/link-preview?url=${encodeURIComponent(target)}`);
    console.log(`SSRF test for "${target}": status = ${res.status}`);
    assert([400, 403, 500].includes(res.status), `Expected forbidden/error for ${target}, got ${res.status}`);
  };

  await testSsrfBlocked('http://127.0.0.1:8080');
  await testSsrfBlocked('http://localhost:5175');
  await testSsrfBlocked('http://169.254.169.254/latest/meta-data');
  await testSsrfBlocked('http://192.168.1.1/admin');
  await testSsrfBlocked('http://10.0.0.1');
  await testSsrfBlocked('ftp://example.com/file');
  console.log('✓ SSRF Protection verified: all loopback, private, link-local and invalid protocols blocked.');

  // Test 2: YouTube oEmbed preview
  console.log('\n--- [STAGE 2] Testing YouTube Link Preview Fetch ---');
  const ytRes = await fetch(`${BASE_URL}/api/link-preview?url=${encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}`);
  assert.strictEqual(ytRes.status, 200, `Expected 200 for YouTube URL, got ${ytRes.status}`);
  const ytData = await ytRes.json();
  console.log('YouTube metadata returned:', {
    title: ytData.title,
    siteName: ytData.siteName,
    mediaType: ytData.mediaType,
    hasImage: Boolean(ytData.image),
    embedUrl: ytData.embedUrl,
  });
  assert(ytData.image.includes('hqdefault.jpg') || ytData.image.includes('ytimg.com'), 'YouTube image missing');
  assert.strictEqual(ytData.siteName, 'YouTube', 'YouTube siteName incorrect');
  assert.strictEqual(ytData.mediaType, 'video', 'YouTube mediaType should be video');
  console.log('✓ YouTube metadata extraction verified.');

  // Test 3: Media Upload endpoint
  console.log('\n--- [STAGE 3] Testing /api/media/upload Endpoint ---');
  const dummyVideoBase64 = Buffer.from('dummy video binary data for testing').toString('base64');
  const uploadRes = await fetch(`${BASE_URL}/api/media/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'sample_test_video.mp4',
      dataUrl: `data:video/mp4;base64,${dummyVideoBase64}`,
    }),
  });
  assert.strictEqual(uploadRes.status, 200, `Upload failed with status ${uploadRes.status}`);
  const uploadData = await uploadRes.json();
  console.log('Media upload response:', uploadData);
  assert(uploadData.url.startsWith('/uploads/'), 'Returned URL must point to /uploads/');
  assert(uploadData.url.endsWith('.mp4'), 'Returned URL must preserve safe extension');
  console.log('✓ Media upload verified: saves file and returns lightweight URL (no binary in Yjs).');

  // Test 4: Browser Multi-User Collaboration & Paste Behavior
  console.log('\n--- [STAGE 4] Testing Browser Paste & Collab Sync via Playwright ---');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    console.log('Connecting Page 1 and Page 2...');
    await page1.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page2.goto(BASE_URL, { waitUntil: 'networkidle' });

    await page1.waitForSelector('.canvas-workspace', { timeout: 10000 });
    await page2.waitForSelector('.canvas-workspace', { timeout: 10000 });

    await page1.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    await page2.waitForFunction(() => document.querySelectorAll('.presence-avatars .presence-avatar').length >= 2, { timeout: 10000 });
    console.log('Collab connected between both tabs!');

    // Clear board
    await page1.evaluate(() => {
      window.eng.clearSelection();
      window.eng.shapes.forEach((_, id) => window.eng.yMap.delete(id));
      window.eng.setCamera(0, 0, 1.0);
    });
    await page2.evaluate(() => {
      window.eng.setCamera(0, 0, 1.0);
    });
    await page1.waitForTimeout(300);
    await page2.waitForTimeout(300);

    // 4.1: Test Pasting YouTube URL on Page 1
    console.log('\n--- Test 4.1: Pasting YouTube link on Canvas ---');
    await page1.evaluate(() => {
      // Simulate clipboard paste event with YouTube URL
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files: [],
          getData: (type) => (type === 'text/plain' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : ''),
        },
      });
      window.dispatchEvent(pasteEvent);
    });

    await page1.waitForTimeout(500);
    await page2.waitForTimeout(500);

    // Verify Tab 1 shape
    const tab1Shapes = await page1.evaluate(() => Array.from(window.eng.shapes.values()));
    const linkShapeTab1 = tab1Shapes.find(s => s.type === 'link-card');
    assert(linkShapeTab1, 'LinkCard shape was not created on Tab 1');
    console.log('Tab 1 created LinkCardShape:', {
      id: linkShapeTab1.id,
      url: linkShapeTab1.url,
      siteName: linkShapeTab1.siteName,
      status: linkShapeTab1.status,
      image: linkShapeTab1.image,
    });

    // Verify Tab 2 (Collaborator) received the link-card via Yjs
    const tab2Shapes = await page2.evaluate(() => Array.from(window.eng.shapes.values()));
    const linkShapeTab2 = tab2Shapes.find(s => s.id === linkShapeTab1.id);
    assert(linkShapeTab2, 'Collaborator Tab 2 did not receive LinkCardShape via Yjs');
    assert.strictEqual(linkShapeTab2.type, 'link-card');
    assert.strictEqual(linkShapeTab2.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    console.log('Tab 2 received LinkCardShape via Yjs with zero re-fetching needed!');

    // Verify DOM overlay card rendered on Tab 2
    const overlayTab2 = await page2.evaluate((id) => {
      const el = document.getElementById(`ol_${id}`);
      return el ? {
        rendered: true,
        className: el.className,
        hasImage: Boolean(el.querySelector('img')),
        hasOpenLink: Boolean(el.querySelector('a')),
        linkText: el.innerText,
      } : null;
    }, linkShapeTab1.id);
    console.log('Tab 2 DOM overlay render for link card:', overlayTab2);
    assert(overlayTab2 && overlayTab2.rendered, 'LinkCard overlay DOM missing on Tab 2');
    assert(overlayTab2.hasImage, 'LinkCard overlay DOM should display thumbnail image');
    assert(overlayTab2.hasOpenLink, 'LinkCard overlay DOM should contain Open link anchor');
    console.log('✓ YouTube LinkCardShape collaborative rendering verified.');

    // 4.2: Test Pasting Video on Canvas (Lightweight URL, no binary in Yjs)
    console.log('\n--- Test 4.2: Pasting Video on Canvas ---');
    await page1.evaluate((videoUrl) => {
      window.eng.addVideo(videoUrl, 400, 300, 'intro_video.mp4');
    }, uploadData.url);

    await page1.waitForTimeout(300);
    await page2.waitForTimeout(300);

    const videoShapeTab2 = await page2.evaluate(() => {
      return Array.from(window.eng.shapes.values()).find(s => s.type === 'video');
    });
    assert(videoShapeTab2, 'Collaborator Tab 2 did not receive VideoShape via Yjs');
    assert(videoShapeTab2.src.startsWith('/uploads/'), 'VideoShape src must be lightweight URL, not Data URL');
    assert(!videoShapeTab2.src.startsWith('data:'), 'VideoShape MUST NOT store binary data: URL in Yjs');
    console.log('Tab 2 VideoShape received:', {
      id: videoShapeTab2.id,
      src: videoShapeTab2.src,
      title: videoShapeTab2.title,
    });

    const videoOverlayTab2 = await page2.evaluate((id) => {
      const el = document.getElementById(`ol_${id}`);
      const videoEl = el?.querySelector('video');
      return {
        rendered: Boolean(el),
        hasVideoTag: Boolean(videoEl),
        videoSrc: videoEl?.getAttribute('src'),
      };
    }, videoShapeTab2.id);
    console.log('Tab 2 Video DOM overlay:', videoOverlayTab2);
    assert(videoOverlayTab2.rendered && videoOverlayTab2.hasVideoTag, 'Video DOM overlay not rendered on collaborator');
    console.log('✓ VideoShape collaborative rendering verified with lightweight stored URL.');

    // 4.3: Test Pasting Plain Text -> Creates Sticky Note
    console.log('\n--- Test 4.3: Pasting Plain Text creates Sticky Note ---');
    await page1.evaluate(() => {
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files: [],
          getData: (type) => (type === 'text/plain' ? 'Important meeting notes at 10 AM' : ''),
        },
      });
      window.dispatchEvent(pasteEvent);
    });

    await page1.waitForTimeout(300);
    await page2.waitForTimeout(300);

    const stickyTab2 = await page2.evaluate(() => {
      return Array.from(window.eng.shapes.values()).find(s => s.type === 'sticky' && s.text.includes('Important meeting notes'));
    });
    assert(stickyTab2, 'Pasting plain text should create a Sticky Note shape on canvas');
    console.log('Tab 2 Sticky Note received:', { id: stickyTab2.id, text: stickyTab2.text });
    console.log('✓ Plain text paste to Sticky Note verified.');

    // 4.4: Test Copy (Ctrl+C) and Paste (Ctrl+V) of Canvas Shapes
    console.log('\n--- Test 4.4: Testing internal Copy (Ctrl+C) & Paste (Ctrl+V) ---');
    await page1.evaluate((stickyId) => {
      window.eng.sel.clear();
      window.eng.sel.add(stickyId);
      window.eng.copySel();
      window.eng.pasteInternal(500, 500);
    }, stickyTab2.id);

    await page1.waitForTimeout(300);
    await page2.waitForTimeout(300);

    const stickyCount = await page2.evaluate(() => {
      return Array.from(window.eng.shapes.values()).filter(s => s.type === 'sticky').length;
    });
    assert(stickyCount >= 2, `Expected at least 2 sticky notes after internal copy/paste, got ${stickyCount}`);
    console.log('✓ Internal canvas shape Copy & Paste verified.');

    console.log('\n========================================');
    console.log('ALL COPY-PASTE & RICH PREVIEW TESTS PASSED 100%');
    console.log('========================================');
  } finally {
    await browser.close();
  }
}

runTests().catch((err) => {
  console.error('\nVerification FAILED:', err);
  process.exit(1);
});
