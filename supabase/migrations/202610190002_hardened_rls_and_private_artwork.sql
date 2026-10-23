-- Harden ownership, cross-user relationships, profile policies and private artwork access.
-- NOTE: equivalent composite owner-scoped subject FKs are already declared in
-- 202610190001 on focus_sessions (named), recurring_schedules and exam_dates
-- (inline). Re-adding them here would raise a duplicate-constraint error, so
-- no constraint changes are made in this migration.

-- Replace permissive generic policies with operation-specific owner policies; profile key is id, not user_id.
-- Written as explicit statements (a dynamic do-block failed under the migration runner).
revoke all on public.subjects from authenticated;
revoke all on public.study_sessions from authenticated;
revoke all on public.tasks from authenticated;
revoke all on public.focus_sessions from authenticated;
revoke all on public.recurring_schedules from authenticated;
revoke all on public.artistic_goals from authenticated;
revoke all on public.journal_entries from authenticated;
revoke all on public.artwork_metadata from authenticated;
revoke all on public.drawing_challenges from authenticated;
revoke all on public.future_letters from authenticated;
revoke all on public.user_preferences from authenticated;
revoke all on public.exam_dates from authenticated;
revoke all on public.notification_preferences from authenticated;
revoke all on public.push_subscriptions from authenticated;
revoke all on public.reminder_schedule from authenticated;
revoke all on public.push_deliveries from authenticated;

drop policy if exists owner_all on public.subjects;
drop policy if exists owner_all on public.study_sessions;
drop policy if exists owner_all on public.tasks;
drop policy if exists owner_all on public.focus_sessions;
drop policy if exists owner_all on public.recurring_schedules;
drop policy if exists owner_all on public.artistic_goals;
drop policy if exists owner_all on public.journal_entries;
drop policy if exists owner_all on public.artwork_metadata;
drop policy if exists owner_all on public.drawing_challenges;
drop policy if exists owner_all on public.future_letters;
drop policy if exists owner_all on public.user_preferences;
drop policy if exists owner_all on public.exam_dates;
drop policy if exists owner_all on public.notification_preferences;
drop policy if exists owner_all on public.push_subscriptions;
drop policy if exists owner_all on public.reminder_schedule;
drop policy if exists owner_all on public.push_deliveries;

drop policy if exists owner_select on public.subjects;
drop policy if exists owner_select on public.study_sessions;
drop policy if exists owner_select on public.tasks;
drop policy if exists owner_select on public.focus_sessions;
drop policy if exists owner_select on public.recurring_schedules;
drop policy if exists owner_select on public.artistic_goals;
drop policy if exists owner_select on public.journal_entries;
drop policy if exists owner_select on public.artwork_metadata;
drop policy if exists owner_select on public.drawing_challenges;
drop policy if exists owner_select on public.future_letters;
drop policy if exists owner_select on public.user_preferences;
drop policy if exists owner_select on public.exam_dates;
drop policy if exists owner_select on public.notification_preferences;
drop policy if exists owner_select on public.push_subscriptions;
drop policy if exists owner_select on public.reminder_schedule;
drop policy if exists owner_select on public.push_deliveries;

drop policy if exists owner_insert on public.subjects;
drop policy if exists owner_insert on public.study_sessions;
drop policy if exists owner_insert on public.tasks;
drop policy if exists owner_insert on public.focus_sessions;
drop policy if exists owner_insert on public.recurring_schedules;
drop policy if exists owner_insert on public.artistic_goals;
drop policy if exists owner_insert on public.journal_entries;
drop policy if exists owner_insert on public.artwork_metadata;
drop policy if exists owner_insert on public.drawing_challenges;
drop policy if exists owner_insert on public.future_letters;
drop policy if exists owner_insert on public.user_preferences;
drop policy if exists owner_insert on public.exam_dates;
drop policy if exists owner_insert on public.notification_preferences;
drop policy if exists owner_insert on public.push_subscriptions;
drop policy if exists owner_insert on public.reminder_schedule;
drop policy if exists owner_insert on public.push_deliveries;

drop policy if exists owner_update on public.subjects;
drop policy if exists owner_update on public.study_sessions;
drop policy if exists owner_update on public.tasks;
drop policy if exists owner_update on public.focus_sessions;
drop policy if exists owner_update on public.recurring_schedules;
drop policy if exists owner_update on public.artistic_goals;
drop policy if exists owner_update on public.journal_entries;
drop policy if exists owner_update on public.artwork_metadata;
drop policy if exists owner_update on public.drawing_challenges;
drop policy if exists owner_update on public.future_letters;
drop policy if exists owner_update on public.user_preferences;
drop policy if exists owner_update on public.exam_dates;
drop policy if exists owner_update on public.notification_preferences;
drop policy if exists owner_update on public.push_subscriptions;
drop policy if exists owner_update on public.reminder_schedule;
drop policy if exists owner_update on public.push_deliveries;

