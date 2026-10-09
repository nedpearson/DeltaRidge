const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('deltaridge.bridgebox.ai'));
  if (!page) {
    console.log("No page found");
    process.exit(1);
  }
  
  await page.screenshot({ path: 'field_sync_fixed.png' });
  console.log("Screenshot saved to field_sync_fixed.png");
  await browser.disconnect();
})();
