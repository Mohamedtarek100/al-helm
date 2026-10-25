/** Secret-hygiene scan of the built client bundle. Never prints secret values. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = 'dist'
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else files.push(full)
  }
}
walk(root)

const patterns = [
  ['service_role JWT', /service_role/],
  ['sb_secret key', /sb_secret_[A-Za-z0-9]+/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['admin allowlist email', /mm642898t@gmail\.com/i],
  ['service role env name', /SUPABASE_SERVICE_ROLE_KEY/],
  ['hardcoded password', /password\s*[:=]\s*['"][^'"]{8,}['"]/i],
]

let findings = 0
for (const file of files) {
  if (!/\.(js|css|html|json|map)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const [label, re] of patterns) {
    if (re.test(text)) {
      findings += 1
      console.log(`FINDING ${label} in ${file}`)
    }
  }
}

// The public anon key is expected in the bundle; confirm the URL is the intended project.
const all = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n')
const hasProject = /warepmhybetvjzgvpuqf\.supabase\.co/.test(all)
console.log(`project URL present in bundle: ${hasProject}`)
console.log(`scanned ${files.length} file(s); secret findings: ${findings}`)
process.exitCode = findings ? 1 : 0
