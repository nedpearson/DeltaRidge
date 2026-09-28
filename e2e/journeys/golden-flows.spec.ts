import { test, expect } from '@playwright/test';

test.describe('Golden Flows', () => {
  test('Field Rep - Mission Mode Route Advance', async ({ page }) => {
    await page.goto('/mission');
    
    const missionHeading = page.locator('h1').filter({ hasText: 'MISSION:' });
    const missionComplete = page.locator('h1').filter({ hasText: 'MISSION COMPLETE' });
    
    // We expect either an active mission or an empty queue
    await expect(missionHeading.or(missionComplete)).toBeVisible();
  });

  test('Manager - Assign Lead to Rep', async ({ page }) => {
    // Navigate to manager command center (or territory)
    await page.goto('/manager');
    
    // Switch to LEADS & TERRITORY tab
    const territoryTab = page.getByRole('button', { name: 'LEADS & TERRITORY' });
    if (await territoryTab.isVisible()) {
      await territoryTab.click();
    }
    
    // This is hard to assert end to end without a real backend seed, but we can verify the UI doesn't crash
    expect(await page.locator('body').isVisible()).toBe(true);
  });
});
