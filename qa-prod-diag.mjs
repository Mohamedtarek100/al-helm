export default async function run(page) {
  const events = []
  page.on('pageerror', (e) => events.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => events.push(m.type().toUpperCase() + ': ' + m.text().slice(0, 200)))
  page.on('response', (r) => { if (r.status() >= 400) events.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 100)) })

  await page.addInitScript(() => {
    window.__errs = []
    window.addEventListener('error', (e) => window.__errs.push('ERR ' + e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno))
    window.addEventListener('unhandledrejection', (e) => window.__errs.push('REJ ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))))
  })

  await page.goto('https://mohamedtarek100.github.io/al-helm-app/', { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(8000)

  const state = await page.evaluate(() => ({
    captured: window.__errs || [],
    rootKids: document.getElementById('root')?.childElementCount ?? -1,
    bodyChars: document.body.innerText.length,
  }))
  return { state, events: events.slice(0, 15) }
}
