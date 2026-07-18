-- ============================================================================
-- Louis Portfolio — accounts, chat, orders, to-dos
-- Paste this whole file into the Supabase SQL editor and click "Run".
-- Safe to run more than once (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null default 'New user',
  avatar_url  text,
  role        text not null default 'customer' check (role in ('customer', 'owner')),
  banned      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null unique references public.profiles(id) on delete cascade,
  pinned           boolean not null default false,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid not null references public.profiles(id) on delete cascade,
  content          text not null check (char_length(content) between 1 and 1000),
  created_at       timestamptz not null default now()
);
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  title            text not null default 'New order',
  details          text,
  quantity         int not null default 1 check (quantity >= 1),
  priority         text not null default 'normal' check (priority in ('normal', 'high', 'paid extra')),
  status           text not null default 'requested' check (status in ('requested', 'in progress', 'done')),
  created_at       timestamptz not null default now()
);
create index if not exists orders_conversation_idx on public.orders (conversation_id);

create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: is the current user the owner?
-- ---------------------------------------------------------------------------

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Trigger: auto-create a profile row on signup, using the username the
-- person typed at sign-up (passed in auth metadata as "username").
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), 'New user')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trigger: stop customers from promoting themselves to owner or
-- un-banning themselves. Only the owner may change role/banned.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is NULL when the change comes from the SQL editor / admin
  -- (trusted). Only block logged-in NON-owner users from the public API.
  if (new.role is distinct from old.role or new.banned is distinct from old.banned)
     and auth.uid() is not null
     and not public.is_owner() then
    raise exception 'Only the owner can change role or banned status.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_update_trg on public.profiles;
create trigger guard_profile_update_trg
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Trigger: block banned users, enforce a rate limit (max 10 messages per
-- minute per sender), and bump the conversation's last_message_at.
-- ---------------------------------------------------------------------------

create or replace function public.before_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
  is_banned boolean;
begin
  select banned into is_banned from public.profiles where id = new.sender_id;
  if is_banned then
    raise exception 'This account is banned and cannot send messages.';
  end if;

  select count(*) into recent_count
  from public.messages
  where sender_id = new.sender_id
    and created_at > now() - interval '1 minute';
  if recent_count >= 10 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;

  return new;
end;
$$;

drop trigger if exists before_message_insert_trg on public.messages;
create trigger before_message_insert_trg
  before insert on public.messages
  for each row execute function public.before_message_insert();

create or replace function public.after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists after_message_insert_trg on public.messages;
create trigger after_message_insert_trg
  after insert on public.messages
  for each row execute function public.after_message_insert();

-- ---------------------------------------------------------------------------
-- Table privileges: logged-in users get access, then Row Level Security
-- (below) decides which individual rows they can actually see/change.
-- Anonymous visitors get nothing — every feature requires signing in.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles, public.conversations, public.messages, public.orders, public.todos
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security — the real access control
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.orders        enable row level security;
alter table public.todos         enable row level security;

-- profiles ---------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());

-- conversations ----------------------------------------------------------
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (customer_id = auth.uid() or public.is_owner());

drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations
  for insert to authenticated
  with check (customer_id = auth.uid());

drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- messages ---------------------------------------------------------------
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.customer_id = auth.uid()
    )
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      public.is_owner()
      or exists (
        select 1 from public.conversations c
        where c.id = messages.conversation_id and c.customer_id = auth.uid()
      )
    )
  );

-- orders -----------------------------------------------------------------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = orders.conversation_id and c.customer_id = auth.uid()
    )
  );

drop policy if exists orders_owner_write on public.orders;
create policy orders_owner_write on public.orders
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- todos (owner only) -----------------------------------------------------
drop policy if exists todos_owner_all on public.todos;
create policy todos_owner_all on public.todos
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Realtime: broadcast new messages so chats update live
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket for avatars (public read; users manage only their own file,
-- stored as "<their-user-id>/<filename>")
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_user_write on storage.objects;
create policy avatars_user_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_user_update on storage.objects;
create policy avatars_user_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Chat image attachments: a bucket, and an image_url column on messages so a
-- message can be text, an image, or both.
-- ---------------------------------------------------------------------------

alter table public.messages add column if not exists image_url text;
alter table public.messages alter column content drop not null;

-- Drop the old "content must be 1..1000 chars" rule. The replacement rule is
-- defined ONCE at the END of this file — it must come after every attachment
-- column exists, or re-running this file fails validating existing messages.
alter table public.messages drop constraint if exists messages_content_check;

insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

drop policy if exists chat_images_read on storage.objects;
create policy chat_images_read on storage.objects
  for select using (bucket_id = 'chat-images');

