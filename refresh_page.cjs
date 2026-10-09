const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('deltaridge.bridgebox.ai'));
  if (!page) {
    console.log("No page found");
    process.exit(1);
  }
  
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const refreshBtn = buttons.find(b => b.textContent.includes('Refresh status'));
    if (refreshBtn) refreshBtn.click();
  });
  
  console.log("Clicked Refresh status");
  await browser.disconnect();
})();
