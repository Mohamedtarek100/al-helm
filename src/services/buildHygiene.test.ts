 import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Build-time leakage guard.
 *
 * The preview harness has been removed, but the risk it represented does not
 * disappear with it: a future fixture, mock or key pasted into a source file
 * would ship silently. `vite.config.ts` refuses such a build, and this test
 * pins that the refusal is still configured and still looks at the right
 * things — otherwise the guard could be deleted in a refactor and nothing
 * would notice.
 */

const config = readFileSync('vite.config.ts', 'utf8')

/**
 * Extracts the marker rules declared in vite.config.ts.
 *
 * The config is TypeScript and imports Vite, so it cannot be imported directly
 * into this test environment; the `{ label, pattern }` literals are parsed out
 * of the source and rebuilt as RegExp objects.
 */
function configuredMarkers(): { preview: RegExp[]; secrets: RegExp[] } {
  // The block ends at the `]` that follows the last `pattern:` entry — NOT at
  // the first `]` in the text, which may close a character class inside a regex.
  const parse = (blockName: string): RegExp[] => {
    const start = config.indexOf(`const ${blockName}`)
    const nextBlock = config.indexOf('const ', start + 1)
    const block = config.slice(start, nextBlock === -1 ? undefined : nextBlock)
    return [...block.matchAll(/pattern:\s*\/(.+?)\/([a-z]*)\s*,?\s*\}/g)].map((match) => new RegExp(match[1], match[2]))
  }
  return { preview: parse('PREVIEW_MARKERS'), secrets: parse('SECRET_MARKERS') }
}

describe('preview/preview-shipping guard', () => {
  it('is registered as a plugin in the build pipeline', () => {
    expect(config).toContain('buildHygiene()')
    expect(config).toMatch(/name:\s*'4ulife-build-hygiene'/)
    // Build only: a dev server must still serve the real app.
    expect(config).toMatch(/apply:\s*'build'/)
  })

  it('fails the build instead of warning', () => {
    expect(config).toContain('this.error(')
    expect(config).toContain('Build blocked')
  })

  it('detects development preview content', () => {
    // Assert on the behaviour of the configured patterns, not on their source
    // text: the file writes them as regex literals with escaped dots.
    const { preview } = configuredMarkers()
    expect(preview.some((re) => re.test('.preview/admin-preview.tsx'))).toBe(true)
    expect(preview.some((re) => re.test('DEVELOPMENT PREVIEW — static data'))).toBe(true)
    expect(preview.some((re) => re.test("const PREVIEW_ROWS = [{ id: 'u_001' }]"))).toBe(true)
  })

  it('detects privileged key material', () => {
    const { secrets } = configuredMarkers()
    expect(secrets.some((re) => re.test('{"role":"service_role"}'))).toBe(true)
    expect(secrets.some((re) => re.test('sb_secret_abcdef1234567890'))).toBe(true)
    expect(secrets.some((re) => re.test("SUPABASE_SERVICE_ROLE_KEY='xyz'"))).toBe(true)
    expect(secrets.some((re) => re.test('mm642898t@gmail.com'))).toBe(true)
  })

  it('does not flag documentation of the security model', () => {
    // The console legitimately names these controls in its UI copy; a guard
    // that fires on documentation is one people learn to ignore.
    const { secrets } = configuredMarkers()
    const prose = 'The service_role key lives only in SUPABASE_SERVICE_ROLE_KEY on the server.'
    expect(secrets.some((re) => re.test(prose))).toBe(false)
  })

  it('ignores third-party and test sources', () => {
    // The Supabase SDK contains the literal "service_role" in its own strings,
    // so inspecting node_modules would make the guard permanently red.
    expect(config).toContain("normalised.includes('/node_modules/')")
    expect(config).toMatch(/\\\.\(test\|spec\)\\\.\[tj\]sx\?\$/)
  })
})

describe('preview harness removal', () => {
  it('no source file references the preview harness', () => {
    const entry = readFileSync('src/main.tsx', 'utf8')
    expect(entry).not.toContain('.preview')
    expect(entry).not.toContain('admin-preview')
  })

  it('the preview directories are git-ignored so a future one cannot be committed', () => {
    const ignore = readFileSync('.gitignore', 'utf8')
    expect(ignore).toContain('.preview/')
    expect(ignore).toContain('.preview-dist/')
  })
})

describe('build gate wiring', () => {
  it('npm run check runs the secret scan after the build', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.check).toContain('npm run build')
    expect(pkg.scripts.check).toContain('check:secrets')
    // The scan inspects dist/, so it must be ordered after the build.
    expect(pkg.scripts.check.indexOf('check:secrets')).toBeGreaterThan(pkg.scripts.check.indexOf('npm run build'))
  })

  it('the Pages workflow scans before publishing', () => {
    const workflow = readFileSync('.github/workflows/pages.yml', 'utf8')
    const buildAt = workflow.indexOf('run: npm run build')
    const scanAt = workflow.indexOf('npm run check:secrets')
    const deployAt = workflow.indexOf('Deploy dist to al-helm-app')
    expect(buildAt).toBeGreaterThan(-1)
    expect(scanAt).toBeGreaterThan(buildAt)
    expect(deployAt).toBeGreaterThan(scanAt)
  })
})
