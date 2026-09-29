import { test, expect } from '@playwright/test'

const ROUTES = ['/', '/leads', '/map', '/inspections', '/more', '/mission']

for (const width of [320, 375, 430]) {
  test.describe('Mobile layout contract @ ' + width + 'px', () => {
    for (const route of ROUTES) {
      test(route + ' has no page-level horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ width, height: 780 })
        await page.goto(route, { waitUntil: 'domcontentloaded' })

        const geometry = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          htmlScroll: document.documentElement.scrollWidth,
          bodyScroll: document.body.scrollWidth,
        }))

        expect(geometry.htmlScroll).toBeLessThanOrEqual(geometry.viewport + 1)
        expect(geometry.bodyScroll).toBeLessThanOrEqual(geometry.viewport + 1)
      })
    }

    test('primary mobile navigation remains visible and tappable', async ({ page }) => {
      await page.setViewportSize({ width, height: 780 })
      await page.goto('/', { waitUntil: 'domcontentloaded' })

      const nav = page.locator('nav.mobile-tabbar')
      await expect(nav).toBeVisible()

      for (const label of ['Today', 'Leads', 'Map', 'Jobs', 'More']) {
        const link = nav.getByText(label, { exact: true })
        await expect(link).toBeVisible()
      }

      const box = await nav.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
    })
  })
}
