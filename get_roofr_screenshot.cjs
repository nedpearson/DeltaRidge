const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('https://app.roofr.com/login', { waitUntil: 'networkidle2' });
    await page.type('input[type="email"]', 'ned@delta-ridge.com');
    await page.type('input[type="password"]', '1Tranchina2$');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    
    await page.goto('https://app.roofr.com/settings/integrations', { waitUntil: 'networkidle2' });
    // wait a bit for react to render
    await new Promise(r => setTimeout(r, 5000));
    await page.screenshot({ path: 'roofr.png' });
    console.log('Saved to roofr.png');
    await browser.close();
  } catch (e) {
    console.error(e);
  }
})();
