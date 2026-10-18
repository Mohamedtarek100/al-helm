 /* Generates the PWA PNG icon set from the same artwork as favicon.svg.
 * Run with: node scripts/generate-icons.mjs  (dev-only helper, not shipped). */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../public/icons')

/* --- tiny PNG encoder (truecolour + alpha, no dependencies) --- */
const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* --- artwork: cream paper, terracotta sun, sage sprig, ink horizon --- */
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]

const PAPER = hex('#F7F0E5')
const IVORY = hex('#FFFCF7')
const CLAY = hex('#B66B52')
const SAGE = hex('#89977B')
const INK = hex('#34312F')
const BEIGE = hex('#D8C8AA')

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Draws the mark on an N×N canvas with anti-aliased coverage. */
function render(size, { maskable = false } = {}) {
  const ss = 3 // supersample factor
  const S = size * ss
  const buf = Buffer.alloc(size * size * 4)
  const inset = maskable ? 0.16 : 0.07
  const radius = maskable ? 0 : size * 0.28

  const inside = (x, y) => {
    const pad = size * inset
    if (x < pad || y < pad || x > size - pad || y > size - pad) return false
    if (radius <= 0) return true
    const r = radius
    const cx = Math.min(Math.max(x, pad + r), size - pad - r)
    const cy = Math.min(Math.max(y, pad + r), size - pad - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }

  const circle = (px, py, r) => (px - size / 2) ** 2 + (py - size / 2) ** 2 <= r * r
  const ring = (px, py, r, w) => Math.abs(Math.hypot(px - size / 2, py - size / 2) - r) <= w
  const band = (px, py, y0, y1) => py >= size * y0 && py <= size * y1
  const arc = (px, py, y0, y1, curve) => {
    const t = (py / size - y0) / (y1 - y0)
    if (t < 0 || t > 1) return false
    const cx = size / 2 + Math.sin((t - 0.5) * Math.PI) * curve * size
    return Math.abs(px - cx) <= size * 0.012
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss
          const py = y + (sy + 0.5) / ss
          let cr = PAPER[0]
          let cg = PAPER[1]
          let cb = PAPER[2]
          let ca = 1
          if (!inside(px, py)) {
            ca = 0
          } else {
            // paper gradient
            const t = (px / size + py / size) / 2
            const paper = mix(IVORY, PAPER, t)
            cr = paper[0]
            cg = paper[1]
            cb = paper[2]
            // watercolour wash band
            if (band(px, py, 0.58, 0.78)) {
              const w = 0.45
              const wash = mix(mix(CLAY, CLAY, 0), SAGE, (px / size) * 0.9)
              const base = [cr, cg, cb]
              const m = mix(base, wash, w)
              cr = m[0]
              cg = m[1]
              cb = m[2]
            }
            // ink horizon + sun
            if (arc(px, py, 0.42, 0.62, 0.12) || ring(px, py, size * 0.16, size * 0.012)) {
              cr = mix([cr, cg, cb], INK, 0.82)[0]
              cg = mix([cr, cg, cb], INK, 0.82)[1]
              cb = mix([cr, cg, cb], INK, 0.82)[2]
            }
            if (circle(px, py, size * 0.11)) {
              cr = CLAY[0]
              cg = CLAY[1]
              cb = CLAY[2]
            }
            // sage sprig
            const sx1 = size * 0.78
            if (Math.abs(px - sx1) <= size * 0.012 && band(px, py, 0.28, 0.62)) {
              cr = SAGE[0]
              cg = SAGE[1]
              cb = SAGE[2]
            }
            // beige frame for the rounded-square variant
            if (!maskable && (x < size * 0.07 || y < size * 0.07)) {
              const m = mix([cr, cg, cb], BEIGE, 0.6)
              cr = m[0]
              cg = m[1]
              cb = m[2]
            }
          }
          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }
      const n = ss * ss
      const i = (y * size + x) * 4
      const alpha = a / n
      buf[i] = alpha > 0 ? Math.round(r / a) : PAPER[0]
      buf[i + 1] = alpha > 0 ? Math.round(g / a) : PAPER[1]
      buf[i + 2] = alpha > 0 ? Math.round(b / a) : PAPER[2]
      buf[i + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, size, buf)
}

await mkdir(outDir, { recursive: true })
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
]
for (const [name, size, opts] of targets) {
  await writeFile(resolve(outDir, name), render(size, opts))
  console.log(`wrote icons/${name} (${size}x${size})`)
}
