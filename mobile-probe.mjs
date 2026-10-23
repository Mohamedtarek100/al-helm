export default async (page) => {
  const results = {}
  for (const viewport of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
    await page.setViewportSize({ width: viewport.w, height: viewport.h })
    await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    results[`vp${viewport.w}`] = await page.evaluate(() => ({
      mobileNav: [...document.querySelectorAll('.mobile-nav__link span:last-child')].map(l => l.textContent.trim()),
      sidebarDisplay: getComputedStyle(document.querySelector('.sidebar')).display,
      menuBtn: !!document.querySelector('[class*=mobile-menu]'),
      drawer: !!document.querySelector('[class*=drawer]'),
    }))
  }
  return results
}
