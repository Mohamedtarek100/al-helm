import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { chromium } = require("C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core")
const browser = await chromium.launch({ headless: true, channel: "chromium" })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
await page.goto("https://mohamedtarek100.github.io/al-helm-app/#/studio", { waitUntil: "networkidle", timeout: 60000 })
await page.waitForTimeout(2500)
const m = await page.evaluate(() => {
  const sub = document.querySelector(".subnav")
  const items = [...document.querySelectorAll(".subnav__item")]
  const c = document.querySelector("canvas.sketch-canvas")
  const r = c?.getBoundingClientRect()
  return {
    subnav: sub ? { sw: sub.scrollWidth, cw: sub.clientWidth } : null,
    lastTab: items.length ? { text: items[items.length-1].textContent?.trim(), right: Math.round(items[items.length-1].getBoundingClientRect().right) } : null,
    canvasCss: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    canvasBacking: c ? { w: c.width, h: c.height } : null,
    toolbar: (() => { const t = document.querySelector(".sketch-toolbar"); return t ? t.scrollWidth - t.clientWidth : null })(),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})
console.log(JSON.stringify(m, null, 1))
await page.screenshot({ path: "qa-artifacts/LIVE-studio.png" })
await browser.close()
