import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pending-migration set and ordering.
 *
 * Guards the release-blocking defect found in the previous migration review:
 * migration 008 added a SECOND before-write trigger (`subjects_verify_name_key_trg`)
 * on the same table. PostgreSQL fires same-timing triggers in name order, and
 * `subjects_set_name_key_trg` (006) sorts FIRST — it overwrites `new.name_key`
 * with the SQL-derived value — so 008's verifier then compared a value it had
 * itself just produced. The check could never fail, and the client key was
 * silently discarded.
 *
 * 008 was therefore removed. One trigger derives the key; one unique index
 * enforces it; nothing overwrites anything.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8')

describe('pending migration set', () => {
  it('contains the expected ordered sequence', () => {
    // 009 adds the service_role grants the admin Edge Function needs; it is an
    // additive follow-up and must sort AFTER 007.
    // 010 adds the append-only owner audit log used by Phases 2–4.
    // 011 revokes EXECUTE on the SECURITY DEFINER trigger function (Security
    //     Advisor finding); it is additive and does not touch signup.
    // 013 adds idempotent announcement requests and private push outcomes.
    // 014 stores FCM device registrations server-side only.
    // 015 removes unsafe inherited announcement table privileges.
    expect(files.map((f) => f.slice(0, 12))).toEqual([
      '202610190001',
      '202610190002',
      '202610190003',
      '202610190004',
      '202610240005',
      '202610250006',
      '202610250007',
      '202610311200',
      '202610311300',
      '202611011200',
      '202611011300',
      '202611021400',
      '202611031400',
      '202611031500',
    ])
  })

  it('011 revokes EXECUTE from every client role and leaves the trigger intact', () => {
    const raw = read(files.find((f) => f.startsWith('202611011200')) as string)
    // Assert on EXECUTABLE SQL only. The file's explanatory comments quote the
    // function definition they describe, so including comments would match the
    // prose rather than the statements.
    const sql = raw.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
    // The finding: a SECURITY DEFINER trigger function callable by anon.
    expect(sql).toMatch(/revoke execute on function public\.handle_new_user\(\) from public/i)
    expect(sql).toMatch(/revoke execute on function public\.handle_new_user\(\) from anon, authenticated/i)
    // It must not alter the function, its definer or its trigger — those are
    // what keep signup working.
    expect(sql).not.toMatch(/create or replace function/i)
    expect(sql).not.toMatch(/drop trigger/i)
    expect(sql).not.toMatch(/security invoker/i)
  })

  it('010 makes the audit log append-only for every client role', () => {
    const sql = read(files.find((f) => f.startsWith('202610311300')) as string)
    // Clients must not be able to write, rewrite or erase audit history.
    expect(sql).toMatch(/revoke all on table public\.admin_audit_log from anon, authenticated/i)
    // The service role may only append and read.
    expect(sql).toMatch(/grant insert, select on public\.admin_audit_log to service_role/i)
    expect(sql).not.toMatch(/grant[^;]*update[^;]*on public\.admin_audit_log/i)
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*on public\.admin_audit_log/i)
    expect(sql).not.toMatch(/grant[^;]*truncate[^;]*on public\.admin_audit_log/i)
    // ...and the table refuses mutation even from a privileged connection.
    expect(sql).toMatch(/before update on public\.admin_audit_log/i)
    expect(sql).toMatch(/before delete on public\.admin_audit_log/i)
    // RLS on, and deliberately no policy that would expose rows to clients.
    expect(sql).toMatch(/alter table public\.admin_audit_log enable row level security/i)
    expect(sql).not.toMatch(/create policy[^;]*on public\.admin_audit_log/i)
  })

  it('010 revokes PUBLIC before granting anything', () => {
    // A fresh table can inherit default privileges granted to PUBLIC, so the
    // revoke-from-PUBLIC must exist and must not come after the grants.
    const sql = read(files.find((f) => f.startsWith('202610311300')) as string)
    const revokePublic = sql.search(/revoke all on table public\.admin_audit_log from public/i)
    const firstGrant = sql.search(/grant (insert|select|all)/i)
    expect(revokePublic).toBeGreaterThan(-1)
    expect(firstGrant).toBeGreaterThan(-1)
    expect(revokePublic).toBeLessThan(firstGrant)
  })

  it('010 closes the TRUNCATE hole specifically', () => {
    const sql = read(files.find((f) => f.startsWith('202610311300')) as string)
    // TRUNCATE is table-level, fires no row triggers and is not subject to RLS,
    // so it needs its own revoke from every role and its own trigger.
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(sql, `truncate not revoked from ${role}`)
        .toMatch(new RegExp(`revoke truncate on table public\\.admin_audit_log from[^;]*\\b${role}\\b`, 'i'))
    }
    expect(sql).toMatch(/before truncate on public\.admin_audit_log/i)
    // A TRUNCATE trigger must be statement-level: row triggers never fire.
    expect(sql).toMatch(/before truncate on public\.admin_audit_log[\s\S]{0,80}for each statement/i)
  })

  it('010 keeps the trigger function unprivileged and search_path-pinned', () => {
    const sql = read(files.find((f) => f.startsWith('202610311300')) as string)
    expect(sql).toMatch(/set search_path = pg_catalog, public/i)
    // Elevation is not needed to raise an exception, so it must not be granted.
    expect(sql).not.toMatch(/security definer/i)
  })

  it('010 documents an archive-first recovery, never a bare drop', () => {
    const sql = read(files.find((f) => f.startsWith('202610311300')) as string)
    // The only permitted destructive step is archive-then-verify-then-drop.
    expect(sql).toMatch(/create table public\.admin_audit_log_archive as/i)
    expect(sql).toMatch(/as live[\s\S]{0,120}as archived/i)
    const dropAt = sql.search(/drop table if exists public\.admin_audit_log;/i)
    const archiveAt = sql.search(/create table public\.admin_audit_log_archive as/i)
    const verifyAt = sql.search(/both counts must be equal/i)
    expect(archiveAt).toBeGreaterThan(-1)
    expect(verifyAt).toBeGreaterThan(archiveAt)
    expect(dropAt).toBeGreaterThan(verifyAt)
    // And it must be quoted as a comment block, not executed by this migration.
    expect(sql.slice(dropAt - 400, dropAt)).toMatch(/--/)
  })

  it('013 makes push summary counter updates atomic and service-role-only', () => {
    const sql = read(files.find((f) => f.startsWith('202611021400')) as string)
    expect(sql).toMatch(/create or replace function public\.record_announcement_push_summary/i)
    expect(sql).toMatch(/push_attempted\s*=\s*coalesce\(push_attempted, 0\)\s*\+\s*p_attempted/i)
    expect(sql).toMatch(/push_accepted\s*=\s*coalesce\(push_accepted, 0\)\s*\+\s*p_accepted/i)
    expect(sql).toMatch(/revoke all on function public\.record_announcement_push_summary[\s\S]*from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.record_announcement_push_summary[\s\S]*to service_role/i)
  })

  it('014 keeps Android FCM tokens server-only', () => {
    const sql = read(files.find((f) => f.startsWith('202611031400')) as string)
    expect(sql).toMatch(/create table if not exists public\.fcm_push_tokens/i)
    expect(sql).toMatch(/token_hash text primary key/i)
    expect(sql).toMatch(/alter table public\.fcm_push_tokens enable row level security/i)
    expect(sql).toMatch(/revoke all on table public\.fcm_push_tokens from public, anon, authenticated/i)
    expect(sql).toMatch(/grant select, insert, update, delete on public\.fcm_push_tokens to service_role/i)
  })

  it('015 revokes bypass-RLS privileges but preserves required feed and server grants', () => {
    const sql = read(files.find((f) => f.startsWith('202611031500')) as string)
    expect(sql).toMatch(/revoke all on table public\.announcements from public, anon, authenticated, service_role/i)
    expect(sql).toMatch(/grant select, insert, update, delete on public\.announcements to service_role/i)
    expect(sql).toMatch(/revoke all on table public\.announcement_delivery from public, anon, authenticated, service_role/i)
    expect(sql).toMatch(/grant select, update on public\.announcement_delivery to authenticated/i)
    expect(sql).toMatch(/grant select, insert, update, delete on public\.announcement_delivery to service_role/i)
  })

  it('does not contain the superseded 008 verifier', () => {
    expect(files.some((f) => f.includes('202610250008'))).toBe(false)
  })

  it('ships exactly one subject-key trigger across all migrations', () => {
    const triggerCreates = files
      .map((f) => read(f))
      .join('\n')
      .match(/create trigger\s+subjects_[a-z_]*trg/gi) ?? []
    expect(triggerCreates).toHaveLength(1)
    expect(triggerCreates[0]).toMatch(/subjects_set_name_key_trg/)
  })

  it('creates exactly one user-scoped unique index for the key', () => {
    const indexes = files
      .filter((f) => f.startsWith('202610250006') || f.startsWith('202610250007'))
      .map(read)
      .join('\n')
      .match(/create unique index[^;]*subjects_user_name_key_uidx[^;]*;/gi) ?? []
    // 006 creates it, 007 drops and recreates it — but each definition is
    // scoped by (user_id, name_key) so different accounts may share a name.
    expect(indexes.length).toBeGreaterThan(0)
    for (const sql of indexes) expect(sql).toMatch(/\(user_id,\s*name_key\)/)
  })
})

