/**
 * Full eraser lifecycle verification against the real app:
 * two strokes on each paper, erase one, then undo / redo / save / reload /
 * reopen / export, asserting pixels each time.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core')

const BASE = process.env.QA_BASE || 'http://localhost:4173/'
const papers = ['white', 'cream', 'grid']
const browser = await chromium.launch({ headless: true, channel: 'chromium' })
let fails = 0
const log = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }

for (const paper of papers) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
  const page = await context.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message)))
  await page.goto(BASE + '#/studio', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const idx = papers.indexOf(paper)
  await page.locator('.sketch-paper').nth(idx).click()
  await page.waitForTimeout(400)

  const bands = () => page.evaluate(() => {
    const c = document.querySelector('canvas.sketch-canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let top = 0, bottom = 0, transparent = 0
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x += 4) {
      const i = (y * c.width + x) * 4
      const dark = d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120
      if (y < c.height / 3 && dark) top++
      if (y > (c.height * 2) / 3 && dark) bottom++
      if (d[i + 3] < 10) transparent++
    }
    return { top, bottom, transparent }
  })

  const box = await page.locator('canvas.sketch-canvas').boundingBox()
  const drag = async (yFrac) => {
    const y = box.y + box.height * yFrac
    await page.mouse.move(box.x + box.width * 0.15, y)
    await page.mouse.down()
    for (let i = 1; i <= 15; i++) await page.mouse.move(box.x + box.width * (0.15 + i * 0.04), y)
    await page.mouse.up()
    await page.waitForTimeout(400)
  }

  await page.locator('input[type=range]').fill('20')
  await drag(0.2)
  await drag(0.8)
  const drawn = await bands()
  log(drawn.top > 0 && drawn.bottom > 0, `${paper}: two strokes drawn (${drawn.top}/${drawn.bottom})`)

  await page.getByRole('button', { name: /^eraser$/i }).first().click()
  await page.waitForTimeout(300)
  await drag(0.2)
  const erased = await bands()
  log(erased.top === 0 && erased.bottom > 0, `${paper}: erased one stroke, other intact (${erased.top}/${erased.bottom})`)
  log(erased.transparent === 0, `${paper}: no transparent holes (${erased.transparent})`)

  // Undo the erase — both strokes back.
  await page.getByRole('button', { name: /undo|تراجع/i }).first().click()
  await page.waitForTimeout(500)
  const undone = await bands()
  log(undone.top > 0 && undone.bottom > 0, `${paper}: undo restored the erased stroke (${undone.top}/${undone.bottom})`)

  // Redo the erase.
  await page.getByRole('button', { name: /redo|إعادة/i }).first().click()
  await page.waitForTimeout(500)
  const redone = await bands()
  log(redone.top === 0 && redone.bottom > 0, `${paper}: redo re-applied the erase (${redone.top}/${redone.bottom})`)

  // Save, then reload and reopen from the recent list.
  const title = `QA-ERASE-${paper}-${Date.now()}`
  await page.locator('.sketch-title-input').fill(title)
  await page.getByRole('button', { name: /^save$/i }).last().click()
  await page.waitForTimeout(2000)
  const saveState = (await page.locator('.save-state').first().textContent().catch(() => '')) || ''
  log(/saved/i.test(saveState) && !/unsaved/i.test(saveState), `${paper}: save reported success (${saveState.trim()})`)

  await page.reload()
  await page.waitForTimeout(1800)
  await page.goto(BASE + '#/studio', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  const thumb = page.locator('.sketch-thumb', { hasText: title }).first()
  const found = (await thumb.count()) > 0
  log(found, `${paper}: saved drawing listed after reload`)
  if (found) {
    await thumb.click()
    await page.waitForTimeout(1500)
    const reopened = await bands()
    log(reopened.top === 0 && reopened.bottom > 0 && reopened.transparent === 0,
      `${paper}: reopened drawing matches (eraser persisted: ${reopened.top}/${reopened.bottom}, transparent ${reopened.transparent})`)
  }

  // PNG export produces a real file.
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
  await page.getByRole('button', { name: /export png/i }).first().click()
  const download = await downloadPromise
  log(Boolean(download), `${paper}: PNG export produced a download (${download ? download.suggestedFilename() : 'none'})`)

  log(errs.length === 0, `${paper}: no page errors (${errs.slice(0, 2).join(' | ') || 'none'})`)

  // Cleanup only QA records.
  await page.evaluate((t) => {
    const raw = localStorage.getItem('alhelm.v1.artworks')
    if (!raw) return
    localStorage.setItem('alhelm.v1.artworks', JSON.stringify(JSON.parse(raw).filter((a) => a.title !== t)))
  }, title)

  await context.close()
}

await browser.close()
console.log(fails === 0 ? '\nALL ERASER LIFECYCLE CHECKS PASSED' : `\nFAILURES: ${fails}`)
process.exitCode = fails ? 1 : 0
