import { test, expect } from '@playwright/test';

test('Golden Lead: Offline creation to online sync', async ({ page, context }) => {
  // We mock the user session to bypass login
  await page.route('**/*/auth/v1/user', route => 
    route.fulfill({ json: { id: 'test-user', email: 'test@example.com' } })
  );

  // Navigate to the app
  await page.goto('/');
  
  // Wait for the UI to settle
  await page.waitForLoadState('networkidle');
  
  // Simulate going offline
  await context.setOffline(true);
  
  // The app should detect it's offline (the OnlinePill)
  const offlineBadge = page.locator('text=Offline - saved on device');
  await expect(offlineBadge).toBeVisible();

  // Simulate going online
  await context.setOffline(false);
  
  // The app should detect it's online and clear the pending status
  const onlineBadge = page.locator('text=Saved on device');
  await expect(onlineBadge).toBeVisible();
});
