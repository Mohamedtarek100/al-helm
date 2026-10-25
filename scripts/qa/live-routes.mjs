import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { chromium } = require("C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core")
const browser = await chromium.launch({ headless: true, channel: "chromium" })
const routes = [["/","Home"],["/schedule","Schedule"],["/calendar","Calendar"],["/tasks","Tasks"],["/focus","Focus"],["/studio","Studio"],["/progress","Progress"],["/review","Review"],["/exams","Exams"],["/notifications","Notifications"],["/settings","Settings"],["/admin","Admin"]]
let fails = 0
for (const [w,h] of [[390,844],[1366,768]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 })
  const page = await ctx.newPage()
  const errs = []
  page.on("pageerror", e => errs.push(String(e.message)))
  for (const [route, name] of routes) {
    await page.goto("https://mohamedtarek100.github.io/al-helm-app/#" + route, { waitUntil: "networkidle", timeout: 45000 })
    await page.waitForTimeout(900)
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1: document.querySelector("h1")?.textContent?.trim() ?? "(none)",
    }))
    const ok = m.overflow <= 1 && m.h1 !== "(none)"
    if (!ok) fails++
    console.log(`${ok ? "PASS" : "FAIL"} ${w}px ${name.padEnd(14)} overflow=${m.overflow} h1="${m.h1}"`)
  }
  if (errs.length) { fails++; console.log(`PAGE ERRORS ${w}px:`, errs.slice(0,2)) }
  await ctx.close()
}
console.log(fails === 0 ? "ALL ROUTES OK" : `FAILURES: ${fails}`)
await browser.close()
