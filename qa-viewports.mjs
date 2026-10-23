export default async function run(page, ui) {
  const routes = ['/', '/calendar', '/studio', '/exams', '/settings']
  const viewports = [{ w: 360, h: 800 }, { w: 430, h: 932 }, { w: 1440, h: 900 }]
  const results = []
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.w, height: vp.h })
    for (const route of routes) {
      await page.goto(`http://localhost:4181/al-helm-app/#${route}`, { waitUntil: 'load' })
      await page.waitForTimeout(600)
      const info = await page.evaluate(() => {
        const main = document.querySelector('main')
        const vw = window.innerWidth
        const overflowing = Array.from(document.querySelectorAll('main *')).some((el) => {
          const r = el.getBoundingClientRect()
          return r.width > vw + 4 && getComputedStyle(el).overflow !== 'hidden' && el.offsetParent !== null
        })
        const sidebarVisible = (() => { const e = document.querySelector('.sidebar'); return e ? getComputedStyle(e).display !== 'none' : false })()
        const menuBtnVisible = (() => { const e = document.querySelector('.mobile-menu-btn'); return e ? getComputedStyle(e).display !== 'none' : false })()
        return { renders: !!main && main.innerText.length > 40, overflowing, sidebarVisible, menuBtnVisible }
      })
      results.push({ vp: vp.w, route, ...info })
    }
  }
  return results
}
