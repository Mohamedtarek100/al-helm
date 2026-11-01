import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 250)) })
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url().slice(0, 110)))

await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(9000)

const state = await page.evaluate(() => ({
  rootKids: document.getElementById('root')?.childElementCount ?? -1,
  bodyChars: document.body.innerText.length,
  preview: document.body.innerText.slice(0, 120).replace(/\n+/g, ' | '),
  // Did the module graph load at all?
  resourceCount: performance.getEntriesByType('resource').length,
  jsResources: performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js')).map((r) => r.name.split('/').pop()).slice(0, 3),
}))
console.log(JSON.stringify({ state, errors: errors.slice(0, 8) }, null, 1))
await browser.close()
