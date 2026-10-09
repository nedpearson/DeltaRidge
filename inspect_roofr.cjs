const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true
    });
    const page = await browser.newPage();
    
    // Log network requests
    page.on('request', request => {
      if (request.url().includes('webhook') || request.url().includes('api')) {
        console.log('API Request:', request.method(), request.url());
      }
    });
    
    await page.goto('https://app.roofr.com/login', { waitUntil: 'networkidle2' });
    await page.type('input[type="email"]', 'ned@delta-ridge.com');
    await page.type('input[type="password"]', '1Tranchina2$');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    
    await page.goto('https://app.roofr.com/settings/integrations', { waitUntil: 'networkidle2' });
    
    // Let's also look for links
    const links = await page.evaluate(() => {
       return Array.from(document.querySelectorAll('a')).map(a => a.href);
    });
    console.log("Links on integration page:", links.filter(l => l.includes('zapier') || l.includes('webhook') || l.includes('api')));
    
    await browser.close();
  } catch (e) {
    console.error(e);
  }
})();
