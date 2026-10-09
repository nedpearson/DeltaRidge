const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true
    });
    const page = await browser.newPage();
    await page.goto('https://app.roofr.com/login', { waitUntil: 'networkidle2' });
    await page.type('input[type="email"]', 'ned@delta-ridge.com');
    await page.type('input[type="password"]', '1Tranchina2$');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    
    await page.goto('https://app.roofr.com/settings/integrations', { waitUntil: 'networkidle2' });
    const html = await page.evaluate(() => document.body.innerHTML);
    const fs = require('fs');
    fs.writeFileSync('roofr_integrations.html', html);
    console.log('Saved to roofr_integrations.html');
    await browser.close();
  } catch (e) {
    console.error(e);
  }
})();
