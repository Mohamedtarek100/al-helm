import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Configure VITE_BASE_PATH to the Pages repository path (e.g. /al-helm/).
// Root deployments use '/'; local builds retain a relative base by default.
const pagesBase = process.env.VITE_BASE_PATH

/**
 * Build-time guard: refuses to emit a bundle with a preview harness, a mock
 * data source, or a privileged secret.
 *
 * WHY A BUILD PLUGIN RATHER THAN A TEST
 *   A test proves the current `dist/` is clean; it cannot stop the NEXT build
 *   from including something. This runs on every `tsc -b && vite build` (and
 *   therefore on `npm run check`, the Pages workflow and the Android packaging
 *   script), so a development harness cannot reach a published artifact even if
 *   someone wires it into an entry point by mistake.
 *
 * It inspects module SOURCES, not the minified output, so the signal is the
 * same in dev and production and the failure message names the offending file.
 */
const PREVIEW_MARKERS: { label: string; pattern: RegExp }[] = [
  { label: 'preview harness', pattern: /\.preview\/|\.preview-dist|admin-preview/ },
  { label: 'preview banner', pattern: /DEVELOPMENT PREVIEW/i },
  { label: 'mock admin fixture', pattern: /PREVIEW_ROWS|MOCK_ADMIN|FAKE_OWNER|mockAdminUsers/ },
]

//
// These match KEY MATERIAL, not the word. The console's own UI copy names
// `service_role` and `SUPABASE_SERVICE_ROLE_KEY` deliberately, to document the
// security model; a rule that fired on that prose would flag a correct page and
// teach everyone to ignore the guard.
const SECRET_MARKERS: { label: string; pattern: RegExp }[] = [
  { label: 'service_role JWT claim', pattern: /"role"\s*:\s*"service_role"/ },
  { label: 'service_role key decoded', pattern: /c2VydmljZV9yb2xl/ },
  { label: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: 'Supabase personal token', pattern: /sbp_[A-Za-z0-9]{20,}/ },
  { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'service-role key literal', pattern: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"`][^'"`]+['"`]/ },
  { label: 'hardcoded admin allowlist email', pattern: /mm642898t@gmail\.com/i },
]

function buildHygiene(): Plugin {
  const findings: string[] = []
  return {
    name: '4ulife-build-hygiene',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const normalised = id.replace(/\\/g, '/')
      // Only project sources are inspected. Third-party code is out of scope:
      // the Supabase SDK itself legitimately contains the string "service_role"
      // (in error and doc strings), and flagging it would make the guard
      // unusable rather than safer.
      if (normalised.includes('/node_modules/')) return null
      // Test files legitimately reference fixtures and the owner address; they
      // are never part of the bundle, and Vite already excludes them from the
      // graph. Checking them here would produce false positives only.
      if (/\.(test|spec)\.[tj]sx?$/.test(normalised)) return null
      for (const marker of PREVIEW_MARKERS) {
        if (marker.pattern.test(code) || marker.pattern.test(normalised)) {
          findings.push(`${marker.label} in ${normalised}`)
        }
      }
      for (const marker of SECRET_MARKERS) {
        if (marker.pattern.test(code)) findings.push(`${marker.label} in ${normalised}`)
      }
      return null
    },
    buildEnd(error) {
      if (error) return
      if (findings.length) {
        this.error(
          'Build blocked: development-only or privileged content reached the production bundle:\n  '
          + [...new Set(findings)].join('\n  '),
        )
      }
    },
  }
}

export default defineConfig({
  base: pagesBase || './',
  plugins: [react(), buildHygiene()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
})
