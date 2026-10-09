const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  for (const p of pages) {
    console.log(p.url());
  }
  await browser.disconnect();
})();
