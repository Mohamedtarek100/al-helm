/**
 * UI verification pass for the 4uLife overhaul.
 *
 * Drives the locally built app (vite preview on :4173) through the editor's
 * bundled Chromium. It does NOT deploy, does NOT touch cloud data, and only
 * creates records in the browser's own localStorage sandbox (fresh context per
 * run), so no real account is modified.
 *
 * Usage: node scripts/qa/ui-verify.mjs [--shots]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PW = 'C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core'
const { chromium } = require(PW)

const BASE = 'http://localhost:4173/'
const SHOTS = join(process.cwd(), 'qa-artifacts')
const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '1366x768', width: 1366, height: 768 },
]

const results = []
const record = (r) => { results.push(r); console.log(`[${r.status}] ${r.viewport} ${r.route} — ${r.check}: ${r.detail}`) }

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(350)
}

/** Horizontal overflow + element geometry problems. */
async function layoutAudit(page, viewport, route) {
  const data = await page.evaluate(() => {
    const doc = document.documentElement
    const overflowX = doc.scrollWidth - doc.clientWidth
    const vw = doc.clientWidth
    const clipped = []
    const tiny = []
    for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="button"]')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      // Elements visually cut off by the viewport (ignoring intentional scrollers).
      if (r.right > vw + 1.5 && !el.closest('.table-scroll, .sketch-recent, .admin-subnav, .subnav, .combobox__list')) {
        clipped.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} right=${Math.round(r.right)}`)
      }
      if ((r.width < 32 || r.height < 28) && el.offsetParent !== null) {
        tiny.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
    }
    const heading = document.querySelector('h1')
    return {
      overflowX,
      vw,
      clipped: clipped.slice(0, 6),
      tiny: tiny.slice(0, 8),
      title: heading ? heading.textContent.trim() : '(no h1)',
      darkScroll: document.body.scrollWidth - vw,
    }
  })
  record({
    viewport: viewport.name, route, check: 'no horizontal overflow',
    status: data.overflowX <= 1 && data.darkScroll <= 1 ? 'PASS' : 'FAIL',
    detail: `scrollWidth-clientWidth=${data.overflowX}px, body=${data.darkScroll}px, h1="${data.title}"`,
  })
  record({
    viewport: viewport.name, route, check: 'no clipped controls',
    status: data.clipped.length === 0 ? 'PASS' : 'FAIL',
    detail: data.clipped.length ? data.clipped.join('; ') : 'none',
  })
  if (data.tiny.length) {
    record({ viewport: viewport.name, route, check: 'touch targets', status: 'WARN', detail: data.tiny.join('; ') })
  }
  return data
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chromium' })
  const consoleErrors = []
  const failedRequests = []

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.width < 500 ? 3 : 1,
      isMobile: viewport.width < 500,
      hasTouch: viewport.width < 500,
    })
    const page = await context.newPage()
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ viewport: viewport.name, text: m.text().slice(0, 220) }) })
    page.on('pageerror', (e) => consoleErrors.push({ viewport: viewport.name, text: 'PAGEERROR ' + String(e.message).slice(0, 220) }))
    page.on('requestfailed', (r) => failedRequests.push({ viewport: viewport.name, url: r.url().slice(0, 140), err: r.failure()?.errorText }))

    // Seed local-only demo data so empty states don't hide the components.
    await page.goto(BASE)
    await settle(page)
    await page.evaluate(() => {
      const stamp = new Date().toISOString()
      const today = stamp.slice(0, 10)
      const sub = { id: 'sub_qa_1', name: 'Mathematics', color: 'terracotta', notes: '', weeklyTargetMinutes: 120, archived: false, createdAt: stamp, updatedAt: stamp }
      const task = (id, title, priority) => ({ id, title, description: priority === 'urgent' ? 'Prepare the model answer sheet with full working.' : '', subjectId: 'sub_qa_1', dueDate: today, dueTime: '', priority, category: 'study', estimatedMinutes: 45, completed: false, completedAt: null, createdAt: stamp, updatedAt: stamp })
      localStorage.setItem('alhelm.v1.subjects', JSON.stringify([sub]))
      localStorage.setItem('alhelm.v1.tasks', JSON.stringify([task('tsk_qa_1', 'Finish chapter review', 'urgent'), task('tsk_qa_2', 'Practice past paper', 'high'), task('tsk_qa_3', 'Read art history notes', 'medium'), task('tsk_qa_4', 'Tidy the sketchbook', 'low')]))
    })
    await page.reload()
    await settle(page)

    /* ---------------- Home ---------------- */
    await layoutAudit(page, viewport, '/')
    await page.screenshot({ path: join(SHOTS, `${viewport.name}-home.png`), fullPage: false })

    /* ---------------- Tasks: badges, filter, sort, combobox ---------------- */
    await page.goto(BASE + '#/tasks'); await settle(page)
    await layoutAudit(page, viewport, '/tasks')
    const badgeCount = await page.locator('.priority-badge').count()
    const badgeTexts = await page.locator('.priority-badge').allTextContents()
    record({ viewport: viewport.name, route: '/tasks', check: 'priority badges render with text', status: badgeCount >= 4 ? 'PASS' : 'FAIL', detail: `${badgeCount} badges: ${[...new Set(badgeTexts.map((t) => t.trim()))].join(' / ')}` })
    await page.screenshot({ path: join(SHOTS, `${viewport.name}-tasks.png`) })

    // Priority filter (segmented) — pick "Urgent" (2nd item: All, Urgent, High...).
    const urgentTab = page.locator('.task-toolbar__priority .segmented__item').nth(1)
    if (await urgentTab.count()) {
      // The control must expose every option without internal scrolling.
      const segFit = await page.evaluate(() => {
        const s = document.querySelector('.task-toolbar__priority .segmented')
        if (!s) return null
        return { scroll: s.scrollWidth, client: s.clientWidth, items: s.children.length, overflowY: getComputedStyle(s).overflow }
      })
      record({
        viewport: viewport.name, route: '/tasks', check: 'priority filter fully visible (no clipping)',
        status: segFit && segFit.scroll <= segFit.client + 1 ? 'PASS' : 'FAIL',
        detail: segFit ? `scrollWidth=${segFit.scroll} clientWidth=${segFit.client} items=${segFit.items} overflow=${segFit.overflowY}` : 'control missing',
      })
      await urgentTab.click(); await page.waitForTimeout(250)
      const visibleCards = await page.locator('.task-card').count()
      record({ viewport: viewport.name, route: '/tasks', check: 'priority filter narrows list', status: visibleCards === 1 ? 'PASS' : 'FAIL', detail: `${visibleCards} card(s) after selecting Urgent` })
      await urgentTab.click(); await page.waitForTimeout(200)
    } else {
      record({ viewport: viewport.name, route: '/tasks', check: 'priority filter present', status: 'FAIL', detail: 'no segmented control found in .task-toolbar__priority' })
    }

    // Task form: priority picker + typing focus retention.
    await page.getByRole('button', { name: /new task|مهمة جديدة/i }).first().click(); await settle(page)
    const dialog = page.locator('[role="dialog"]').last()
    const picker = dialog.locator('.priority-picker__item')
    record({ viewport: viewport.name, route: '/tasks', check: 'priority picker has 4 levels', status: (await picker.count()) === 4 ? 'PASS' : 'FAIL', detail: `${await picker.count()} options` })
    const titleInput = dialog.locator('input').first()
    await titleInput.click()
    await titleInput.type('Typing stays focused', { delay: 25 })
    const value = await titleInput.inputValue()
    record({ viewport: viewport.name, route: '/tasks', check: 'modal keeps typing focus', status: value === 'Typing stays focused' ? 'PASS' : 'FAIL', detail: `input value="${value}"` })
    await picker.nth(0).click()
    const urgentChecked = await picker.nth(0).getAttribute('aria-checked')
    record({ viewport: viewport.name, route: '/tasks', check: 'picker selects urgent', status: urgentChecked === 'true' ? 'PASS' : 'FAIL', detail: `aria-checked=${urgentChecked}` })
    // Subject combobox inside the form.
    const combo = dialog.locator('.combobox')
    if (await combo.count()) {
      await combo.locator('input').click(); await page.waitForTimeout(200)
      await combo.locator('input').fill('math'); await page.waitForTimeout(300)
      const opts = await combo.locator('.combobox__option').allTextContents()
      const createWhileMatching = await combo.locator('.combobox__option--create').count()
      record({ viewport: viewport.name, route: '/tasks', check: 'subject combobox searches', status: opts.some((o) => /Math/i.test(o)) ? 'PASS' : 'FAIL', detail: opts.map((o) => o.trim()).join(' | ') })
      record({ viewport: viewport.name, route: '/tasks', check: 'no duplicate offer while a match exists', status: createWhileMatching === 0 ? 'PASS' : 'FAIL', detail: `create rows while matching="math": ${createWhileMatching}` })
      await combo.locator('input').fill('NoSuchSubject'); await page.waitForTimeout(300)
      const createTexts = await combo.locator('.combobox__option--create').allTextContents()
      record({ viewport: viewport.name, route: '/tasks', check: 'combobox offers create', status: createTexts.length > 0 ? 'PASS' : 'FAIL', detail: createTexts.join(' | ') || 'no create row' })
      // Exact duplicate text must reuse the subject instead of creating.
      await combo.locator('input').fill('  mathematics  '); await page.waitForTimeout(300)
      const exactCreate = await combo.locator('.combobox__option--create').count()
      record({ viewport: viewport.name, route: '/tasks', check: 'normalised duplicate cannot be created', status: exactCreate === 0 ? 'PASS' : 'FAIL', detail: `create rows for "  mathematics  ": ${exactCreate}` })
      // List must stay inside the viewport.
      const box = await combo.locator('.combobox__list').boundingBox()
      record({ viewport: viewport.name, route: '/tasks', check: 'combobox list inside viewport', status: box && box.x >= -1 && box.x + box.width <= viewport.width + 1 ? 'PASS' : 'FAIL', detail: box ? `x=${Math.round(box.x)} w=${Math.round(box.width)} vw=${viewport.width}` : 'no list box' })
      await page.screenshot({ path: join(SHOTS, `${viewport.name}-tasks-combobox.png`) })
    } else {
      record({ viewport: viewport.name, route: '/tasks', check: 'subject combobox present in task form', status: 'FAIL', detail: 'not found' })
    }
    // Dismiss the dropdown first (its own Escape contract), then close the modal.
    await page.keyboard.press('Escape'); await page.waitForTimeout(250)
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
    const closed = await page.locator('[role="dialog"]').count()
    record({ viewport: viewport.name, route: '/tasks', check: 'escape closes form', status: closed === 0 ? 'PASS' : 'FAIL', detail: `${closed} dialog(s) still open` })

    /* ---------------- Studio ---------------- */
    await page.goto(BASE + '#/studio'); await settle(page)
    await layoutAudit(page, viewport, '/studio')
    const canvas = page.locator('canvas.sketch-canvas')
    const cbox = await canvas.boundingBox()
    if (cbox) {
      // Draw two strokes and confirm the bitmap keeps ink.
      for (const offset of [0.3, 0.6]) {
        await page.mouse.move(cbox.x + cbox.width * 0.2, cbox.y + cbox.height * offset)
        await page.mouse.down()
        for (let i = 1; i <= 8; i += 1) await page.mouse.move(cbox.x + cbox.width * (0.2 + i * 0.06), cbox.y + cbox.height * offset + i * 2)
        await page.mouse.up()
      }
      const inkCount = await page.evaluate(() => {
        const c = document.querySelector('canvas.sketch-canvas')
        const ctx = c.getContext('2d')
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        let ink = 0
        for (let i = 0; i < data.length; i += 4 * 97) {
          // Count pixels notably darker than the cream paper.
          if (data[i] < 200 && data[i + 1] < 200 && data[i + 2] < 200) ink += 1
        }
        return ink
      })
      record({ viewport: viewport.name, route: '/studio', check: 'drawing produces visible ink', status: inkCount > 5 ? 'PASS' : 'FAIL', detail: `${inkCount} sampled dark pixels` })
      // DPR: backing store should be >= CSS size for crispness.
      const dprInfo = await page.evaluate(() => {
        const c = document.querySelector('canvas.sketch-canvas')
        return { w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width), ratio: +(c.width / c.getBoundingClientRect().width).toFixed(2) }
      })
      record({ viewport: viewport.name, route: '/studio', check: 'canvas backing store matches DPR', status: dprInfo.ratio >= 0.99 ? 'PASS' : 'FAIL', detail: `backing ${dprInfo.w}x${dprInfo.h}, css ${dprInfo.cssW}, ratio ${dprInfo.ratio}` })
      // Resize the viewport and confirm ink survives (document-model repaint).
      await page.setViewportSize({ width: Math.max(320, viewport.width - 40), height: viewport.height })
      await page.waitForTimeout(400)
      const inkAfter = await page.evaluate(() => {
        const c = document.querySelector('canvas.sketch-canvas')
        const ctx = c.getContext('2d')
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        let ink = 0
        for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) ink += 1
        return ink
      })
      record({ viewport: viewport.name, route: '/studio', check: 'ink survives viewport resize', status: inkAfter > 5 ? 'PASS' : 'FAIL', detail: `${inkAfter} sampled dark pixels after resize` })
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
    } else {
      record({ viewport: viewport.name, route: '/studio', check: 'canvas renders', status: 'FAIL', detail: 'no canvas box' })
    }
    record({ viewport: viewport.name, route: '/studio', check: 'save-state indicator visible', status: (await page.locator('.save-state').count()) > 0 ? 'PASS' : 'FAIL', detail: `${await page.locator('.save-state').count()} indicator(s), text="${(await page.locator('.save-state').first().textContent()) || ''}"` })
    await page.screenshot({ path: join(SHOTS, `${viewport.name}-studio.png`) })

    // Leave the studio tab and return: ink must still be there.
    const galleryTab = page.getByRole('tab', { name: /my gallery|معرض أعمالي/i }).first()
    const sketchTab = page.getByRole('tab', { name: /sketch board|لوحة الرسم/i }).first()
    if (await galleryTab.count()) {
      await galleryTab.click(); await page.waitForTimeout(500)
      await sketchTab.click(); await page.waitForTimeout(700)
    }
    const inkTab = await page.evaluate(() => {
      const c = document.querySelector('canvas.sketch-canvas')
      if (!c) return -1
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let ink = 0
      for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200 && d[i + 1] < 200 && d[i + 2] < 200) ink += 1
      return ink
    })
    record({ viewport: viewport.name, route: '/studio', check: 'ink survives tab switch', status: inkTab > 5 ? 'PASS' : 'FAIL', detail: `${inkTab} sampled dark pixels after round-trip` })

    /* ---------------- Settings + reminders ---------------- */
    await page.goto(BASE + '#/settings'); await settle(page)
    await layoutAudit(page, viewport, '/settings')
    const rows = await page.locator('.reminder-row').count()
    const pill = await page.locator('.platform-pill').first().textContent().catch(() => '')
    record({ viewport: viewport.name, route: '/settings', check: 'reminder rows render', status: rows >= 3 ? 'PASS' : 'FAIL', detail: `${rows} rows, platform pill="${(pill || '').trim()}"` })
    const timeBox = await page.locator('.reminder-row .input--time').first().boundingBox()
    record({ viewport: viewport.name, route: '/settings', check: 'time input inside card', status: timeBox && timeBox.x >= 0 && timeBox.x + timeBox.width <= viewport.width + 1 ? 'PASS' : 'FAIL', detail: timeBox ? `x=${Math.round(timeBox.x)} w=${Math.round(timeBox.width)} vw=${viewport.width}` : 'missing' })
    await page.screenshot({ path: join(SHOTS, `${viewport.name}-settings.png`), fullPage: true })

    /* ---------------- Admin (signed out → must deny, not crash) ---------------- */
    await page.goto(BASE + '#/admin'); await settle(page)
    await layoutAudit(page, viewport, '/admin')
    const deniedVisible = await page.locator('.empty-state, .page-heading').first().isVisible().catch(() => false)
    const adminCrash = await page.evaluate(() => Boolean(document.body.textContent?.includes('Something went wrong')))
    record({ viewport: viewport.name, route: '/admin', check: 'signed-out admin denied without crash', status: !adminCrash && deniedVisible ? 'PASS' : 'FAIL', detail: `denial UI visible=${deniedVisible}, crash text=${adminCrash}` })
    await page.screenshot({ path: join(SHOTS, `${viewport.name}-admin.png`) })

    /* ---------------- RTL pass on tasks ---------------- */
    // Switch language through the real UI so the provider and storage agree.
    await page.goto(BASE + '#/settings'); await settle(page)
    const arButton = page.getByRole('button', { name: 'العربية' }).first()
    if (await arButton.count()) { await arButton.click(); await page.waitForTimeout(500) }
    await page.reload(); await settle(page)
    const dir = await page.evaluate(() => document.documentElement.dir || document.body.dir || '')
    await page.goto(BASE + '#/tasks'); await settle(page)
    await layoutAudit(page, viewport, '/tasks (ar)')
    record({ viewport: viewport.name, route: '/tasks (ar)', check: 'RTL direction applied', status: dir === 'rtl' ? 'PASS' : 'WARN', detail: `html dir="${dir}"` })
    await page.screenshot({ path: join(SHOTS, `${viewport.name}-tasks-ar.png`) })

    await context.close()
  }

  await browser.close()

  const byStatus = (s) => results.filter((r) => r.status === s).length
  console.log(`\n=== SUMMARY pass=${byStatus('PASS')} fail=${byStatus('FAIL')} warn=${byStatus('WARN')} total=${results.length} ===`)
  if (consoleErrors.length) {
    console.log('\n=== CONSOLE ERRORS ===')
    for (const e of consoleErrors.slice(0, 25)) console.log(`- [${e.viewport}] ${e.text}`)
  } else console.log('\n=== CONSOLE ERRORS: none ===')
  if (failedRequests.length) {
    console.log('\n=== FAILED REQUESTS ===')
    for (const f of failedRequests.slice(0, 15)) console.log(`- [${f.viewport}] ${f.url} :: ${f.err}`)
  } else console.log('=== FAILED REQUESTS: none ===')

  writeFileSync(join(SHOTS, 'results.json'), JSON.stringify({ results, consoleErrors, failedRequests }, null, 2))
  process.exitCode = byStatus('FAIL') > 0 ? 1 : 0
}

main().catch((error) => { console.error('HARNESS_ERROR', error); process.exit(2) })
