-- ============================================================================
-- Read-only check: confirms the chat-images / settings / auto-reply parts of
-- schema.sql have been applied. Paste into Supabase SQL editor and run.
-- Every row should say 'OK' — anything else means re-run schema.sql.
-- ============================================================================

select 'messages.image_url column' as check, case
  when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'image_url'
  ) then 'OK' else 'MISSING' end as status
union all
select 'chat-images storage bucket', case
  when exists (select 1 from storage.buckets where id = 'chat-images')
  then 'OK' else 'MISSING' end
union all
select 'settings table + row', case
  when exists (select 1 from public.settings where id = 1)
  then 'OK' else 'MISSING' end
union all
select 'auto_reply_trg trigger', case
  when exists (
    select 1 from pg_trigger where tgname = 'auto_reply_trg'
  ) then 'OK' else 'MISSING' end
union all
select 'any owner profile exists', case
  when exists (select 1 from public.profiles where role = 'owner')
  then 'OK' else 'MISSING — set your own account to owner' end
union all
select 'vouches table', case
  when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='vouches')
  then 'OK' else 'MISSING' end
union all
select 'messages.file_url + file_name columns', case
  when (select count(*) from information_schema.columns
    where table_schema='public' and table_name='messages'
      and column_name in ('file_url','file_name')) = 2
  then 'OK' else 'MISSING' end
union all
select 'chat-files bucket', case
  when exists (select 1 from storage.buckets where id='chat-files')
  then 'OK' else 'MISSING' end
union all
select 'emojis table', case
  when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='emojis')
  then 'OK' else 'MISSING' end
union all
select 'chat-emojis bucket', case
  when exists (select 1 from storage.buckets where id='chat-emojis')
  then 'OK' else 'MISSING' end;
