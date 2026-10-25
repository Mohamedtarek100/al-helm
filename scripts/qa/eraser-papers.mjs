import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core')

const BASE = process.env.QA_BASE || 'http://localhost:4173/'
const browser = await chromium.launch({ headless: true, channel: 'chromium' })

const paperNames = ['white', 'cream', 'grid']
let failures = 0
const log = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }

for (const paper of paperNames) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(BASE + '#/studio', { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2000)

  // Select the paper swatch (radiogroup .sketch-paper, order: white, cream, grid)
  const idx = paperNames.indexOf(paper)
  const swatch = page.locator('.sketch-paper').nth(idx)
  if (await swatch.count()) { await swatch.click(); await page.waitForTimeout(400) }

  const stats = () => page.evaluate(() => {
    const c = document.querySelector('canvas.sketch-canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let ink = 0, transparent = 0
    for (let i = 0; i < d.length; i += 4 * 29) {
      if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) ink++
      if (d[i + 3] < 10) transparent++
    }
    return { ink, transparent }
  })

  const box = await page.locator('canvas.sketch-canvas').boundingBox()
  const drag = async (fromX, toX, yFrac) => {
    const y = box.y + box.height * yFrac
    await page.mouse.move(box.x + box.width * fromX, y)
    await page.mouse.down()
    for (let i = 1; i <= 15; i++) await page.mouse.move(box.x + box.width * (fromX + (toX - fromX) * i / 15), y)
    await page.mouse.up()
    await page.waitForTimeout(350)
  }

  await page.locator('input[type=range]').fill('20')
  await drag(0.2, 0.5, 0.35)   // stroke A
  await drag(0.2, 0.9, 0.65)   // stroke B (longer)
  const drawn = await stats()

  // Eraser over stroke A only, and part of stroke B.
  await page.getByRole('button', { name: /^eraser$/i }).first().click()
  await page.waitForTimeout(300)
  await drag(0.2, 0.5, 0.35)
  const partial = await stats()

  // Erase the remainder of stroke B.
  await drag(0.2, 0.9, 0.65)
  const cleared = await stats()

  log(drawn.ink > 0, `${paper}: ink drawn (${drawn.ink})`)
  log(drawn.transparent === 0, `${paper}: no transparency after drawing (${drawn.transparent})`)
  log(partial.ink < drawn.ink, `${paper}: partial erase removed ink (${drawn.ink} -> ${partial.ink})`)
  log(partial.ink > 0, `${paper}: partial erase left the other stroke intact (${partial.ink})`)
  log(cleared.ink === 0, `${paper}: full erase removed all ink (${cleared.ink})`)
  log(cleared.transparent === 0, `${paper}: erasing created NO transparent holes (${cleared.transparent})`)

  await context.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PAPER BACKGROUNDS PASS' : `\nFAILURES: ${failures}`)
process.exitCode = failures ? 1 : 0
