-- Harden ownership, cross-user relationships, profile policies and private artwork access.
-- NOTE: equivalent composite owner-scoped subject FKs are already declared in
-- 202610190001 on focus_sessions (named), recurring_schedules and exam_dates
-- (inline). Re-adding them here would raise a duplicate-constraint error, so
-- no constraint changes are made in this migration.

-- Replace permissive generic policies with operation-specific owner policies; profile key is id, not user_id.
do $$ declare t text; begin
  foreach t in array['subjects','study_sessions','tasks','focus_sessions','recurring_schedules','artistic_goals','journal_entries','artwork_metadata','drawing_challenges','future_letters','user_preferences','exam_dates','notification_preferences','push_subscriptions','reminder_schedule','push_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('drop policy if exists owner_all on public.%I',t);
    execute format('revoke all on public.%I from authenticated',t);
    execute format('drop policy if exists owner_select on public.%I',t);
    execute format('drop policy if exists owner_insert on public.%I',t);
    execute format('drop policy if exists owner_update on public.%I',t);
    execute format('drop policy if exists owner_delete on public.%I',t);
    execute format('create policy owner_select on public.%I for select to authenticated using(user_id=auth.uid())',t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check(user_id=auth.uid())',t);
    execute format('create policy owner_update on public.%I for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using(user_id=auth.uid())',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;
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
alter table storage.objects enable row level security;
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
