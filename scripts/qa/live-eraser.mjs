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
const y = box.y + box.height * 0.5
const drag = async (fromX, toX) => {
  await page.mouse.move(box.x + box.width * fromX, y)
  await page.mouse.down()
  for (let i = 1; i <= 15; i++) await page.mouse.move(box.x + box.width * (fromX + (toX - fromX) * i / 15), y)
  await page.mouse.up()
  await page.waitForTimeout(400)
}

await page.locator('input[type=range]').fill('22')
await drag(0.2, 0.8)
const before = await stats()
console.log('after drawing :', JSON.stringify(before))

await page.getByRole('button', { name: /^eraser$/i }).first().click()
await page.waitForTimeout(300)
await drag(0.2, 0.8)
const after = await stats()
console.log('after erasing :', JSON.stringify(after))
console.log(after.ink === 0 && after.transparent === 0 ? 'PASS eraser erases to paper (no transparency)' : 'FAIL eraser still wrong')
console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none')
await page.screenshot({ path: 'qa-artifacts/LIVE-eraser.png' })
await browser.close()
