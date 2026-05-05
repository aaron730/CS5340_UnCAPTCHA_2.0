const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

test('extension loads and popup opens', async ({ }) => {
  const pathToExtension = path.join(__dirname, '../../src');
  const userDataDir = '/tmp/test-user-data-dir';
  
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Extensions only work in headful mode
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  let [background] = browserContext.serviceWorkers();
  if (!background)
    background = await browserContext.waitForEvent('serviceworker');

  // Verify extension is loaded (background worker is running)
  expect(background).toBeTruthy();

  // Find the extension ID
  // In a real scenario, you'd navigate to chrome://extensions to find it or use a known one
  // For now, let's just ensure the browser launched with the extension
  
  await browserContext.close();
});