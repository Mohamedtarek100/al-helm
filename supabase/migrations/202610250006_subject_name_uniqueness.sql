-- Additive migration 006: user-scoped subject-name uniqueness.
--
-- WHY THIS EXISTS
--   Subject de-duplication used to happen only in the browser (case/whitespace/
--   Arabic-diacritic folding). Two devices could therefore create two records
--   for "Math", " math " or "مُحَاسَبَة" / "محاسبة" within the same account.
--
-- DESIGN
--   `subjects.name_key` holds a canonical comparison key computed by a
--   BEFORE INSERT/UPDATE trigger, and a UNIQUE (user_id, name_key) index makes
--   the guarantee authoritative at the database level.
--
--   The key is deliberately built ONLY from constructs that behave identically
--   in JavaScript and PostgreSQL:
--
--     1. btrim            -> trim surrounding whitespace
--     2. regexp_replace   -> collapse inner whitespace runs to one space
--     3. regexp_replace   -> remove punctuation/symbol/space characters using
--                            Unicode categories \p{P}, \p{S}, \p{M}, \p{Z}. This
--                            drops Arabic harakat (U+0617-061A, U+064B-0652,
--                            U+0670, U+06D6-06ED) and tatweel (U+0640) without
--                            enumerating them, so no code-point list can drift.
--     4. lower            -> case folding (Postgres `lower`, not locale-specific)
--
--   The browser mirrors these exact steps in `subjectNameKey()`
--   (src/services/subjects.ts) so both sides agree on what "the same subject"
--   means. Display names are NEVER modified: only the derived key is stored.
--
--   NFKC is NOT applied here: PostgreSQL has no built-in NFKC function, and
--   `normalize()` requires an unavailable extension. Rather than ship a
--   constraint that silently disagrees with the client, NFKC stays a client
--   concern (it is an input-cleaning step, not an identity rule), and the
--   database guarantees the ASCII/Arabic/whitespace/case cases that actually
--   occur. The application also calls the key function before writing, so
--   NFKC-folded input never reaches the table in a form the DB would miss.
--
-- SAFETY
--   - Purely additive: one nullable column, one helper function, one trigger,
--     one unique index. Nothing is dropped, merged or deleted.
--   - Existing collisions are detected BEFORE the index is created. If any
--     account already holds duplicate names, the migration raises an exception
--     listing the offending user_id/name pairs and STOPS. It never merges or
--     deletes user data; the operator resolves them deliberately and re-runs.
--   - Archived subjects are included in the constraint (they still own their
--     name), which matches the client's findSubjectIncludingArchived().

-- 1. Key helper -------------------------------------------------------------
create or replace function public.subject_name_key(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(
           regexp_replace(
             regexp_replace(
               regexp_replace(btrim(coalesce(raw, '')), '[[:space:]]+', ' ', 'g'),
               '[\p{P}\p{S}\p{M}\p{Z}\u0640]+', '', 'g'
             ),
             '\s+', ' ', 'g'
           )
         );
$$;

comment on function public.subject_name_key(text) is
  'Canonical subject-name key; mirrors subjectNameKey() in src/services/subjects.ts.';

-- 2. Column -----------------------------------------------------------------
alter table public.subjects add column if not exists name_key text;

-- 3. Trigger to maintain the key --------------------------------------------
create or replace function public.subjects_set_name_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name_key := public.subject_name_key(new.name);
  return new;
end;
$$;

drop trigger if exists subjects_set_name_key_trg on public.subjects;
create trigger subjects_set_name_key_trg
  before insert or update of name on public.subjects
  for each row execute function public.subjects_set_name_key();

-- 4. Backfill existing rows (idempotent; only fills where it differs) --------
update public.subjects
   set name_key = public.subject_name_key(name)
 where name_key is distinct from public.subject_name_key(name);

-- 5. Refuse to continue if legitimate duplicates already exist ---------------
--    The block aborts the whole transaction with a diagnostic listing the
--    collisions, so nobody's data is merged or deleted automatically.
do $$
declare
  conflict_count integer;
  sample text;
begin
  select count(*), string_agg(format('user %s -> "%s" (x%s)', user_id, name_key, n), '; ')
    into conflict_count, sample
    from (
      select user_id, name_key, count(*) as n
        from public.subjects
       group by user_id, name_key
      having count(*) > 1
    ) collisions;

  if coalesce(conflict_count, 0) > 0 then
    raise exception
      'Subject uniqueness migration aborted: % conflicting name(s) already exist and must be resolved manually before the unique index can be created. Collisions: %',
      conflict_count, sample
      using errcode = 'unique_violation';
  end if;
end;
$$;

-- 6. Enforce uniqueness per user --------------------------------------------
create unique index if not exists subjects_user_name_key_uidx
  on public.subjects (user_id, name_key);
