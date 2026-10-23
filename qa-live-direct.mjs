export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'load' })
  await page.waitForSelector('.app-topbar', { timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(1000)
  const r = {}
  r.menuBtn = await page.evaluate(() => { const b = document.querySelector('.mobile-menu-btn'); return b ? getComputedStyle(b).display : 'absent' })
  const btn = page.locator('.mobile-menu-btn').first()
  if (await btn.count()) {
    await btn.click()
    await page.waitForTimeout(500)
    r.drawerLinks = await page.evaluate(() => Array.from(document.querySelectorAll('.mobile-drawer__link')).map(a => a.textContent.trim()))
    const cal = page.locator('.mobile-drawer__link', { hasText: 'Calendar' }).first()
    if (await cal.count()) { await cal.click(); await page.waitForTimeout(600); r.calendarVisible = await page.evaluate(() => !!document.querySelector('.calendar, [class*=calendar]')) }
  }
  return r
}
