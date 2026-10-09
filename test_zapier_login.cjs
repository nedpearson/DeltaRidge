const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('https://zapier.com/app/login', { waitUntil: 'networkidle2' });
    
    // Wait for email input
    await page.waitForSelector('input[name="email"]');
    await page.type('input[name="email"]', 'ned@delta-ridge.com');
    
    // Click continue
    const continueBtn = await page.$('button[type="submit"]');
    if (continueBtn) {
       await continueBtn.click();
       await new Promise(r => setTimeout(r, 2000));
       
       // Password
       const pwInput = await page.$('input[name="password"]');
       if (pwInput) {
           await page.type('input[name="password"]', '1Tranchina2$');
           await page.click('button[type="submit"]');
           await page.waitForNavigation({ waitUntil: 'networkidle2' });
           console.log('Logged into Zapier!');
           await page.screenshot({ path: 'zapier_dashboard.png' });
       } else {
           console.log('No password input found. Maybe blocked?');
           await page.screenshot({ path: 'zapier_blocked.png' });
       }
    }
    await browser.close();
  } catch (e) {
    console.error(e);
  }
})();
