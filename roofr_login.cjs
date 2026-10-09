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
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
       await submitBtn.click();
       await page.waitForNavigation({ waitUntil: 'networkidle2' });
       console.log('URL after login:', page.url());
       const cookies = await page.cookies();
       console.log('Cookies:', cookies.map(c => c.name).join(', '));
       // Look for API keys or webhook settings
       await page.goto('https://app.roofr.com/settings/integrations', { waitUntil: 'networkidle2' });
       console.log('Integrations page URL:', page.url());
    } else {
       console.log('Submit button not found!');
    }
    await browser.close();
  } catch (e) {
    console.error(e);
  }
})();