drop policy if exists chat_images_write on storage.objects;
create policy chat_images_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Auto-welcome reply: an owner-editable message that is sent automatically
-- the first time a new customer messages.
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  id          int primary key default 1,
  auto_reply  text not null default
    'Hi! Thanks for messaging me 💙 To get your commission started, please send: '
    || '(1) a reference image of the hair, (2) which tier you want '
    || '(Simple / Medium / Detailed), and (3) any deadline. I''ll reply with a quote!',
  constraint settings_single_row check (id = 1)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

alter table public.settings enable row level security;
grant select, update on public.settings to authenticated;

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated using (true);

drop policy if exists settings_update_owner on public.settings;
create policy settings_update_owner on public.settings
  for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create or replace function public.auto_reply_on_first_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cust_id uuid;
  owner_id uuid;
  cust_msg_count int;
  reply_text text;
begin
  select customer_id into cust_id from public.conversations where id = new.conversation_id;

  -- react only to the customer's own messages
  if new.sender_id is distinct from cust_id then
    return new;
  end if;

  -- only on their very first message in this conversation
  select count(*) into cust_msg_count from public.messages
  where conversation_id = new.conversation_id and sender_id = cust_id;
  if cust_msg_count <> 1 then
    return new;
  end if;

  select id into owner_id from public.profiles where role = 'owner' limit 1;
  select auto_reply into reply_text from public.settings where id = 1;
  if owner_id is null or reply_text is null or reply_text = '' then
    return new;
  end if;

  insert into public.messages (conversation_id, sender_id, content)
  values (new.conversation_id, owner_id, reply_text);
  return new;
end;
$$;

drop trigger if exists auto_reply_trg on public.messages;
create trigger auto_reply_trg
  after insert on public.messages
  for each row execute function public.auto_reply_on_first_message();

-- ---------------------------------------------------------------------------
-- Vouches ("wall of reviews"): signed-in customers leave a 1–5 star rating and
-- a comment. The wall is PUBLIC so anyone visiting the site (even signed out)
-- can read the reviews as social proof. Author name/avatar are snapshotted onto
-- the row so the public wall needs no access to the profiles table.
-- One vouch per person (they can edit or remove it); the owner can remove any.
-- ---------------------------------------------------------------------------

