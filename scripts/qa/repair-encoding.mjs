// One-shot encoding repair: strip a UTF-8 BOM and reverse the mojibake that
// PowerShell's Set-Content introduced (UTF-8 bytes interpreted as Windows-1252).
// Run via `node scripts/qa/fix-norm.mjs <file>` semantics; this variant is
// explicit about which replacements it performs and fails loudly if any remain.
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/qa/repair-encoding.mjs <file>')
  process.exit(1)
}

const replacements = [
  ['\u00e2\u20ac\u201d', '\u2014'], // em dash
  ['\u00e2\u20ac\u201c', '\u2013'], // en dash
  ['\u00c2\u00b7', '\u00b7'],       // middle dot
  ['\u00e2\u20ac\u2122', '\u2019'], // right single quote
  ['\u00e2\u20ac\u0153', '\u201c'], // left double quote
  ['\u00e2\u20ac\u009d', '\u201d'], // right double quote
  ['\u00e2\u2020\u2019', '\u2192'], // right arrow
]

let text = readFileSync(target, 'utf8')
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

let repaired = 0
for (const [from, to] of replacements) {
  if (text.includes(from)) {
    text = text.split(from).join(to)
    repaired += 1
  }
}

writeFileSync(target, text, 'utf8')

const remaining = [...text.matchAll(/\u00c3\u00a2\u00e2\u201a\u00ac|\u00c2[\u00a0-\u00bf]/g)]
console.log(`repaired ${repaired} sequence type(s); remaining mojibake: ${remaining.length}`)
process.exitCode = remaining.length ? 1 : 0
