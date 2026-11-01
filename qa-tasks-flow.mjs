 // Browser regression: task CRUD for all four priorities (local mode).
// Run: node <browser-automation>/browser.mjs http://localhost:5173/#/tasks --script ./qa-tasks-flow.mjs
export default async function run(page, ui) {
  const out = { priorities: {}, errors: [] }
  page.on('pageerror', (e) => out.errors.push(e.message))

  const cards = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.task-card')).map(
        (c) =>
          (c.querySelector('h3') || {}).textContent +
          ':' +
          Array.from(c.classList)
            .find((x) => x.indexOf('task-card--') === 0),
      ),
    )

  await page.goto('http://localhost:5173/#/tasks', { waitUntil: 'load' })
  await page.waitForSelector('main')
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('main')
  await page.waitForTimeout(900)
  out.emptyState = (await page.evaluate(() => document.body.innerText)).slice(0, 80)

  for (const level of ['urgent', 'high', 'medium', 'low']) {
    await page.getByRole('button', { name: 'New task' }).first().click()
    await page.waitForTimeout(300)
    await page.locator('[role="dialog"]').getByRole('textbox').first().fill(level + ' item')
    await page.locator('.priority-picker__item--' + level).click()
    await page.getByRole('button', { name: 'New task', exact: true }).last().click()
    await page.waitForTimeout(900)
    out.priorities[level] = {
      dialogStillOpen: (await page.locator('[role="dialog"]').count()) > 0,
      rootKids: await page.evaluate(() => document.getElementById('root').childElementCount),
    }
    if (out.priorities[level].dialogStillOpen) {
      const alert = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="alert"], .toast, .toast__text'))
          .map((n) => n.textContent.trim())
          .filter(Boolean)
          .slice(-1),
      )
      out.priorities[level].shownError = alert
      await page.getByRole('button', { name: 'Back' }).first().click()
      await page.waitForTimeout(200)
    }
  }

  out.stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]').map((t) => t.title + ' => ' + t.priority),
  )
  out.cards = await cards()

  // completion toggle
  const first = page.locator('.task-card').first()
  const before = await first.getAttribute('class')
  await first.locator('.task-check').click()
  await page.waitForTimeout(700)
  out.completedToggled = (await page.locator('.task-card').first().getAttribute('class')) !== before

  // reload persistence
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('main')
  await page.waitForTimeout(600)
  out.afterReload = await cards()

  // delete the last card
  const countBefore = await page.locator('.task-card').count()
  await page.locator('.task-card').last().locator('button[aria-label*="Delete"], button[aria-label*="حذف"]').first().click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^Delete$|^حذف$/ }).last().click()
  await page.waitForTimeout(700)
  out.deleted = (await page.locator('.task-card').count()) === countBefore - 1

  return out
}
