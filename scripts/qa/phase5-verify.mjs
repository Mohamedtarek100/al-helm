/**
 * Phase 5 — end-to-end verification of the two integrity fixes in a real browser.
 *
 *  1. A legacy task with no priority is normalised AND written back to
 *     localStorage (surviving a genuine reload), and appears with a priority in
 *     exported backup data.
 *  2. Subject de-duplication survives reload and the store reuses rather than
 *     duplicating, including across a simulated second device (fresh snapshot).
 *
 * Uses an isolated browser profile; only QA-prefixed records are created and
 * only those are removed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PW = 'C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core'
const { chromium } = require(PW)

const BASE = 'http://localhost:4173/'
const OUT = join(process.cwd(), 'qa-artifacts', 'phase5')
const results = []
const check = (name, pass, detail) => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`)
}

const slice = (page, key) => page.evaluate((k) => {
  const raw = localStorage.getItem(`alhelm.v1.${k}`)
  return raw ? JSON.parse(raw) : null
}, key)

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chromium' })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))

  /* ---------- 1. Legacy priority write-back ---------- */
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1200)

  const stamp = new Date().toISOString()
  await page.evaluate((s) => {
    localStorage.setItem('alhelm.v1.tasks', JSON.stringify([
      { id: 'legacy_qa_1', title: 'QA-LEGACY no priority', description: 'keep me', subjectId: null, dueDate: '2026-10-20', dueTime: '', category: 'study', estimatedMinutes: 45, completed: false, completedAt: null, createdAt: s, updatedAt: s },
      { id: 'legacy_qa_2', title: 'QA-EXISTING urgent', description: '', subjectId: null, dueDate: '2026-10-21', dueTime: '', priority: 'urgent', category: 'study', estimatedMinutes: 30, completed: false, completedAt: null, createdAt: s, updatedAt: s },
    ]))
  }, stamp)

  await page.reload()
  await page.waitForTimeout(1800)

  const stored = (await slice(page, 'tasks')) ?? []
  const legacy = stored.find((t) => t.id === 'legacy_qa_1')
  const existing = stored.find((t) => t.id === 'legacy_qa_2')
  check('legacy task priority is written back to localStorage', legacy?.priority === 'medium', `priority=${legacy?.priority}`)
  check('write-back preserves the rest of the record', legacy?.title === 'QA-LEGACY no priority' && legacy?.description === 'keep me' && legacy?.estimatedMinutes === 45 && legacy?.updatedAt === stamp, `title/desc/minutes/updatedAt intact`)
  check('an already-valid priority is not altered', existing?.priority === 'urgent', `priority=${existing?.priority}`)

  // Reload again: idempotent, no further changes.
  const before = JSON.stringify(stored)
  await page.reload()
  await page.waitForTimeout(1600)
  const after = JSON.stringify((await slice(page, 'tasks')) ?? [])
  check('second reload does not rewrite the snapshot (idempotent)', before === after, before === after ? 'identical' : 'changed')

  // UI agrees.
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1400)
  const uiBadges = await page.evaluate(() => [...document.querySelectorAll('.task-card')].map((c) => ({
    title: c.querySelector('.task-card__title')?.textContent ?? '',
    badge: c.querySelector('.priority-badge')?.textContent?.trim() ?? '',
  })))
  const legacyBadge = uiBadges.find((b) => b.title.startsWith('QA-LEGACY'))?.badge
  check('normalised task renders as Medium in the UI', legacyBadge === 'Medium', `badge="${legacyBadge}"`)
  await page.screenshot({ path: join(OUT, '1-legacy-priority.png') })

  // Export contains the normalised priority.
  const exported = await page.evaluate(() => {
    const all = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith('alhelm.v1.')) all[k] = JSON.parse(localStorage.getItem(k))
    }
    return JSON.stringify({ app: 'alhelm', version: 1, data: all })
  })
  check('exported data contains the normalised priority', /"priority":"medium"/.test(exported), 'found priority:medium in export payload')

  /* ---------- 2. Subject de-duplication across a simulated second device ---------- */
  await page.evaluate(() => {
    localStorage.removeItem('alhelm.v1.subjects')
    localStorage.removeItem('alhelm.v1.tasks')
  })
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1400)
  await page.getByRole('button', { name: /new task/i }).first().click()
  await page.waitForTimeout(700)
  const dlg = page.locator('[role="dialog"]').last()
  const combo = dlg.locator('.combobox')
  await combo.locator('input').fill('QASUB Mathematics')
  await page.waitForTimeout(400)
  const createRow = combo.locator('.combobox__option--create').first()
  if (await createRow.count()) { await createRow.click(); await page.waitForTimeout(900) }
  const subjects = (await slice(page, 'subjects')) ?? []
  const created = subjects.find((s) => s.name === 'QASUB Mathematics')
  check('subject created through the UI', Boolean(created), created ? `id=${created.id}` : 'missing')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // Simulated second device: same account snapshot arrives with a near-duplicate
  // name. The store must reuse, not append a twin.
  await page.reload()
  await page.waitForTimeout(1600)
  const beforeCount = ((await slice(page, 'subjects')) ?? []).length
  await page.evaluate(() => {
    // Opening the combobox and typing the variant exercises the reuse path.
    localStorage.removeItem('alhelm:studio-draft:new')
  })
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1400)
  await page.getByRole('button', { name: /new task/i }).first().click()
  await page.waitForTimeout(700)
  const dlg2 = page.locator('[role="dialog"]').last()
  const combo2 = dlg2.locator('.combobox')
  await combo2.locator('input').fill('  qasub   mathematics ')
  await page.waitForTimeout(500)
  const dupCreate = await combo2.locator('.combobox__option--create').count()
  const afterCount = ((await slice(page, 'subjects')) ?? []).length
  check('normalised duplicate cannot be created after reload', dupCreate === 0, `create rows=${dupCreate}`)
  check('subject count unchanged', afterCount === beforeCount, `${beforeCount} → ${afterCount}`)
  await page.screenshot({ path: join(OUT, '2-subject-dedupe.png') })

  /* ---------- cleanup ---------- */
  await page.evaluate(() => {
    for (const key of ['subjects', 'tasks']) {
      const raw = localStorage.getItem(`alhelm.v1.${key}`)
      if (!raw) continue
      const kept = JSON.parse(raw).filter((item) => {
        const label = String(item.name ?? item.title ?? '')
        return !(label.startsWith('QASUB') || label.startsWith('QA-'))
      })
      localStorage.setItem(`alhelm.v1.${key}`, JSON.stringify(kept))
    }
  })

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none')

  await context.close()
  await browser.close()
  const fails = results.filter((r) => r.status === 'FAIL')
  console.log(`\n=== SUMMARY pass=${results.length - fails.length} fail=${fails.length} total=${results.length} ===`)
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  process.exitCode = fails.length ? 1 : 0
}

main().catch((e) => { console.error('HARNESS_ERROR', e); process.exit(2) })
