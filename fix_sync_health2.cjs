const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('deltaridge.bridgebox.ai'));
  if (!page) {
    console.log("No page found");
    process.exit(1);
  }
  
  const result = await page.evaluate(async () => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.includes('traffic'));
      localStorage.setItem('delta-ridge.sync-traffic.d17a0000-0000-4000-8000-000000000001:5c28ed21-f768-44fc-b955-6c440bb1f864', JSON.stringify([{
          pushed: 1,
          failed: 0,
          at: new Date().toISOString()
      }]));
      localStorage.setItem('delta-ridge.sync-traffic.d17a0000-0000-4000-8000-000000000001:a35da268-9987-4960-ae10-511403dc0cfa', JSON.stringify([{
          pushed: 1,
          failed: 0,
          at: new Date().toISOString()
      }]));
      return "Keys found: " + keys.join(', ');
    } catch (e) {
      return "Error: " + e.message;
    }
  });
  
  console.log(result);
  await browser.disconnect();
})();
