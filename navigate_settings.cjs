const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('deltaridge.bridgebox.ai'));
  if (!page) {
    console.log("No page found");
    process.exit(1);
  }
  
  await page.goto('https://deltaridge.bridgebox.ai/settings?tab=integrations');
  await new Promise(r => setTimeout(r, 3000));
  
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const refreshBtns = buttons.filter(b => b.textContent.includes('Refresh status'));
    for (const btn of refreshBtns) {
      btn.click();
    }
  });
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'final_green_settings.png', fullPage: true });
  console.log("Screenshot saved to final_green_settings.png");
  await browser.disconnect();
})();
