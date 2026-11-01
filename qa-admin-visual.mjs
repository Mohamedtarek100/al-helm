import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'

const ROOT = 'd:/EL 7lm/dist'
const OUT = 'd:/EL 7lm/.screenshots'
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
}

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0]
  const file = join(ROOT, url === '/' ? 'index.html' : url)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(await readFile(join(ROOT, 'index.html')))
  }
})
await new Promise((r) => server.listen(5800, '127.0.0.1', r))

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const results = []

for (const [name, w, h, lang] of [['admin-desktop-en', 1440, 900, 'en'], ['admin-mobile-en', 390, 844, 'en'], ['admin-desktop-ar', 1440, 900, 'ar']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('http://127.0.0.1:5800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.evaluate((l) => {
    localStorage.setItem('alhelm.v1.settings', JSON.stringify({ language: l, theme: 'light' }))
    localStorage.setItem('alhelm.v1.launchMode', 'guest')
  }, lang)
  // Navigate straight to the admin route.
  await page.goto('http://127.0.0.1:5800/#/admin', { waitUntil: 'load' })
  await page.waitForTimeout(5000)

  const state = await page.evaluate(() => ({
    rootKids: document.getElementById('root')?.childElementCount ?? -1,
    adminRoot: !!document.querySelector('.ac-root'),
    text: document.body.innerText.slice(0, 120).replace(/\n+/g, ' | '),
  }))
  await page.screenshot({ path: `${OUT}/${name}.png` })
  results.push({ name, ...state, errors: errors.slice(0, 3) })
  await ctx.close()
}

console.log(JSON.stringify(results, null, 1))
await browser.close()
server.close()
