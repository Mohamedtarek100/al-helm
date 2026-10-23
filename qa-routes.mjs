export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 })
  const routes = ['/', '/schedule', '/calendar', '/tasks', '/focus', '/studio', '/progress', '/review', '/exams', '/notifications', '/settings']
  const results = []
  for (const route of routes) {
    await page.goto(`http://localhost:4181/al-helm-app/#${route}`, { waitUntil: 'load' })
    await page.waitForTimeout(700)
    const info = await page.evaluate(() => {
      const main = document.querySelector('main')
      const text = main ? main.innerText.slice(0, 80).replace(/\n+/g, ' | ') : ''
      const buttons = main ? main.querySelectorAll('button').length : 0
      const inputs = main ? main.querySelectorAll('input, textarea, select').length : 0
      // Overflow check: any element wider than the viewport
      const vw = window.innerWidth
      const overflowing = Array.from(document.querySelectorAll('main *')).some((el) => {
        const r = el.getBoundingClientRect()
        return r.width > vw + 4 && getComputedStyle(el).overflow !== 'hidden' && el.offsetParent !== null
      })
      return { text, buttons, inputs, overflowing, hasMain: !!main }
    })
    results.push({ route, ...info })
  }
  return results
}
