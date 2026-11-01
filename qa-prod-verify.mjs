 import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'

const BASE = 'https://mohamedtarek100.github.io/al-helm-app/'
const out = {}
const errors = []
const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 430, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)) })

// 1. First launch → welcome
await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(4000)
out.welcome = await page.evaluate(() => ({
  mounted: document.getElementById('root').childElementCount,
  hasGoogle: /Continue with Google/.test(document.body.innerText),
  hasGuest: /Continue as guest/.test(document.body.innerText),
}))

// 2. Continue as guest → app
await page.getByRole('button', { name: /Continue as guest/i }).click()
await page.waitForTimeout(2500)
out.afterGuest = await page.evaluate(() => ({
  mounted: document.getElementById('root').childElementCount,
  chars: document.body.innerText.length,
  nav: /Tasks|المهام/i.test(document.body.innerText),
}))

// 3. Exam workflow (the original crash)
await page.evaluate(() => { location.hash = '#/exams' })
await page.waitForTimeout(2200)
out.exams = await page.evaluate(() => ({ heading: (document.querySelector('main h1') || {}).textContent || '', mounted: document.getElementById('root').childElementCount }))

const addBtn = page.locator('main button').filter({ hasText: /Add exam|إضافة امتحان/i }).first()
if (await addBtn.count()) {
  await addBtn.click()
  await page.waitForTimeout(700)
  await page.getByRole('textbox').first().fill('QA exam')
  await page.locator('input[type="datetime-local"]').first().fill('2026-12-20T09:30')
  await page.getByRole('button', { name: /^Save$|^حفظ$/ }).click()
  await page.waitForTimeout(1500)
  out.afterExamSave = await page.evaluate(() => ({
    mounted: document.getElementById('root').childElementCount,
    errorPanel: !!document.querySelector('.error-panel'),
    rows: document.querySelectorAll('main h2').length,
  }))
}

// 4. Other routes
out.routes = {}
for (const r of ['/tasks', '/studio', '/settings', '/progress']) {
  await page.evaluate((h) => { location.hash = '#' + h }, r)
  await page.waitForTimeout(1400)
  out.routes[r] = await page.evaluate(() => ({
    mounted: document.getElementById('root').childElementCount,
    heading: (document.querySelector('main h1') || {}).textContent || '',
  }))
}

// 5. Urgent available in the task form
await page.evaluate(() => { location.hash = '#/tasks' })
await page.waitForTimeout(1500)
const newTask = page.locator('main button').filter({ hasText: /New task|مهمة جديدة/i }).first()
if (await newTask.count()) {
  await newTask.click()
  await page.waitForTimeout(700)
  out.urgent = await page.evaluate(() => ({
    hasUrgentOption: !!document.querySelector('.priority-picker__item--urgent'),
  }))
}

out.errors = errors.slice(0, 6)
console.log('RESULTS_START')
console.log(JSON.stringify(out, null, 1))
console.log('RESULTS_END')
await browser.close()
