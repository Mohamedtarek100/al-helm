import { chromium } from 'file:///C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright/index.mjs'

const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ serviceWorkers: 'block' })
const page = await context.newPage()

// Patch createRoot BEFORE the bundle runs, so we can see whether the
// initStore().finally() callback ever executes.
await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'domcontentloaded' })
const probe = await page.evaluate(async () => {
  const out = { notes: [] }
  const mod = await import('/al-helm-app/assets/' + Array.from(document.scripts).find((s) => s.type === 'module').src.split('/').pop())
    .then(() => 'imported')
    .catch((e) => 'import failed: ' + e.message)
  out.notes.push(mod)
  out.rootBefore = document.getElementById('root').childElementCount
  // Give the boot 5s and re-check without relying on observers.
  await new Promise((r) => setTimeout(r, 5000))
  out.rootAfter = document.getElementById('root').childElementCount
  out.rootHTML = document.getElementById('root').innerHTML.slice(0, 200)
  return out
})
console.log(JSON.stringify(probe, null, 1))
await browser.close()
