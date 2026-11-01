 import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

const ROOT = 'd:/EL 7lm/dist'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0]
  const file = join(ROOT, url === '/' ? 'index.html' : url)
  try {
    await stat(file)
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(await readFile(join(ROOT, 'index.html')))
  }
})
await new Promise((r) => server.listen(5600, '127.0.0.1', r))

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const page = await browser.newPage()
const out = {}

// Probe: does a served module execute over http:// at all?
await page.goto('http://127.0.0.1:5600/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
out.httpInline = await page.evaluate(async () => {
  const d = document.createElement('div'); d.id = 'x'; document.body.appendChild(d)
  const s = document.createElement('script'); s.type = 'module'; s.textContent = "document.getElementById('x').textContent='RAN'"
  document.body.appendChild(s)
  await new Promise((r) => setTimeout(r, 1000))
  return document.getElementById('x').textContent
})

out.httpAppScripts = await page.evaluate(() => Array.from(document.scripts).map((s) => s.type || 'classic'))

// Probe over https (production control).
await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
out.httpsApp = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? -1)

console.log(JSON.stringify(out, null, 1))
await browser.close()
server.close()
