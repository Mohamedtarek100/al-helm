import { readFileSync } from 'node:fs'
const sql=readFileSync(new URL('../supabase/migrations/202610190001_initial_schema.sql',import.meta.url),'utf8')
const required=['profiles','subjects','study_sessions','tasks','focus_sessions','recurring_schedules','artistic_goals','journal_entries','artwork_metadata','exam_dates','user_preferences','notification_preferences','push_subscriptions','reminder_schedule','push_deliveries']
const missing=required.filter(table=>!new RegExp(`create table if not exists public\\.${table}\\s*\\(`,'i').test(sql))
const rlsTables=required.filter(table=>new RegExp(`(?:alter table public\\.${table} enable row level security|public\\.%I|\\['[^\\]]*${table})`,'i').test(sql))
if(missing.length||rlsTables.length<required.length){console.error({missing,rlsTables});process.exit(1)}
if(/drop table|truncate table|delete from auth\.users/i.test(sql)){console.error('Destructive statement found');process.exit(1)}
console.log(`Migration smoke check passed: ${required.length} required tables are declared, the RLS policy loop exists, and destructive statements are absent.`)
