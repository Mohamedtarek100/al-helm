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

//
// EXACT-A-MATCH RULES, NOT SUBSTRINGS
//   These previously matched the bare WORD `service_role`, which the bundled
//   Supabase SDK legitimately contains in its own error strings, and the bare
//   env-var NAME, which appears in UI copy that documents the security model.
//   A scanner that flags documentation is a scanner people learn to ignore —
//   so each rule now targets actual key material: a decoded `role` claim inside
//   a JWT, a real secret token, or a credential being assigned a literal.
const patterns = [
  // A real service-role JWT carries `"role":"service_role"` in its payload.
  ['service_role JWT claim', /"role"\s*:\s*"service_role"/],
  ['service_role key decoded', /c2VydmljZV9yb2xl/],
  ['sb_secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['sbp_ token', /sbp_[A-Za-z0-9]{20,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['admin allowlist email', /mm642898t@gmail\.com/i],
  ['service role key literal', /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"`][^'"`]+['"`]/],
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

// Positive control: the scanner must be able to FIND a planted secret, or a
// clean result proves nothing. The value is synthesised here and never written
// to disk.
const canary = '{"role":"service_role"}'
if (!patterns.some(([, re]) => re.test(canary))) {
  findings += 1
  console.log('FINDING scanner self-check failed: a planted service_role claim was not detected')
}

// The public anon key is expected in the bundle; confirm the URL is the intended project.
const all = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n')
const hasProject = /warepmhybetvjzgvpuqf\.supabase\.co/.test(all)
console.log(`project URL present in bundle: ${hasProject}`)
console.log(`scanned ${files.length} file(s); secret findings: ${findings}`)
process.exitCode = findings ? 1 : 0
