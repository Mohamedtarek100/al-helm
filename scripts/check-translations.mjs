import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/i18n/translations.ts', import.meta.url), 'utf8')
const blocks = [...source.matchAll(/^  (en|ar): \{([\s\S]*?)^  \},/gm)]
const entries = Object.fromEntries(blocks.map(([, language, body]) => [language, [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((match) => match[1])]))
const english = new Set(entries.en ?? [])
const arabic = new Set(entries.ar ?? [])
const missingArabic = [...english].filter((key) => !arabic.has(key))
const missingEnglish = [...arabic].filter((key) => !english.has(key))
if (missingArabic.length || missingEnglish.length) {
  console.error({ missingArabic, missingEnglish })
  process.exitCode = 1
} else console.log(`Translation key parity verified: ${english.size} keys in English and Arabic.`)
