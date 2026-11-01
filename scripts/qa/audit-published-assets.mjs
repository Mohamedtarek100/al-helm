// One-shot audit: confirm the published assets carry no privileged material.
// Reports only file names and pattern labels — never the matched value.
import { readdirSync, readFileSync } from 'node:fs'

const dir = 'al-helm-app-deploy/assets'
const patterns = [
  ['service_role JWT claim', /"role"\s*:\s*"service_role"/],
  ['sb_secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['owner email', /mm642898t@gmail\.com/i],
  ['service role key literal', /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"`][^'"`]+['"`]/],
]

let findings = 0
for (const name of readdirSync(dir).filter((n) => n.endsWith('.js') || n.endsWith('.css'))) {
  const text = readFileSync(`${dir}/${name}`, 'utf8')
  for (const [label, re] of patterns) {
    if (re.test(text)) {
      findings += 1
      console.log(`FINDING ${label} in ${name}`)
    }
  }
}
console.log(`scanned ${readdirSync(dir).length} published assets; real findings: ${findings}`)
process.exitCode = findings ? 1 : 0
