export default async function run(page, ui) {
  const result = {}
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)))

  await page.goto('http://localhost:5173/#/exams', { waitUntil: 'load' })
  await page.waitForSelector('main', { timeout: 20000 })
  await page.waitForTimeout(600)

  // Instrument React's root so an uncaught render error cannot unmount everything.
  await page.evaluate(() => {
    const flag = { seen: [] }
    window.__unmounts = flag
    const root = document.getElementById('root')
    new MutationObserver(() => { flag.seen.push(root.childElementCount) }).observe(root, { childList: true })
  })

  // Click something trivial first to confirm the page is interactive.
  await page.getByRole('link', { name: 'My tasks' }).click()
  await page.waitForTimeout(400)
  result.afterNavToTasks = await page.evaluate(() => document.querySelector('main')?.innerText.slice(0, 60))

  await page.goto('http://localhost:5173/#/exams', { waitUntil: 'load' })
  await page.waitForTimeout(500)

  // Open the dialog, fill and save using DOM selectors (stable across re-renders).
  await page.getByRole('button', { name: 'Add exam' }).click()
  await page.waitForTimeout(300)
  const inputs = page.locator('div[role="dialog"] input')
  await inputs.nth(0).fill('Phys quiz')
  await inputs.nth(1).fill('2026-12-01T14:00')
  result.beforeSave = await page.evaluate(() => ({
    rootChildren: document.getElementById('root').childElementCount,
    dialog: !!document.querySelector('div[role="dialog"]'),
    examRows: Array.from(document.querySelectorAll('main h2')).map((h) => h.textContent),
  }))

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(1200)

  result.afterSave = await page.evaluate(() => ({
    rootChildren: document.getElementById('root').childElementCount,
    bodyChars: document.body.innerText.replace(/\s+/g, ').trim().length,
    dialog: !!document.querySelector('div[role="dialog"]'),
      examRows: Array.from(document.querySelectorAll('main h2')).map((h) => h.textContent),
      rootHtmlHead: document.getElementById('root').innerHTML.slice(0, 120),
  }))
  result.mutationLog = await page.evaluate(() => window.__unmounts ? window.__unmounts.seen.slice(-5) : null)
  result.pageErrors = errors

  // Reload to see whether the route comes back when rendered from stored data.
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(900)
  result.afterReload = await page.evaluate(() => ({
    rootChildren: document.getElementById('root').childElementCount,
    bodyChars: document.body.innerText.replace(/\s+/g, ').trim().length,
    examRows: Array.from(document.querySelectorAll('main h2')).map((h) => h.textContent),
  }))
  result.pageErrorsAfterReload = errors
  return result
}
