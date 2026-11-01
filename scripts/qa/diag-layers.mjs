/** Verifies the two-layer eraser model with real pixels, before wiring the UI. */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core')

const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const page = await browser.newPage()
await page.setContent('<canvas id="out" width="900" height="620"></canvas>')

const r = await page.evaluate(() => {
  // Minimal re-implementation of paintPaper / paintInkStroke / renderInkLayer.
  const PAPER = { white: '#ffffff', cream: '#fdf8ef', grid: '#fdf8ef' }
  const drawPath = (ctx, s) => {
    ctx.lineWidth = s.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(s.points[0].x, s.points[0].y)
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
    ctx.stroke()
  }
  const paintInk = (ctx, s) => {
    ctx.save()
    if (s.eraser) { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#000' }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color }
    drawPath(ctx, s); ctx.restore()
  }

  const paper = document.createElement('canvas'); paper.width = 900; paper.height = 620
  const pctx = paper.getContext('2d')
  pctx.fillStyle = PAPER.cream; pctx.fillRect(0, 0, 900, 620)

  const ink = document.createElement('canvas'); ink.width = 900; ink.height = 620
  const ictx = ink.getContext('2d')

  const A = { points: [{ x: 100, y: 77 }, { x: 450, y: 77 }], color: '#34312f', size: 20, eraser: false }
  const B = { points: [{ x: 100, y: 540 }, { x: 800, y: 540 }], color: '#34312f', size: 20, eraser: false }
  const E = { points: [{ x: 100, y: 77 }, { x: 450, y: 77 }], color: '#000', size: 24, eraser: true }

  const renderAll = (strokes) => {
    ictx.setTransform(1, 0, 0, 1, 0, 0); ictx.clearRect(0, 0, 900, 620)
    for (const s of strokes) paintInk(ictx, s)
    const out = document.getElementById('out').getContext('2d')
    out.setTransform(1, 0, 0, 1, 0, 0); out.clearRect(0, 0, 900, 620)
    out.drawImage(paper, 0, 0); out.drawImage(ink, 0, 0)
  }
  const inkRows = () => {
    const d = document.getElementById('out').getContext('2d').getImageData(0, 0, 900, 620).data
    let band0 = 0, band3 = 0, transparent = 0
    for (let y = 0; y < 620; y++) for (let x = 0; x < 900; x += 3) {
      const i = (y * 900 + x) * 4
      const dark = d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120
      if (y < 155 && dark) band0++
      if (y > 465 && dark) band3++
      if (d[i + 3] < 10) transparent++
    }
    return { band0, band3, transparent }
  }

  renderAll([A, B])
  const drawn = inkRows()
  renderAll([A, B, E])          // erase A only
  const erased = inkRows()
  renderAll([A, B, E])          // idempotent re-render
  const again = inkRows()
  return { drawn, erased, again }
})

console.log('drawn A/B      :', JSON.stringify(r.drawn))
console.log('after erasing A:', JSON.stringify(r.erased))
console.log('re-render      :', JSON.stringify(r.again))
const pass = r.erased.band0 === 0 && r.erased.band3 > 0 && r.erased.transparent === 0 && r.again.band0 === 0
console.log(pass ? 'PASS layered eraser is correct' : 'FAIL layered eraser still wrong')
await browser.close()
process.exitCode = pass ? 0 : 1
