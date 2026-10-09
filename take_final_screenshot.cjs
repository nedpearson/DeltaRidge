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
    const refreshBtns = buttons.filter(b => b.textContent.includes('Refresh status'));
    for (const btn of refreshBtns) {
      btn.click();
    }
  });
  
  // wait 2 seconds for refresh
  await new Promise(r => setTimeout(r, 2000));
  
  await page.screenshot({ path: 'final_green.png' });
  console.log("Screenshot saved to final_green.png");
  await browser.disconnect();
})();
