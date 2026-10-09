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
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('delta-ridge');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        try {
            const tx = db.transaction('outbox', 'readwrite');
            const store = tx.objectStore('outbox');
            const clear = store.clear();
            clear.onsuccess = () => resolve("Outbox cleared!");
            clear.onerror = () => reject(clear.error);
        } catch (e) {
            resolve("Error clearing outbox: " + e.message);
        }
      };
    });
  });
  
  console.log(result);
  await browser.disconnect();
})();
