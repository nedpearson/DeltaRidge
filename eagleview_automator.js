import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  try {
    console.log('Connecting to Chrome on port 9222...');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      console.log('No browser contexts found.');
      process.exit(1);
    }
    const context = contexts[0];
    const pages = context.pages();
    
    let eagleViewPage = pages.find(p => p.url().includes('eagleview.com'));
    
    if (!eagleViewPage) {
      console.log('EagleView not found in open tabs. Opening a new tab...');
      eagleViewPage = await context.newPage();
      await eagleViewPage.goto('https://apicenter.eagleview.com');
    } else {
      console.log('Found an existing EagleView tab:', eagleViewPage.url());
      await eagleViewPage.bringToFront();
    }

    console.log('Waiting for the page to load...');
    await eagleViewPage.waitForLoadState('domcontentloaded');
    
    // Take a screenshot to see where we are
    await eagleViewPage.screenshot({ path: 'eagleview_state.png' });
    console.log('Screenshot saved to eagleview_state.png');

    await browser.disconnect();
    console.log('Disconnected.');
  } catch (err) {
    console.error('Playwright Error:', err);
  }
})();
