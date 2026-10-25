/** Phase 7 touch-target audit: measures real hit areas at 390x844. */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core')

const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await context.newPage()

await page.goto('http://localhost:4173/#/tasks')
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const s = new Date().toISOString()
  localStorage.setItem('alhelm.v1.tasks', JSON.stringify([
    { id: 'qa_t1', title: 'QA touch target task', description: '', subjectId: null, dueDate: '2026-10-25', dueTime: '', priority: 'medium', category: 'study', estimatedMinutes: 30, completed: false, completedAt: null, createdAt: s, updatedAt: s },
  ]))
})
await page.reload()
await page.waitForTimeout(1600)

const measure = async (selector, label) => {
  const box = await page.locator(selector).first().boundingBox().catch(() => null)
  if (!box) { console.log(`SKIP ${label}: not found`); return }
  const ok = box.width >= 44 && box.height >= 44
  console.log(`${ok ? 'PASS' : 'WARN'} ${label}: ${Math.round(box.width)}x${Math.round(box.height)}`)
}

// Hit area includes the ::after pseudo-element, so measure via elementFromPoint.
const check = async (selector, label) => {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    // Probe 20px away in each direction: still inside the button's hit area?
    const probes = [[cx - 20, cy], [cx + 20, cy], [cx, cy - 20], [cx, cy + 20]]
    const hits = probes.map(([x, y]) => {
      const t = document.elementFromPoint(x, y)
      return Boolean(t && (t === el || el.contains(t) || (t.closest && t.closest(sel))))
    })
    return { w: Math.round(r.width), h: Math.round(r.height), hits: hits.filter(Boolean).length }
  }, selector)
  if (!result) { console.log(`SKIP ${label}`); return }
  console.log(`${result.hits >= 3 ? 'PASS' : 'WARN'} ${label}: visual ${result.w}x${result.h}, 20px probes hit ${result.hits}/4`)
}

await check('.task-check', 'task checkbox')
await check('.language-toggle', 'language toggle')
const iconBtn = await page.evaluate(() => {
  const el = document.querySelector('.topbar-actions .icon-btn')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height) }
})
console.log(`${iconBtn && iconBtn.w >= 44 ? 'PASS' : 'WARN'} icon-btn: ${iconBtn ? iconBtn.w + 'x' + iconBtn.h : 'not found'}`)

// No horizontal overflow introduced.
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
console.log(`${overflow <= 1 ? 'PASS' : 'FAIL'} no horizontal overflow (${overflow}px)`)
await page.screenshot({ path: 'qa-artifacts/phase7-touch-targets.png' })

await browser.close()
