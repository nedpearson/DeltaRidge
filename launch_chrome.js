import { chromium } from 'playwright';

(async () => {
  console.log("Launching visible Chrome with remote debugging on port 9222...");
  const browser = await chromium.launch({ 
    headless: false, 
    args: ['--remote-debugging-port=9222'] 
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://developer.eagleview.com');
  console.log("Browser is ready.");
  // keep alive
  await new Promise(() => {});
})();