drop policy if exists owner_delete on public.subjects;
drop policy if exists owner_delete on public.study_sessions;
drop policy if exists owner_delete on public.tasks;
drop policy if exists owner_delete on public.focus_sessions;
drop policy if exists owner_delete on public.recurring_schedules;
drop policy if exists owner_delete on public.artistic_goals;
drop policy if exists owner_delete on public.journal_entries;
drop policy if exists owner_delete on public.artwork_metadata;
drop policy if exists owner_delete on public.drawing_challenges;
drop policy if exists owner_delete on public.future_letters;
drop policy if exists owner_delete on public.user_preferences;
drop policy if exists owner_delete on public.exam_dates;
drop policy if exists owner_delete on public.notification_preferences;
drop policy if exists owner_delete on public.push_subscriptions;
drop policy if exists owner_delete on public.reminder_schedule;
drop policy if exists owner_delete on public.push_deliveries;

create policy owner_select on public.subjects for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.study_sessions for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.tasks for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.focus_sessions for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.recurring_schedules for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.artistic_goals for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.journal_entries for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.artwork_metadata for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.drawing_challenges for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.future_letters for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.user_preferences for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.exam_dates for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.notification_preferences for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.reminder_schedule for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.push_deliveries for select to authenticated using(user_id=auth.uid());

create policy owner_insert on public.subjects for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.study_sessions for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.tasks for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.focus_sessions for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.recurring_schedules for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.artistic_goals for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.journal_entries for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.artwork_metadata for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.drawing_challenges for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.future_letters for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.user_preferences for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.exam_dates for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.notification_preferences for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.push_subscriptions for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.reminder_schedule for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.push_deliveries for insert to authenticated with check(user_id=auth.uid());

create policy owner_update on public.subjects for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.study_sessions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.tasks for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.focus_sessions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.recurring_schedules for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.artistic_goals for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.journal_entries for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.artwork_metadata for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.drawing_challenges for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.future_letters for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.user_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.exam_dates for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.notification_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.push_subscriptions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.reminder_schedule for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.push_deliveries for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create policy owner_delete on public.subjects for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.study_sessions for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.tasks for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.focus_sessions for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.recurring_schedules for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.artistic_goals for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.journal_entries for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.artwork_metadata for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.drawing_challenges for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.future_letters for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.user_preferences for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.exam_dates for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.notification_preferences for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.push_subscriptions for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.reminder_schedule for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.push_deliveries for delete to authenticated using(user_id=auth.uid());

grant select,insert,update,delete on public.subjects to authenticated;
grant select,insert,update,delete on public.study_sessions to authenticated;
grant select,insert,update,delete on public.tasks to authenticated;
grant select,insert,update,delete on public.focus_sessions to authenticated;
grant select,insert,update,delete on public.recurring_schedules to authenticated;
grant select,insert,update,delete on public.artistic_goals to authenticated;
grant select,insert,update,delete on public.journal_entries to authenticated;
grant select,insert,update,delete on public.artwork_metadata to authenticated;
grant select,insert,update,delete on public.drawing_challenges to authenticated;
grant select,insert,update,delete on public.future_letters to authenticated;
grant select,insert,update,delete on public.user_preferences to authenticated;
grant select,insert,update,delete on public.exam_dates to authenticated;
grant select,insert,update,delete on public.notification_preferences to authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
grant select,insert,update,delete on public.reminder_schedule to authenticated;
grant select,insert,update,delete on public.push_deliveries to authenticated;
drop policy if exists owner_all on public.profiles;
drop policy if exists profile_select_own on public.profiles;
drop policy if exists profile_insert_own on public.profiles;
drop policy if exists profile_update_own on public.profiles;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
create policy profile_select_own on public.profiles for select to authenticated using(id=auth.uid());
create policy profile_insert_own on public.profiles for insert to authenticated with check(id=auth.uid());
create policy profile_update_own on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
grant select,insert,update on public.profiles to authenticated;
revoke delete on public.profiles from authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('artworks','artworks',false,6291456,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=6291456,allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif'];
-- storage.objects already has RLS enabled; altering it requires table ownership
-- which the SQL role does not have on hosted projects.
revoke all on storage.objects from anon;
revoke all on storage.objects from authenticated;
drop policy if exists alhelm_artwork_owner_insert on storage.objects;
drop policy if exists alhelm_artwork_owner_select on storage.objects;
drop policy if exists alhelm_artwork_owner_update on storage.objects;
drop policy if exists alhelm_artwork_owner_delete on storage.objects;
drop policy if exists alhelm_artwork_owner_all on storage.objects;
create policy alhelm_artwork_owner_insert on storage.objects for insert to authenticated with check(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_select on storage.objects for select to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_update on storage.objects for update to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_delete on storage.objects for delete to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
grant select,insert,update,delete on storage.objects to authenticated;
