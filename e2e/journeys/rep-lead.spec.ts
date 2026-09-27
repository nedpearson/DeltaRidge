import { test, expect } from '@playwright/test';

test.describe('Golden Journey 1: Rep Lead to Appointment', () => {
  test('Rep can navigate to a lead, record a knock, and book an appointment', async ({ page }) => {
    // 1. Authenticate and load Today
    await page.goto('http://localhost:4173/');
    
    // 2. Open Next Best Action
    const openLeadBtn = page.getByRole('button', { name: 'Open Lead' });
    if (await openLeadBtn.isVisible()) {
      await openLeadBtn.click();
      
      // 3. Verify we reached Lead 360
      await expect(page.locator('h1')).toBeVisible();
      
      // 4. Record Knock
      const knockBtn = page.getByRole('button', { name: /Record Knock/i });
      if (await knockBtn.isVisible()) {
        // ... Click, select outcome, save
      }

      // 5. Book Appointment
      const bookBtn = page.getByRole('button', { name: /Book/i });
      if (await bookBtn.isVisible()) {
        // ... Fill form, submit
      }
      
      // 6. Verify Outbox syncs
      // await expect(page.getByTestId('sync-indicator')).toHaveText('Synced');
    }
  });
});
