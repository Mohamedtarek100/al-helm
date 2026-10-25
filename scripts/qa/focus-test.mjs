import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core')

const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
await page.goto('http://localhost:4173/#/studio', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

const ink = () => page.evaluate(() => {
  const c = document.querySelector('canvas.sketch-canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4 * 29) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) n++
  return n
})

const box = await page.locator('canvas.sketch-canvas').boundingBox()
await page.locator('input[type=range]').fill('20')
const y = box.y + box.height * 0.4
await page.mouse.move(box.x + box.width * 0.2, y)
await page.mouse.down()
for (let i = 1; i <= 15; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.04), y)
await page.mouse.up()
await page.waitForTimeout(500)
const before = await ink()
console.log('ink before focus :', before)

await page.getByRole('button', { name: /full screen/i }).first().click()
await page.waitForTimeout(900)
const inFocus = await page.locator('.sketch-studio--focus').count()
const duringInk = await ink()
const canvasStillThere = await page.locator('canvas.sketch-canvas').count()
console.log('focus mode active:', inFocus, '| ink preserved:', duringInk, '| canvas element:', canvasStillThere)
await page.screenshot({ path: 'qa-artifacts/focus-mode.png' })

await page.getByRole('button', { name: /exit full screen/i }).first().click()
await page.waitForTimeout(800)
const after = await ink()
const stillFocus = await page.locator('.sketch-studio--focus').count()
console.log('ink after exit   :', after, '| focus still on:', stillFocus)

const ok = before > 0 && duringInk === before && after === before && stillFocus === 0
console.log(ok ? 'PASS full screen preserves the drawing exactly' : 'FAIL full screen altered the drawing')
await browser.close()
process.exitCode = ok ? 0 : 1
