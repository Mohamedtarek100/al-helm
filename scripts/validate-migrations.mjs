import { readFileSync } from 'node:fs'
import { parse } from 'pgsql-ast-parser'
const migrations = ['supabase/migrations/202610190001_initial_schema.sql','supabase/migrations/202610190002_hardened_rls_and_private_artwork.sql']
const unsupported = /create policy|storage\.|create trigger|drop trigger|alter table .* enable row level security|revoke |grant /i
let failed = false
for (const file of migrations) {
  const source=readFileSync(file,'utf8')
  const sql=source.replace(/do\s+\$\$[\s\S]*?\$\$;?/gi,';').replace(/create or replace function[\s\S]*?\$\$;/gi,';')
  const statements=[]
  const stripped=sql.split(/\r?\n/).map(line=>line.replace(/--.*/,'')).join('\n')
  for(const statement of stripped.split(';')){
    const text=statement.trim()
    if(!text||unsupported.test(text)||/^create extension\b/i.test(text)||/^drop policy\b/i.test(text))continue
    try{statements.push(...parse(`${text};`))}
    catch(error){
      const message=error instanceof Error?error.message:String(error)
      if(/on delete set null\s*\(/i.test(text)){
        try{statements.push(...parse(`${text.replace(/on delete set null\s*\([^)]*\)/ig,'on delete set null')};`))}
        catch(retryError){failed=true;console.error(`${file}: ${retryError instanceof Error?retryError.message:String(retryError)}`)}
      }else{failed=true;console.error(`${file}: ${message}\n${text.slice(0,140)}`)}
    }
  }
  console.log(`${file}: ${statements.length} standard statements parsed. PL/pgSQL, RLS/policies, grants, triggers and Supabase Storage syntax not executed.`)
}
if (failed) process.exitCode = 1
