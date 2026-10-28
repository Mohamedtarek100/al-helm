-- READ-ONLY production export used to create a recoverable backup before the
-- pending migrations (005/006/007) are applied. Executes no DDL and no DML.
--
--   npx supabase db query --linked --file scripts/export-preflight-rows.sql
--
-- The single JSON line in the output is the backup payload. Store it OUTSIDE the
-- repository; never commit or upload it.
select jsonb_build_object(
  'exported_at', now(),
  'project', 'warepmhybetvjzgvpuqf',
  'tables', jsonb_build_object(
    'profiles',           (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.profiles t),
    'user_preferences',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.user_preferences t),
    'subjects',           (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.subjects t),
    'tasks',              (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.tasks t),
    'exam_dates',         (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.exam_dates t),
    'artwork_metadata',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.artwork_metadata t),
    'study_sessions',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.study_sessions t),
    'journal_entries',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.journal_entries t),
    'artistic_goals',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.artistic_goals t),
    'drawing_challenges', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.drawing_challenges t),
    'future_letters',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.future_letters t),
    'focus_sessions',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.focus_sessions t)
  )
)::text as payload;
