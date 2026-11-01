import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'

const BASE = 'https://mohamedtarek100.github.io/al-helm-app/'
const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
const log = []
page.on('pageerror', (e) => log.push('PAGEERROR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE: ' + m.text().slice(0, 300)) })

await page.goto(BASE + '#/exams', { waitUntil: 'load', timeout: 45000 })
await page.waitForTimeout(2500)
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)

const out = { before: await page.evaluate(() => document.getElementById('root').childElementCount) }

// Open the dialog and inspect its actual controls.
const addBtn = page.locator('main button').filter({ hasText: /Add exam|إضافة امتحان/i }).first()
await addBtn.click()
await page.waitForTimeout(700)
out.dialog = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return { open: false }
  return {
    open: true,
    inputs: Array.from(d.querySelectorAll('input')).map((i) => ({ type: i.type, value: i.value, name: i.getAttribute('aria-label') || i.name || '' })),
    labels: Array.from(d.querySelectorAll('label')).map((l) => l.textContent.trim().slice(0, 40)),
    buttons: Array.from(d.querySelectorAll('button')).map((b) => b.textContent.trim().slice(0, 30)),
  }
})

// Fill using the real inputs, by type rather than by guesswork.
await page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])').first().fill('QA exam').catch(() => { })
await page.locator('[role="dialog"] input[type="datetime-local"]').first().fill('2026-12-20T09:30')
await page.waitForTimeout(300)
out.filled = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] input')).map((i) => i.type + '=' + i.value))

// Click Save and watch the DOM collapse moment by moment.
await page.locator('[role="dialog"] button').filter({ hasText: /^Save$|^حفظ$/ }).first().click()
for (let i = 0; i < 10; i += 1) {
  await page.waitForTimeout(250)
  const s = await page.evaluate(() => ({
    rootKids: document.getElementById('root').childElementCount,
    panel: !!document.querySelector('.error-panel'),
    panelText: document.querySelector('.error-panel')?.innerText?.slice(0, 160) || '',
  }))
  if (!out.after) out.after = []
  out.after.push(s)
  if (s.panel) break
}
out.log = log.slice(0, 8)
console.log(JSON.stringify(out, null, 1))
await browser.close()
