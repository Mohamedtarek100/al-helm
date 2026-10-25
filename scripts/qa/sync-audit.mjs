/** Real-browser check of the connectivity indicator (offline/online). */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core')

const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

await page.goto('http://localhost:4173/#/tasks')
await page.waitForTimeout(1800)

const pill = page.locator('.sync-pill')
const visible = await pill.count()
console.log(`${visible ? 'PASS' : 'FAIL'} sync indicator rendered: ${visible}`)
console.log('initial label:', (await pill.first().textContent().catch(() => ''))?.trim())

// Go offline and confirm the app keeps working + reports local-only honestly.
await context.setOffline(true)
await page.waitForTimeout(1200)
const offlineLabel = (await pill.first().textContent().catch(() => ''))?.trim()
console.log('offline label:', offlineLabel)

// Create a task while offline — must persist locally.
await page.getByRole('button', { name: /new task/i }).first().click()
await page.waitForTimeout(700)
const dlg = page.locator('[role="dialog"]').last()
await dlg.locator('input').first().fill('QA offline task')
await page.getByRole('button', { name: /^new task$/i }).last().click()
await page.waitForTimeout(1200)
const saved = await page.evaluate(() => {
  const raw = localStorage.getItem('alhelm.v1.tasks')
  return raw ? JSON.parse(raw).some((t) => t.title === 'QA offline task') : false
})
console.log(`${saved ? 'PASS' : 'FAIL'} task created while offline is stored locally`)

// Reload while still offline: the task must still be there.
await page.reload()
await page.waitForTimeout(1800)
const survived = await page.evaluate(() => {
  const raw = localStorage.getItem('alhelm.v1.tasks')
  return raw ? JSON.parse(raw).some((t) => t.title === 'QA offline task') : false
})
console.log(`${survived ? 'PASS' : 'FAIL'} offline task survives reload while still offline`)

// Back online.
await context.setOffline(false)
await page.waitForTimeout(2500)
const onlineLabel = (await pill.first().textContent().catch(() => ''))?.trim()
console.log('online label:', onlineLabel)

// No horizontal overflow introduced by the pill.
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
console.log(`${overflow <= 1 ? 'PASS' : 'FAIL'} no horizontal overflow (${overflow}px)`)

// Cleanup QA record.
await page.evaluate(() => {
  const raw = localStorage.getItem('alhelm.v1.tasks')
  if (!raw) return
  localStorage.setItem('alhelm.v1.tasks', JSON.stringify(JSON.parse(raw).filter((t) => !String(t.title).startsWith('QA '))))
})
console.log('page errors:', errors.length ? errors.slice(0, 3) : 'none')
await page.screenshot({ path: 'qa-artifacts/final-sync-indicator.png' })
await browser.close()
