#!/usr/bin/env node
/**
 * Regenerates supabase/ALL_MIGRATIONS.sql from the ordered files in
 * supabase/migrations/. The consolidated file exists for manual SQL-editor
 * application; the individual migration files remain the source of truth.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const outFile = join(root, 'supabase', 'ALL_MIGRATIONS.sql')

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

const header = `-- 4uLife — consolidated schema.
-- GENERATED from supabase/migrations/ (ordered). Do not edit by hand —
-- run \`npm run gen:migrations\` after adding or changing migration files.
-- Applied incrementally via \`npx supabase db push --linked\`.

`

const blocks = files.map((f) => {
  const body = readFileSync(join(migrationsDir, f), 'utf8').trim()
  return `-- ============================================================\n-- Migration: ${f}\n-- ============================================================\n\n${body}\n`
})

writeFileSync(outFile, header + blocks.join('\n'), 'utf8')
console.log(`Regenerated ${outFile} from ${files.length} migration(s).`)