create table if not exists public.vouches (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null unique references public.profiles(id) on delete cascade,
  author_name   text not null default 'Customer',
  author_avatar text,
  rating        int  not null check (rating between 1 and 5),
  comment       text not null check (char_length(comment) between 1 and 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vouches_created_idx on public.vouches (created_at desc);

-- Anonymous visitors may READ the wall; signed-in users may also write.
grant usage on schema public to anon;
grant select on public.vouches to anon;
grant select, insert, update, delete on public.vouches to authenticated;

alter table public.vouches enable row level security;

drop policy if exists vouches_public_read on public.vouches;
create policy vouches_public_read on public.vouches
  for select to anon, authenticated using (true);

-- Insert only your own vouch, and only if you are not banned.
drop policy if exists vouches_insert_own on public.vouches;
create policy vouches_insert_own on public.vouches
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and coalesce((select banned from public.profiles where id = auth.uid()), false) = false
  );

-- Edit your own vouch (or the owner may edit any, e.g. to tidy wording).
drop policy if exists vouches_update on public.vouches;
create policy vouches_update on public.vouches
  for update to authenticated
  using (author_id = auth.uid() or public.is_owner())
  with check (author_id = auth.uid() or public.is_owner());

-- Delete your own vouch, or the owner may remove any (moderation).
drop policy if exists vouches_delete on public.vouches;
create policy vouches_delete on public.vouches
  for delete to authenticated
  using (author_id = auth.uid() or public.is_owner());

-- ---------------------------------------------------------------------------
-- Chat file attachments: any file type, up to 30 MB. Images still preview
-- inline (image_url); other files show as a download link (file_url/file_name).
-- ---------------------------------------------------------------------------

alter table public.messages add column if not exists file_url  text;
alter table public.messages add column if not exists file_name text;

-- (The message content rule lives at the END of this file — see note above.)

-- Bucket for arbitrary files (public read; users write only into their own
-- "<user-id>/…" folder). Raise the per-file limit to 30 MB on both buckets.
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;
update storage.buckets set file_size_limit = 31457280
  where id in ('chat-files', 'chat-images');

drop policy if exists chat_files_read on storage.objects;
create policy chat_files_read on storage.objects
  for select using (bucket_id = 'chat-files');

drop policy if exists chat_files_write on storage.objects;
create policy chat_files_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Custom emojis (Discord-style): the owner uploads little images with a
-- :shortcode: name. Everyone signed in can see and use them in chat; only the
-- owner can add or remove them.
-- ---------------------------------------------------------------------------

create table if not exists public.emojis (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (name ~ '^[a-z0-9_]{1,32}$'),
  image_url  text not null,
  created_at timestamptz not null default now()
);

grant select, insert, delete on public.emojis to authenticated;
alter table public.emojis enable row level security;

drop policy if exists emojis_read on public.emojis;
create policy emojis_read on public.emojis
  for select to authenticated using (true);

drop policy if exists emojis_insert_owner on public.emojis;
create policy emojis_insert_owner on public.emojis
  for insert to authenticated with check (public.is_owner());

drop policy if exists emojis_delete_owner on public.emojis;
create policy emojis_delete_owner on public.emojis
  for delete to authenticated using (public.is_owner());

-- Bucket for emoji images (public read; only the owner uploads/removes). 1 MB cap.
insert into storage.buckets (id, name, public)
values ('chat-emojis', 'chat-emojis', true)
on conflict (id) do nothing;
update storage.buckets set file_size_limit = 1048576 where id = 'chat-emojis';

drop policy if exists chat_emojis_read on storage.objects;
create policy chat_emojis_read on storage.objects
  for select using (bucket_id = 'chat-emojis');

drop policy if exists chat_emojis_write on storage.objects;
create policy chat_emojis_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-emojis' and public.is_owner());

drop policy if exists chat_emojis_delete on storage.objects;
create policy chat_emojis_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-emojis' and public.is_owner());

-- ---------------------------------------------------------------------------
-- Message edit / delete / pin.
--   * edited_at  — stamped when a message's text is edited.
--   * deleted_at — soft delete. Hidden from chat but kept for the owner's
--                  "Message history". deleted_by records who removed it.
--   * pinned     — either participant may pin a message.
-- Rules (enforced by the guard trigger below): you may edit only your OWN
-- message text; you may delete your OWN messages, and the owner may delete any;
-- either participant may pin. Attachments and identity fields can't be changed.
-- ---------------------------------------------------------------------------

alter table public.messages add column if not exists edited_at  timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists deleted_by uuid references public.profiles(id);
alter table public.messages add column if not exists pinned     boolean not null default false;
-- the text as it was BEFORE the first edit (for the owner's edit history)
alter table public.messages add column if not exists original_content text;

-- Customers don't see OTHERS' soft-deleted messages; the owner sees everything.
-- A customer must still be able to see their OWN deleted rows: the delete is an
-- UPDATE whose result the API reads back, so if the row turns invisible to its
-- author the whole delete fails with an RLS violation. The chat UI hides
-- deleted messages client-side either way.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    public.is_owner()
    or (
      exists (
        select 1 from public.conversations c
        where c.id = messages.conversation_id and c.customer_id = auth.uid()
      )
      and (deleted_at is null or sender_id = auth.uid())
    )
  );

-- A participant (or the owner) may update messages in their conversation; the
-- guard trigger decides which columns each role is actually allowed to change.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.customer_id = auth.uid()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.customer_id = auth.uid()
    )
  );

create or replace function public.guard_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_own boolean := (old.sender_id = auth.uid());
  owner  boolean := public.is_owner();
begin
  -- Trusted admin (SQL editor / service role): stamp edits, allow anything.
  if auth.uid() is null then
    if new.content is distinct from old.content then
      new.edited_at := now();
      new.original_content := coalesce(old.original_content, old.content);
    end if;
    return new;
  end if;

  -- Identity / structural fields are immutable from the app.
  if new.id <> old.id
     or new.conversation_id <> old.conversation_id
     or new.sender_id <> old.sender_id
     or new.created_at <> old.created_at then
    raise exception 'That field cannot be changed.';
  end if;

  -- Editing text: only your own message. The FIRST edit snapshots the original
  -- wording into original_content (for the owner's edit history); the app can
  -- never overwrite that snapshot directly.
  if new.content is distinct from old.content then
    if not is_own then raise exception 'You can only edit your own messages.'; end if;
    new.edited_at := now();
    new.original_content := coalesce(old.original_content, old.content);
  else
    new.original_content := old.original_content;
  end if;

  -- Attachments can't be edited.
  if new.image_url is distinct from old.image_url
     or new.image_urls is distinct from old.image_urls
     or new.file_url is distinct from old.file_url
     or new.file_name is distinct from old.file_name then
    raise exception 'Attachments cannot be changed.';
  end if;

  -- Soft delete toggle: your own message, or the owner may remove anyone's.
  if (old.deleted_at is null) <> (new.deleted_at is null) then
    if not (is_own or owner) then
      raise exception 'You can only delete your own messages.';
    end if;
    new.deleted_by := case when new.deleted_at is not null then auth.uid() else null end;
  end if;

  -- Pinning is allowed for any participant (RLS already limited who gets here).
  return new;
end;
$$;

drop trigger if exists guard_message_update_trg on public.messages;
create trigger guard_message_update_trg
  before update on public.messages
  for each row execute function public.guard_message_update();

-- ---------------------------------------------------------------------------
-- To-do items get an optional description (content stays as the title).
-- Profiles get an optional public description/bio.
-- ---------------------------------------------------------------------------
alter table public.todos add column if not exists description text;
alter table public.profiles add column if not exists description text;

-- ---------------------------------------------------------------------------
-- Message reactions: a user reacts to a message with an emoji (a unicode char,
-- or a custom :shortcode:). One of each emoji per user per message.
-- Participants of the conversation (and the owner) can see and add reactions.
-- ---------------------------------------------------------------------------
create table if not exists public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 64),
  created_at  timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists reactions_message_idx on public.message_reactions (message_id);

