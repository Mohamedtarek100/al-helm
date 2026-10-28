-- Verify the client/SQL subject-key contract against a live database.
--
-- READ-ONLY: creates nothing, modifies nothing. Safe on production.
--
--   npx supabase db query --linked < scripts/verify-subject-key-parity.sql
--
-- Compare the `sql_key` column with subjectNameKey() in
-- src/services/subjects.ts. The maintained fixture in
-- src/services/subjectKeyParity.test.ts was generated from this query.
--
-- Expected results (verified on PostgreSQL 17.11, UTF8):
--   ' Ｃ＋ '        -> c++          (fullwidth folds under NFKC)
--   'Ｃ＋'           -> c+           (one operator, not two)
--   'C++' / 'C#'      -> c++ / c#      (distinct: symbols preserved)
--   'Math 1'/'Math1'  -> math 1/math1  (distinct: space is meaningful)
--   'Physics (A)'     -> physics (a)   (distinct from 'Physics A')
--   'مُحَاسَبَة'      -> محاسبة        (harakat stripped)
--   'مـحـاسبة'       -> محاسبة        (tatweel stripped)
--   'Advanced   Math' -> advanced math (whitespace collapsed)
--   'رياضيات ٢'       -> رياضيات ٢     (Arabic-Indic digits PRESERVED)
--   'رياضيات 2'       -> رياضيات 2     (distinct from the above)

with raw(x) as (
  values
    (' Ｃ＋ '),
    ('Ｃ＋'),
    ('C++'),
    ('C+'),
    ('C#'),
    ('Ｍａｔｈ ２'),
    ('ＡＢＣ'),
    ('Math 1'),
    ('Math1'),
    ('Physics (A)'),
    ('Physics A'),
    ('Unit 1.1'),
    ('A+B'),
    ('مُحَاسَبَة'),
    ('مـحـاسبة'),
    ('الرِّيَاضِيَّات'),
    ('Advanced   Math'),
    ('  Chemistry  '),
    ('MAThematics'),
    ('رياضيات ٢'),
    ('رياضيات 2')
)
select
  x as input,
  lower(
    btrim(
      regexp_replace(
        regexp_replace(
          normalize(coalesce(x, ''), NFKC),
          '[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED\u0640]', '', 'g'
        ),
        '[[:space:]]+', ' ', 'g'
      )
    )
  ) as sql_key
from raw
order by input;
