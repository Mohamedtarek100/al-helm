import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'

// Fresh, throwaway profile: no service worker, no cache.
const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)) })

await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(9000)

const state = await page.evaluate(() => ({
  rootKids: document.getElementById('root')?.childElementCount ?? -1,
  chars: document.body.innerText.length,
  text: document.body.innerText.slice(0, 120).replace(/\n+/g, ' | '),
}))
console.log(JSON.stringify({ state, errors: errors.slice(0, 6) }, null, 1))
await browser.close()
