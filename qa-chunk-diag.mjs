import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const page = await browser.newPage()
const net = []
page.on('response', (r) => { if (r.url().includes('/assets/')) net.push(r.status() + ' ' + r.url().split('/').pop()) })
page.on('requestfailed', (r) => { if (r.url().includes('/assets/')) net.push('FAIL ' + r.url().split('/').pop()) })

await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(8000)

// Import the entry bundle directly and capture the concrete failure.
const result = await page.evaluate(async () => {
  try {
    await import('/al-helm-app/assets/index-Bw3YKMua.js')
    return { imported: true }
  } catch (e) {
    return { imported: false, error: String(e && e.message ? e.message : e).slice(0, 300) }
  }
})

console.log(JSON.stringify({ net, result }, null, 1))
await browser.close()
