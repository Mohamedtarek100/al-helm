import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { chromium } = require("C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core")
const browser = await chromium.launch({ headless: true, channel: "chromium" })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
await page.goto("http://localhost:4173/#/studio")
await page.waitForTimeout(1800)
const m = await page.evaluate(() => {
  const sub = document.querySelector(".subnav")
  const sb = sub?.getBoundingClientRect()
  const items = [...document.querySelectorAll(".subnav__item")]
  return {
    subnavScroll: sub ? { sw: sub.scrollWidth, cw: sub.clientWidth, right: Math.round(sb.right) } : null,
    lastItem: items.length ? { text: items[items.length - 1].textContent?.trim(), right: Math.round(items[items.length - 1].getBoundingClientRect().right) } : null,
    canvas: (() => { const c = document.querySelector("canvas.sketch-canvas"); const r = c?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height), ratio: +(c.width / r.width).toFixed(2) } : null })(),
    toolbarOverflow: (() => { const t = document.querySelector(".sketch-toolbar"); return t ? t.scrollWidth - t.clientWidth : null })(),
  }
})
console.log(JSON.stringify(m, null, 1))
await browser.close()
