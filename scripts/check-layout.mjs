/**
 * Does the bottom navigation cover the page?
 *
 * A real regression, not a hypothetical: the nav grid was declared with four
 * columns while the nav held five items, so it wrapped to two rows and stood
 * 126px tall where the page reserved 96px. This script measured -29px of
 * clearance on an iPhone SE before the fix and +16px after, which is the only
 * reason the bug could be called fixed rather than believed fixed.
 *
 * Layout cannot be checked in jsdom, so this drives a real browser:
 *   npm run check:layout
 */
import { chromium } from 'playwright'

const SIZES = [
  { name: 'iPhone SE      375x667', width: 375, height: 667 },
  { name: 'iPhone 12/13   390x844', width: 390, height: 844 },
  { name: 'iPhone 15      393x852', width: 393, height: 852 },
  { name: 'iPhone 15 Max  430x932', width: 430, height: 932 },
  { name: 'tablet         820x1180', width: 820, height: 1180 },
  { name: 'desktop       1440x900', width: 1440, height: 900 },
]

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
let bad = 0

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
  const page = await context.newPage()
  /*
   * No credentials are injected. This measures the shell — header, nav, main
   * padding — which paints regardless of whether the app can reach a backend,
   * and an earlier version of this file carried a hardcoded Supabase JWT for no
   * reason at all. A layout check has no business holding a key.
   */
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  const report = await page.evaluate(() => {
    const nav = document.querySelector('nav')
    const main = document.querySelector('main')
    if (!nav || !main) return { error: 'no nav or main rendered' }
    const navBox = nav.getBoundingClientRect()
    const mainStyle = getComputedStyle(main)
    const shell = main.parentElement
    const shellVar = shell ? getComputedStyle(shell).getPropertyValue('--bottom-nav-height') : ''

    // How many rows the nav grid actually laid out. Two means it wrapped.
    const grid = nav.firstElementChild
    const rows = grid ? getComputedStyle(grid).gridTemplateRows.split(' ').length : 0

    // The real question: can the last thing on the page be scrolled clear of
    // the nav? Compare the page's scrollable bottom against the nav's top.
    const doc = document.documentElement
    window.scrollTo(0, doc.scrollHeight)
    const last = main.lastElementChild?.lastElementChild ?? main.lastElementChild
    const lastBottom = last ? last.getBoundingClientRect().bottom : 0

    return {
      navHeight: Math.round(navBox.height),
      navRows: rows,
      navTop: Math.round(navBox.top),
      paddingBottom: mainStyle.paddingBottom,
      shellVar: shellVar.trim(),
      lastBottom: Math.round(lastBottom),
      clearance: Math.round(navBox.top - lastBottom),
      horizontalScroll: doc.scrollWidth > doc.clientWidth,
      contentWidth: Math.round(main.getBoundingClientRect().width),
    }
  })

  if (report.error) {
    console.log(`${size.name}  ERROR: ${report.error}`)
    bad += 1
  } else {
    const rowsOk = report.navRows === 1
    const clearOk = report.clearance >= 0
    const scrollOk = !report.horizontalScroll
    const ok = rowsOk && clearOk && scrollOk
    if (!ok) bad += 1
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${size.name}  nav ${report.navHeight}px/${report.navRows} row(s)` +
        `  pad ${report.paddingBottom}  var ${report.shellVar}` +
        `  clearance ${report.clearance}px  width ${report.contentWidth}` +
        `  ${report.horizontalScroll ? 'H-SCROLL!' : ''}`,
    )
  }
  await context.close()
}

await browser.close()
console.log(bad === 0 ? '\nALL SIZES PASS' : `\n${bad} SIZE(S) FAILED`)
process.exit(bad === 0 ? 0 : 1)
