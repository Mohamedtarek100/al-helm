-- Read-only inspection of the live production schema (no DDL/DML).
select conname, pg_get_constraintdef(oid) as def, contype
from pg_constraint
where conrelid in ('public.tasks'::regclass, 'public.exam_dates'::regclass, 'public.artwork_metadata'::regclass)
order by conrelid::regclass::text, conname;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('tasks','exam_dates','artwork_metadata')
order by table_name, ordinal_position;

select priority, count(*) from public.tasks group by priority order by 1;

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'subjects' and column_name = 'name_key';
