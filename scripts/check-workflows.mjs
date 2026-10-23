// Validate workflow YAML syntax with a real parser.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let yaml
try {
  yaml = require('js-yaml')
} catch {
  console.log('js-yaml not installed — falling back to structural checks only.')
  yaml = null
}
for (const file of ['.github/workflows/pages.yml', '.github/workflows/ci.yml']) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  if (!yaml) {
    // Minimal sanity: tabs are illegal in YAML.
    if (/\t/.test(text)) console.log(`${file}: TAB characters found (invalid YAML)`)
    else console.log(`${file}: structural checks pass (no tabs)`)
    continue
  }
  try {
    const doc = yaml.load(text)
    const jobs = Object.keys(doc?.jobs ?? {})
    console.log(`${file}: valid YAML, ${jobs.length} job(s) [${jobs.join(', ')}]`)
  } catch (e) {
    console.log(`${file}: YAML ERROR: ${e.message}`)
    process.exitCode = 1
  }
}
