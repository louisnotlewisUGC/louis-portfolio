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

-- ============================================================================
-- After running this, sign up on your website, then run ONE line to make
-- yourself the owner (replace the email with the one you signed up with):
--
--   update public.profiles set role = 'owner'
--   where id = (select id from auth.users where email = 'you@example.com');
--
-- ============================================================================
