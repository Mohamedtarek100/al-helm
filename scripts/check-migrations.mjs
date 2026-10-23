#!/usr/bin/env node
/**
 * Migration consistency checker.
 *
 * Verifies that:
 *  1. Migration files are numbered sequentially (no gaps/duplicates).
 *  2. supabase/ALL_MIGRATIONS.sql contains every migration body in order.
 *
 * Exits non-zero on any mismatch so it can gate CI.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const allFile = join(root, 'supabase', 'ALL_MIGRATIONS.sql')

let failures = 0
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures += 1 }

if (!existsSync(migrationsDir)) {
  fail('supabase/migrations directory not found.')
  process.exit(1)
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (files.length === 0) {
  console.log('No migrations found — nothing to check.')
  process.exit(0)
}

// 1. Sequential numbering check (timestamp-prefixed names).
const prefixes = files.map((f) => f.replace(/\.sql$/, ''))
for (let i = 1; i < prefixes.length; i += 1) {
  if (prefixes[i] <= prefixes[i - 1]) {
    fail(`Duplicate or out-of-order migration prefix: ${prefixes[i - 1]} vs ${prefixes[i]}`)
  }
}

// 2. ALL_MIGRATIONS.sql must contain each migration's body, in order.
if (!existsSync(allFile)) {
  fail('supabase/ALL_MIGRATIONS.sql is missing.')
} else {
  const all = readFileSync(allFile, 'utf8')
  let searchFrom = 0
  for (const file of files) {
    const body = readFileSync(join(migrationsDir, file), 'utf8').trim()
    // Compare on a normalized signature: collapse whitespace.
    const sig = body.replace(/\s+/g, ' ').trim()
    const idx = all.replace(/\s+/g, ' ').trim().indexOf(sig, searchFrom)
    if (idx === -1) {
      fail(`ALL_MIGRATIONS.sql is missing or out-of-order for migration: ${file}`)
    } else {
      searchFrom = idx + sig.length
    }
  }
}

if (failures) {
  console.error(`\n${failures} migration consistency failure(s). Run the regeneration step for ALL_MIGRATIONS.sql.`)
  process.exit(1)
}
console.log(`OK: ${files.length} migration(s), ALL_MIGRATIONS.sql consistent and ordered.`)
