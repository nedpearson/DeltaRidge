const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    });
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.goto('https://zapier.com/app/login');
    console.log("Ready for user to log in.");
    browser.disconnect();
  } catch (e) {
    console.error(e);
  }
})();
