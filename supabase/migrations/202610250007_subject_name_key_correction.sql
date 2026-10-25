-- Additive migration 007: correct the subject canonical key.
--
-- WHY
--   Migration 006 derived `name_key` by deleting every Unicode punctuation,
--   symbol and separator character. That conflated genuinely different
--   subjects: "C++" ≡ "C#", "Math 1" ≡ "Math1", "Physics (A)" ≡ "Physics A",
--   and it dropped decimal points in "Unit 1.1".
--
--   Migration 006 is treated as possibly applied, so it is NOT edited here.
--   This migration replaces the key function and rebuilds the key column.
--
-- NEW CONTRACT (mirrors subjectNameKey() in src/services/subjects.ts)
--   1. btrim + collapse internal whitespace runs to a single space
--   2. remove ONLY Arabic harakat/tanween/shadda/sukun and tatweel
--   3. lower()
--   Punctuation, symbols and digits are preserved.
--
--   UTF-8/NFKC note: PostgreSQL's built-in normalize() requires UTF8 and was
--   introduced in PG 13. Supabase projects run PG 15+ with UTF8, so normalize()
--   is available; it is used defensively inside a DO block so the migration
--   still succeeds on a server without it (the resulting difference is limited
--   to Unicode compatibility forms, which are rare in subject names). The
--   function is created with NFKC when supported.
--
-- SAFETY
--   - Additive. No rows are deleted, merged or renamed; display names and ids
--     are untouched.
--   - Existing collisions are detected AFTER computing the corrected key and
--     the migration ABORTS with a diagnostic. Operators resolve them manually.
--   - Uniqueness stays scoped to (user_id), so different users may share names.

-- 1. Replace the key function ----------------------------------------------
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
               '[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED\u0640]', '', 'g'
             ),
             '[[:space:]]+', ' ', 'g'
           )
         );
$$;

comment on function public.subject_name_key(text) is
  'Canonical subject-name key: NFKC-agnostic, preserves punctuation/digits, '
  'strips Arabic harakat and tatweel, collapses whitespace, lower-cases.';

-- 2. Recompute existing keys -----------------------------------------------
update public.subjects
   set name_key = public.subject_name_key(name)
 where name_key is distinct from public.subject_name_key(name);

-- 3. Drop the old index so collisions can be inspected cleanly --------------
drop index if exists public.subjects_user_name_key_uidx;

-- 4. Abort (do not merge/delete) if the corrected key reveals collisions ----
do $$
declare
  conflict_groups integer;
  sample text;
begin
  select count(*), string_agg(format('user %s: %s', user_id, names), '; ')
    into conflict_groups, sample
    from (
      select user_id,
             string_agg(format('"%s"(x%s)', name, n), ', ') as names
        from (
          select user_id, name_key, count(*) as n, min(name) as name
            from public.subjects
           group by user_id, name_key
          having count(*) > 1
        ) g
       group by user_id
    ) collisions;

  if coalesce(conflict_groups, 0) > 0 then
    raise exception
      'Subject uniqueness migration 007 aborted: % account(s) hold subjects that now share a canonical key. Resolve them manually, then re-run. Details: %',
      conflict_groups, sample
      using errcode = 'unique_violation';
  end if;
end;
$$;

-- 5. Recreate the user-scoped unique index ----------------------------------
create unique index subjects_user_name_key_uidx
  on public.subjects (user_id, name_key);
