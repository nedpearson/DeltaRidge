const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('deltaridge'));
  if (!page) {
    console.log("No page found");
    process.exit(1);
  }
  
  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('delta-ridge');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        try {
            const tx = db.transaction('outbox', 'readonly');
            const store = tx.objectStore('outbox');
            const getAll = store.getAll();
            getAll.onsuccess = () => resolve({ count: getAll.result.length, items: getAll.result });
            getAll.onerror = () => reject(getAll.error);
        } catch (e) {
            resolve("Error accessing outbox: " + e.message);
        }
      };
    });
  });
  
  console.log(JSON.stringify(result, null, 2));
  await browser.disconnect();
})();