describe('industry-safe migration content', () => {
  it('never deletes or renames subjects to satisfy a constraint', () => {
    const all = files.map(read).join('\n')
    expect(all).not.toMatch(/delete\s+from\s+public\.subjects/i)
    expect(all).not.toMatch(/update\s+public\.subjects[\s\S]{0,120}set\s+name\s*=/i)
  })

  it('never touches migrations 001-004', () => {
    const applied = ['202610190001', '202610190002', '202610190003', '202610190004']
    for (const prefix of applied) {
      const file = files.find((f) => f.startsWith(prefix))
      expect(file, `applied migration ${prefix} must still exist`).toBeTruthy()
    }
  })

  it('005 widens the priority constraint to include urgent', () => {
    const sql = read(files.find((f) => f.startsWith('202610240005')) as string)
    expect(sql).toMatch(/tasks_priority_check/)
    expect(sql).toMatch(/'urgent'/)
  })

  it('007 applies native NFKC before stripping marks', () => {
    const sql = read(files.find((f) => f.startsWith('202610250007')) as string)
    expect(sql).toMatch(/normalize\(coalesce\(raw, ''\), NFKC\)/)
    // NFKC must happen before mark stripping, so marks survive to be removed.
    expect(sql.indexOf('normalize(')).toBeLessThan(sql.indexOf('\\u0617'))
  })

  it('007 drops the unique index before recomputing keys', () => {
    const sql = read(files.find((f) => f.startsWith('202610250007')) as string)
    const drop = sql.indexOf('drop index if exists public.subjects_user_name_key_uidx')
    const update = sql.indexOf('update public.subjects')
    const recreate = sql.lastIndexOf('create unique index if not exists')
    expect(drop).toBeGreaterThan(-1)
    expect(drop).toBeLessThan(update)
    expect(update).toBeLessThan(recreate)
  })
})
