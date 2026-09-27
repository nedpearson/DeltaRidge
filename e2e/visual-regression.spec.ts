import { test, expect } from '@playwright/test';

const ROUTES = [
  { name: 'Rep Today', path: '/' },
  { name: 'Leads', path: '/leads' },
  { name: 'Manager Command Center', path: '/manager' },
  { name: 'Map', path: '/map' }
];

const VIEWPORTS = [
  { name: 'Small Phone', width: 375, height: 667 },
  { name: 'Modern Phone', width: 430, height: 932 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Desktop', width: 1440, height: 900 }
];

for (const route of ROUTES) {
  test.describe(\Visual Regression: \\, () => {
    for (const viewport of VIEWPORTS) {
      test(\\ viewport\, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(\http://localhost:5173\\, { waitUntil: 'networkidle' });
        
        // Wait for potential animations or data loads
        await page.waitForTimeout(1000);
        
        // Assert visual snapshot
        await expect(page).toHaveScreenshot(\\-\.png\, {
          fullPage: true,
          maxDiffPixels: 100 // Allow slight rendering differences
        });
      });
    }
  });
}
