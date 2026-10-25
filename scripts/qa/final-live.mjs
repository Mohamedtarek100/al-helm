import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core')

const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e.message)))

await page.goto('https://mohamedtarek100.github.io/al-helm-app/#/studio', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2500)

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
await drag(0.2)   // top stroke
await drag(0.8)   // bottom stroke, far away
const drawn = await bands()
console.log('drawn :', JSON.stringify(drawn))

await page.getByRole('button', { name: /^eraser$/i }).first().click()
await page.waitForTimeout(400)
await drag(0.2)   // erase ONLY the top stroke
const erased = await bands()
console.log('erased:', JSON.stringify(erased))

const ok = erased.top === 0 && erased.bottom > 0 && erased.transparent === 0 && drawn.bottom > 0
console.log(ok ? 'PASS production eraser is correct' : 'FAIL production eraser still broken')
console.log('errors:', errs.length ? errs.slice(0, 2) : 'none')
await page.screenshot({ path: 'qa-artifacts/FINAL-live-eraser.png' })
await browser.close()
process.exitCode = ok ? 0 : 1
