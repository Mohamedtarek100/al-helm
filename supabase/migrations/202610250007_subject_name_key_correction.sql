-- Additive migration 007: the canonical subject-key function (single source of truth).
--
-- CONTRACT (identical to subjectNameKey() in src/services/subjects.ts)
--
--     1. NFKC        normalize(raw, NFKC) - folds full-width latin and
--                    punctuation (Ｃ -> C, ＋ -> +), ligatures and Arabic
--                    presentation forms (ﻣ -> م). Arabic-Indic digits are
--                    PRESERVED (١٢٣ stays ١٢٣); NFKC does not map them to ASCII.
--     2. Strip marks ONLY Arabic harakat/tanween/shadda/sukun
--                    (U+0617-061A, U+064B-0652, U+0670, U+06D6-06ED) and
--                    tatweel (U+0640). Marks from other scripts are kept.
--     3. Lower-case  Unicode simple case folding (PostgreSQL lower()).
--     4. Whitespace  collapse runs to one space, then trim.
--
--   Punctuation, symbols and digits are PRESERVED, so "C++" vs "C#",
--   "Math 1" vs "Math1" and "Physics (A)" vs "Physics A" stay distinct.
--
-- WHY THIS REPLACES 006's FUNCTION
--   006's key deleted every Unicode punctuation, symbol, mark and separator
--   character. That conflated genuinely different subjects ("C++" == "C#",
--   "Math 1" == "Math1", "Unit 1.1" == "Unit 11").
--
-- WHY NFKC IS USED HERE
--   PostgreSQL 13+ provides normalize(text, NFKC) natively for UTF-8 databases.
--   This project runs PostgreSQL 17 with server_encoding = UTF8, so no
--   extension is required. An earlier revision of this migration claimed NFKC
--   was unavailable and deferred it to the client; that claim was wrong for this
--   project and caused a real client/database divergence.
--
-- SAFETY
--   - Additive. No row is deleted, merged or renamed; ids and display names are
--     untouched. Only derived keys are recomputed.
--   - The unique index is dropped before recomputation so the backfill cannot
--     fail on an intermediate state, and is only recreated after proving there
--     are no collisions.
--   - Collisions are reported and ABORT the transaction. Nothing is merged or
--     deleted automatically; an operator resolves them and re-runs.
--   - Uniqueness is scoped to (user_id, name_key): different accounts may share
--     a subject name.
--
-- ROLLBACK
--   drop index if exists public.subjects_user_name_key_uidx;
--   -- then restore 006's function definition if 006 was already applied.

-- 1. Canonical key function ---------------------------------------------------
create or replace function public.subject_name_key(raw text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(
           btrim(
             regexp_replace(
               regexp_replace(
                 normalize(coalesce(raw, ''), NFKC),
                 '[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED\u0640]', '', 'g'
               ),
               '[[:space:]]+', ' ', 'g'
             )
           )
         );
$$;

comment on function public.subject_name_key(text) is
  'Canonical subject-name key: NFKC, strip Arabic harakat + tatweel, '
  'lower-case, collapse whitespace. Mirrors subjectNameKey() in src/services/subjects.ts.';

-- 2. Drop the unique index before recomputing keys ---------------------------
--    Keys change under the new contract, so the old index would reject the
--    UPDATE for rows that become equal. Recreated at step 5 after verification.
drop index if exists public.subjects_user_name_key_uidx;

-- 3. Recompute every stored key ----------------------------------------------
update public.subjects
   set name_key = public.subject_name_key(name)
 where name_key is distinct from public.subject_name_key(name);

-- 4. Refuse to continue if the corrected key reveals collisions --------------
do $$
declare
  conflict_groups integer;
  sample text;
begin
  select count(*), string_agg(user_id::text || ': ' || names, '; ')
    into conflict_groups, sample
    from (
      select user_id,
             string_agg(format('"%s"(x%s)', display, n), ', ') as names
        from (
          select user_id, name_key, count(*) as n, min(name) as display
            from public.subjects
           group by user_id, name_key
          having count(*) > 1
        ) g
       group by user_id
    ) collisions;

  if coalesce(conflict_groups, 0) > 0 then
    raise exception
      'Subject uniqueness migration 007 aborted: % account(s) hold subjects that share a canonical key. Resolve them manually, then re-run. Details: %',
      conflict_groups, sample
      using errcode = 'unique_violation';
  end if;
end;
$$;

-- 5. Recreate the user-scoped unique index -----------------------------------
create unique index if not exists subjects_user_name_key_uidx
  on public.subjects (user_id, name_key);
