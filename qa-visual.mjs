import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'

// Render the BUILT app and capture screenshots of the admin console.
// Auth is faked ONLY inside the test page by driving the real UI state machine
// (no server call is made and no token is invented).
const BASE = process.env.QA_URL || 'https://mohamedtarek100.github.io/al-helm-app/'
const OUT = 'd:/EL 7lm/.screenshots'

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] })
const results = []

for (const [name, width, height, lang] of [
  ['desktop-en', 1440, 900, 'en'],
  ['mobile-en', 390, 844, 'en'],
  ['desktop-ar', 1440, 900, 'ar'],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)) })

  // Seed persisted settings so the console renders in the requested language.
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate((l) => {
    localStorage.setItem('alhelm.v1.settings', JSON.stringify({ language: l, theme: 'light' }))
  }, lang)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(3500)

  const state = await page.evaluate(() => ({
    rootKids: document.getElementById('root')?.childElementCount ?? -1,
    bodyChars: document.body.innerText.length,
    hasWelcome: /Continue with Google|المتابعة عبر Google/.test(document.body.innerText),
  }))

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => undefined)
  results.push({ name, ...state, errors: errors.slice(0, 4) })
  await ctx.close()
}

console.log(JSON.stringify(results, null, 1))
await browser.close()
