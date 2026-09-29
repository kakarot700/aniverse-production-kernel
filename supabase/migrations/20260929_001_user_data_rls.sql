-- User data: no anon/public table grants; ownership is always tied to auth.uid().
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id text not null check (char_length(media_id) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (user_id, media_id)
);

create table if not exists public.playback_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id text not null check (char_length(media_id) between 1 and 160),
  episode_number integer not null check (episode_number > 0),
  position_ms bigint not null default 0 check (position_ms >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, media_id, episode_number)
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.watchlists enable row level security;
alter table public.watchlists force row level security;
alter table public.playback_history enable row level security;
alter table public.playback_history force row level security;

revoke all on public.profiles, public.watchlists, public.playback_history from public, anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.watchlists to authenticated;
grant select, insert, update on public.playback_history to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists watchlists_select_own on public.watchlists;
create policy watchlists_select_own on public.watchlists for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists watchlists_insert_own on public.watchlists;
create policy watchlists_insert_own on public.watchlists for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists watchlists_update_own on public.watchlists;
create policy watchlists_update_own on public.watchlists for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists watchlists_delete_own on public.watchlists;
create policy watchlists_delete_own on public.watchlists for delete to authenticated
  using ((select auth.uid()) = user_id);

 drop policy if exists playback_history_select_own on public.playback_history;
create policy playback_history_select_own on public.playback_history for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists playback_history_insert_own on public.playback_history;
create policy playback_history_insert_own on public.playback_history for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists playback_history_update_own on public.playback_history;
create policy playback_history_update_own on public.playback_history for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Realtime RLS is already enabled by Supabase. Do not ALTER realtime.messages.
-- Private UUID topics act as bearer invites. A copied room UUID grants join/send
-- rights for that room only; do not broadcast user data or secrets.
drop policy if exists aniverse_watch_room_receive on realtime.messages;
create policy aniverse_watch_room_receive on realtime.messages for select to anon, authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() ~ '^aniverse:watch-room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
drop policy if exists aniverse_watch_room_send on realtime.messages;
create policy aniverse_watch_room_send on realtime.messages for insert to anon, authenticated
  with check (
    extension = 'broadcast'
    and realtime.topic() ~ '^aniverse:watch-room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