grant select, insert, delete on public.message_reactions to authenticated;
alter table public.message_reactions enable row level security;

drop policy if exists reactions_select on public.message_reactions;
create policy reactions_select on public.message_reactions
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_reactions.message_id and c.customer_id = auth.uid()
    )
  );

drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.is_owner()
      or exists (
        select 1 from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where m.id = message_reactions.message_id and c.customer_id = auth.uid()
      )
    )
  );

drop policy if exists reactions_delete on public.message_reactions;
create policy reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid() or public.is_owner());

do $$
begin
  begin
    alter publication supabase_realtime add table public.message_reactions;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Profile banner (shown on the profile card when someone clicks a user in chat).
-- Grouped image messages: several pics sent at once share ONE bubble
-- (image_urls array), optionally with caption text in the same message.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists banner_url text;
alter table public.messages add column if not exists image_urls text[];
alter table public.todos    add column if not exists pinned boolean not null default false;

-- THE message content rule (defined once, here, after every attachment column
-- exists): a message is valid if it has text, a single image (legacy), grouped
-- images, or a file. First scrub anything no valid rule could describe, so
-- adding the constraint can never fail against old rows.
update public.messages set content = left(content, 1000)
  where char_length(content) > 1000;
delete from public.messages
  where coalesce(content, '') = ''
    and image_url is null and image_urls is null and file_url is null;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (
    (content is null or char_length(content) <= 1000)
    and (
      coalesce(content, '') <> ''
      or image_url is not null
      or image_urls is not null
      or file_url is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Owner inbox unread tracking: when the owner opens a conversation this is
-- bumped; messages newer than it count as unread (badges + notifications).
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists owner_last_read_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Portfolio pieces managed directly on the website (replaces the /admin CMS,
-- which died with the Netlify move). Everyone (even signed-out) can view;
-- only the owner can add/remove. Legacy pieces stay in data/portfolio.json.
-- ---------------------------------------------------------------------------

create table if not exists public.portfolio (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 80),
  detail     text,
  year       text,
  image_url  text not null,
  created_at timestamptz not null default now()
);

grant select on public.portfolio to anon, authenticated;
grant insert, update, delete on public.portfolio to authenticated;
alter table public.portfolio enable row level security;

drop policy if exists portfolio_read on public.portfolio;
create policy portfolio_read on public.portfolio
  for select to anon, authenticated using (true);

drop policy if exists portfolio_owner_write on public.portfolio;
create policy portfolio_owner_write on public.portfolio
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Bucket for portfolio images (public read; only the owner uploads/removes).
insert into storage.buckets (id, name, public)
values ('portfolio-images', 'portfolio-images', true)
on conflict (id) do nothing;
update storage.buckets set file_size_limit = 10485760 where id = 'portfolio-images';

drop policy if exists portfolio_images_read on storage.objects;
create policy portfolio_images_read on storage.objects
  for select using (bucket_id = 'portfolio-images');

drop policy if exists portfolio_images_write on storage.objects;
create policy portfolio_images_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'portfolio-images' and public.is_owner());

drop policy if exists portfolio_images_delete on storage.objects;
create policy portfolio_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'portfolio-images' and public.is_owner());

-- ============================================================================
-- After running this, sign up on your website, then run ONE line to make
-- yourself the owner (replace the email with the one you signed up with):
--
--   update public.profiles set role = 'owner'
--   where id = (select id from auth.users where email = 'you@example.com');
--
-- ============================================================================
