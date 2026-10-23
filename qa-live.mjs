export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 })
  const results = {}
  for (const target of ['https://mohamedtarek100.github.io/al-helm-app/', 'http://localhost:4181/al-helm-app/']) {
    await page.goto(target, { waitUntil: 'load' })
    await page.waitForSelector('.app-topbar', { timeout: 25000 }).catch(() => {})
    await page.waitForTimeout(900)
    results[target] = await page.evaluate(() => {
      const disp = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'absent' }
      const drawer = document.querySelector('.mobile-drawer')
      return {
        menuBtn: disp('.mobile-menu-btn'),
        sidebar: disp('.sidebar'),
        drawerEl: disp('.mobile-drawer'),
        drawerLinkCount: drawer ? drawer.querySelectorAll('.mobile-drawer__link').length : 0,
        bodyChars: document.body.innerText.length,
      }
    })
    // open drawer on live too
    const btn = page.locator('.mobile-menu-btn').first()
    if (await btn.count()) {
      await btn.click()
      await page.waitForTimeout(500)
      results[target].drawerOpenLinks = await page.evaluate(() => Array.from(document.querySelectorAll('.mobile-drawer__link')).map(a => a.textContent.trim()))
    }
  }
  return results
}
