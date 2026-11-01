// Real-UI regression against the deployed app. Local-only mode (no sign-in),
// so nothing is written to any account.
export default async function run(page, ui) {
  const out = { errors: [] }
  page.on('pageerror', (e) => out.errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text().slice(0, 150)) })

  const BASE = 'https://mohamedtarek100.github.io/al-helm-app/'
  await page.goto(BASE + '#/', { waitUntil: 'load', timeout: 45000 })
  await page.waitForTimeout(2500)
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(3000)

  out.launch = await page.evaluate(() => ({
    mounted: document.getElementById('root').childElementCount,
    text: document.body.innerText.slice(0, 90).replace(/\n+/g, ' | '),
  }))

  // --- Navigation across every route ---
  const routes = ['/tasks', '/exams', '/studio', '/settings', '/progress']
  out.nav = {}
  for (const route of routes) {
    await page.goto(BASE + '#' + route, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(1400)
    out.nav[route] = await page.evaluate(() => ({
      mounted: document.getElementById('root').childElementCount,
      heading: (document.querySelector('main h1') || {}).textContent || '',
      panel: !!document.querySelector('.error-panel'),
    }))
  }

  // --- Tasks: create High, verify it persists across reload ---
  await page.goto(BASE + '#/tasks', { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: /New task/i }).first().click()
  await page.waitForTimeout(500)
  await page.locator('[role="dialog"]').getByRole('textbox').first().fill('QA High task')
  await page.locator('.priority-picker__item--high').click()
  await page.getByRole('button', { name: /^New task$/ }).last().click()
  await page.waitForTimeout(1200)
  out.taskCreated = await page.evaluate(() => ({
    cards: document.querySelectorAll('.task-card').length,
    stored: JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]').map((t) => t.title + ':' + t.priority),
  }))

  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(1800)
  out.taskAfterReload = await page.evaluate(() => document.querySelectorAll('.task-card').length)

  // --- Exam: create + invalid date (regression) ---
  await page.goto(BASE + '#/exams', { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /Add exam/i }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('textbox', { name: /Exam title/i }).fill('QA exam')
  await page.locator('input[type="datetime-local"]').fill('2026-12-20T09:30')
  await page.getByRole('button', { name: /^Save$/ }).click()
  await page.waitForTimeout(1200)
  out.examCreated = await page.evaluate(() => ({
    rows: document.querySelectorAll('main h2').length,
    mounted: document.getElementById('root').childElementCount,
  }))

  // invalid date must not crash
  await page.getByRole('button', { name: /Add exam/i }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('textbox', { name: /Exam title/i }).fill('Bad date')
  await page.locator('input[type="datetime-local"]').fill('')
  await page.getByRole('button', { name: /^Save$/ }).click()
  await page.waitForTimeout(800)
  out.examInvalidDate = await page.evaluate(() => ({
    mounted: document.getElementById('root').childElementCount,
    panel: !!document.querySelector('.error-panel'),
    stillOpen: !!document.querySelector('[role="dialog"]'),
  }))
  await page.getByRole('button', { name: /Cancel/i }).click().catch(() => { })

  // --- Studio: tools present + shape draw ---
  await page.goto(BASE + '#/studio', { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(1800)
  out.studio = await page.evaluate(() => ({
    canvas: !!document.querySelector('canvas'),
    rect: !!document.querySelector('[aria-label="Rectangle"]'),
    ellipse: !!document.querySelector('[aria-label="Ellipse"]'),
    text: !!document.querySelector('[aria-label="Text"]'),
    select: !!document.querySelector('[aria-label="Select and move"]'),
    pan: !!document.querySelector('[aria-label="Move canvas"]'),
    colorInput: !!document.querySelector('input[type="color"]'),
  }))

  // --- Admin: unauthorized direct access ---
  await page.goto(BASE + '#/admin', { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2000)
  out.admin = await page.evaluate(() => ({
    mounted: document.getElementById('root').childElementCount,
    panel: !!document.querySelector('.error-panel'),
    metrics: document.querySelectorAll('.admin-metric').length,
    text: document.body.innerText.slice(0, 100).replace(/\n+/g, ' | '),
  }))

  // --- Settings: app lock panel reachable ---
  await page.goto(BASE + '#/settings', { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(1800)
  out.settings = await page.evaluate(() => ({
    hasAppLock: /App lock/i.test(document.body.innerText),
    hint: /PIN/i.test(document.body.innerText),
  }))

  return out
}
